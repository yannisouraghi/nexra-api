import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Env, Analysis, ApiResponse } from '../types';
import { generateId } from '../utils/helpers';
import { fetchMatchData } from '../utils/riot-api';
import { rateLimit, requireAuth, extractUserId } from '../middleware/auth';

const app = new Hono<{ Bindings: Env }>();

// Rate limiter for analysis (expensive operations)
const analysisRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10, // 10 analyses per minute max
});

// Rate limiter for reads
const readRateLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 60,
});

// Schema for match data from Riot API
const matchDataSchema = z.object({
  champion: z.string().optional(),
  kills: z.number().optional(),
  deaths: z.number().optional(),
  assists: z.number().optional(),
  win: z.boolean().optional(),
  duration: z.number().optional(),
  gameMode: z.string().optional(),
  queueId: z.number().optional(),
  role: z.string().optional(),
  lane: z.string().optional(),
  teamPosition: z.string().optional(),
  totalMinionsKilled: z.number().optional(),
  neutralMinionsKilled: z.number().optional(),
  goldEarned: z.number().optional(),
  goldSpent: z.number().optional(),
  visionScore: z.number().optional(),
  wardsPlaced: z.number().optional(),
  wardsKilled: z.number().optional(),
  detectorWardsPlaced: z.number().optional(),
  totalDamageDealtToChampions: z.number().optional(),
  totalDamageTaken: z.number().optional(),
  damageDealtToObjectives: z.number().optional(),
  doubleKills: z.number().optional(),
  tripleKills: z.number().optional(),
  quadraKills: z.number().optional(),
  pentaKills: z.number().optional(),
  firstBloodKill: z.boolean().optional(),
  firstTowerKill: z.boolean().optional(),
  items: z.array(z.number()).optional(),
  champLevel: z.number().optional(),
  summoner1Id: z.number().optional(),
  summoner2Id: z.number().optional(),
  rank: z.number().optional(),
  teammates: z.array(z.any()).optional(),
  enemies: z.array(z.any()).optional(),
}).optional();

// Schema for creating analysis
const createAnalysisSchema = z.object({
  matchId: z.string().min(1),
  puuid: z.string().min(1),
  region: z.string().min(1),
  matchData: matchDataSchema,
});

// Supported languages for AI analysis
const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'de', 'pt'] as const;
type AnalysisLanguage = typeof SUPPORTED_LANGUAGES[number];

// Schema for analyze endpoint
const analyzeSchema = z.object({
  matchId: z.string().min(1),
  puuid: z.string().min(1),
  region: z.string().min(1),
  language: z.enum(SUPPORTED_LANGUAGES).optional().default('en'),
  save: z.boolean().optional().default(true), // Whether to save to DB
});

// POST /analysis/analyze - Async analysis: returns 202 immediately, processes in background
app.post('/analyze', requireAuth, analysisRateLimit, zValidator('json', analyzeSchema), async (c) => {
  const { matchId, puuid, region, language, save } = c.req.valid('json');

  try {
    // Check if analysis already exists
    const existing = await c.env.DB.prepare(`
      SELECT * FROM analyses WHERE match_id = ? AND puuid = ?
    `).bind(matchId, puuid).first();

    if (existing) {
      const a = existing as unknown as Record<string, unknown>;
      const status = a.status as string;

      // If still processing, return current progress
      if (status === 'processing') {
        return c.json<ApiResponse>({
          success: true,
          data: {
            id: a.id,
            matchId: a.match_id,
            puuid: a.puuid,
            status: 'processing',
            progress: a.progress ?? 0,
            progressMessage: a.progress_message ?? 'Processing...',
            champion: a.champion,
            result: a.result,
            duration: a.duration,
            gameMode: a.game_mode,
            kills: a.kills,
            deaths: a.deaths,
            assists: a.assists,
            role: a.role,
          },
        }, 202);
      }

      // If completed or failed, return full result
      const analysis = {
        id: a.id,
        matchId: a.match_id,
        puuid: a.puuid,
        region: a.region,
        status: a.status,
        progress: status === 'completed' ? 100 : (a.progress ?? null),
        progressMessage: status === 'completed' ? 'Analysis complete' : (a.progress_message ?? null),
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        completedAt: a.completed_at,
        champion: a.champion,
        result: a.result,
        duration: a.duration,
        gameMode: a.game_mode,
        kills: a.kills,
        deaths: a.deaths,
        assists: a.assists,
        role: a.role,
        stats: a.stats ? JSON.parse(a.stats as string) : null,
        errors: a.errors ? JSON.parse(a.errors as string) : null,
        tips: a.tips ? JSON.parse(a.tips as string) : null,
      };

      return c.json<ApiResponse>({
        success: true,
        data: { ...analysis, existing: true },
      });
    }

    console.log(`Starting async AI analysis for match ${matchId}, puuid ${puuid}`);

    // Quick fetch: match summary for basic info (~1s)
    const riotMatchData = await fetchMatchData(matchId, region, c.env.RIOT_API_KEY);
    const matchInfo = riotMatchData.info as any;

    const riotParticipant = matchInfo.participants.find((p: any) => p.puuid === puuid);
    if (!riotParticipant) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Player not found in match participants',
      }, 400);
    }

    // Normalize role
    const roleMap: Record<string, string> = {
      'TOP': 'TOP', 'JUNGLE': 'JUNGLE', 'MIDDLE': 'MID', 'MID': 'MID',
      'BOTTOM': 'ADC', 'ADC': 'ADC', 'UTILITY': 'SUPPORT', 'SUPPORT': 'SUPPORT',
    };
    const normalizedRole = roleMap[riotParticipant.teamPosition?.toUpperCase() || ''] || 'UNKNOWN';
    const champion = riotParticipant.championName;
    const result = riotParticipant.win ? 'win' : 'loss';

    // Insert processing record immediately
    const analysisId = generateId();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO analyses (
        id, match_id, puuid, region, status,
        champion, result, duration, game_mode,
        kills, deaths, assists, role,
        progress, progress_message,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?, ?, 10, 'Fetching game data...', ?, ?)
    `).bind(
      analysisId, matchId, puuid, region,
      champion, result, matchInfo.gameDuration, matchInfo.gameMode,
      riotParticipant.kills, riotParticipant.deaths, riotParticipant.assists, normalizedRole,
      now, now
    ).run();

    // Return 202 immediately with basic match info
    const responseData = {
      id: analysisId,
      matchId,
      puuid,
      status: 'processing',
      progress: 10,
      progressMessage: 'Fetching game data...',
      champion,
      result,
      duration: matchInfo.gameDuration,
      gameMode: matchInfo.gameMode,
      kills: riotParticipant.kills,
      deaths: riotParticipant.deaths,
      assists: riotParticipant.assists,
      role: normalizedRole,
    };

    // Send to queue for reliable background processing (no waitUntil timeout)
    await c.env.ANALYSIS_QUEUE.send({
      analysisId,
      matchId,
      puuid,
      region,
      language,
    });

    return c.json<ApiResponse>({
      success: true,
      data: responseData,
    }, 202);
  } catch (error) {
    console.error('Analysis failed:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Analysis failed',
    }, 500);
  }
});

// GET /analysis - List all analyses for a user
app.get('/', readRateLimit, async (c) => {
  const puuid = c.req.query('puuid');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  if (!puuid) {
    return c.json<ApiResponse>({ success: false, error: 'puuid is required' }, 400);
  }

  try {
    const result = await c.env.DB.prepare(`
      SELECT * FROM analyses
      WHERE puuid = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(puuid, limit, offset).all<Analysis>();

    // Parse JSON fields and transform snake_case to camelCase
    const analyses = result.results.map((a: Record<string, unknown>) => ({
      id: a.id,
      matchId: a.match_id,
      puuid: a.puuid,
      region: a.region,
      status: a.status,
      progress: a.progress ?? (a.status === 'completed' ? 100 : a.status === 'processing' ? 0 : null),
      progressMessage: a.progress_message ?? null,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      completedAt: a.completed_at,
      champion: a.champion,
      result: a.result,
      duration: a.duration,
      gameMode: a.game_mode,
      kills: a.kills,
      deaths: a.deaths,
      assists: a.assists,
      role: a.role,
      errorMessage: a.error_message,
      stats: a.stats ? JSON.parse(a.stats as string) : null,
      errors: a.errors ? JSON.parse(a.errors as string) : null,
      tips: a.tips ? JSON.parse(a.tips as string) : null,
      clips: a.clips ? JSON.parse(a.clips as string) : null,
    }));

    return c.json<ApiResponse<Analysis[]>>({
      success: true,
      data: analyses,
    });
  } catch (error) {
    console.error('Failed to fetch analyses:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch analyses' }, 500);
  }
});

// GET /analysis/:id - Get single analysis
app.get('/:id', readRateLimit, async (c) => {
  const id = c.req.param('id');

  try {
    const result = await c.env.DB.prepare(`
      SELECT * FROM analyses WHERE id = ?
    `).bind(id).first<Analysis>();

    if (!result) {
      return c.json<ApiResponse>({ success: false, error: 'Analysis not found' }, 404);
    }

    // Parse JSON fields and transform snake_case to camelCase
    const a = result as unknown as Record<string, unknown>;
    const analysis = {
      id: a.id,
      matchId: a.match_id,
      puuid: a.puuid,
      region: a.region,
      status: a.status,
      progress: a.progress ?? (a.status === 'completed' ? 100 : a.status === 'processing' ? 0 : null),
      progressMessage: a.progress_message ?? null,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      completedAt: a.completed_at,
      champion: a.champion,
      result: a.result,
      duration: a.duration,
      gameMode: a.game_mode,
      kills: a.kills,
      deaths: a.deaths,
      assists: a.assists,
      role: a.role,
      errorMessage: a.error_message,
      stats: a.stats ? JSON.parse(a.stats as string) : null,
      errors: a.errors ? JSON.parse(a.errors as string) : null,
      tips: a.tips ? JSON.parse(a.tips as string) : null,
      clips: a.clips ? JSON.parse(a.clips as string) : null,
    };

    return c.json<ApiResponse>({
      success: true,
      data: analysis,
    });
  } catch (error) {
    console.error('Failed to fetch analysis:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch analysis' }, 500);
  }
});

// GET /analysis/match/:matchId - Get analysis by match ID
app.get('/match/:matchId', readRateLimit, async (c) => {
  const matchId = c.req.param('matchId');

  try {
    const result = await c.env.DB.prepare(`
      SELECT * FROM analyses WHERE match_id = ?
    `).bind(matchId).first<Analysis>();

    if (!result) {
      return c.json<ApiResponse>({ success: false, error: 'Analysis not found' }, 404);
    }

    // Parse JSON fields and transform snake_case to camelCase
    const a = result as unknown as Record<string, unknown>;
    const analysis = {
      id: a.id,
      matchId: a.match_id,
      puuid: a.puuid,
      region: a.region,
      status: a.status,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      completedAt: a.completed_at,
      champion: a.champion,
      result: a.result,
      duration: a.duration,
      gameMode: a.game_mode,
      kills: a.kills,
      deaths: a.deaths,
      assists: a.assists,
      role: a.role,
      errorMessage: a.error_message,
      stats: a.stats ? JSON.parse(a.stats as string) : null,
      errors: a.errors ? JSON.parse(a.errors as string) : null,
      tips: a.tips ? JSON.parse(a.tips as string) : null,
      clips: a.clips ? JSON.parse(a.clips as string) : null,
    };

    return c.json<ApiResponse<Analysis>>({
      success: true,
      data: analysis,
    });
  } catch (error) {
    console.error('Failed to fetch analysis:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to fetch analysis' }, 500);
  }
});

// POST /analysis - Create new analysis request (does NOT auto-start)
app.post('/', analysisRateLimit, zValidator('json', createAnalysisSchema), async (c) => {
  const { matchId, puuid, region, matchData } = c.req.valid('json');

  try {
    // Check if analysis already exists
    const existing = await c.env.DB.prepare(`
      SELECT id, status FROM analyses WHERE match_id = ?
    `).bind(matchId).first<{ id: string; status: string }>();

    if (existing) {
      return c.json<ApiResponse>({
        success: true,
        data: { id: existing.id, status: existing.status, existing: true },
      });
    }

    // Check if recording exists
    const recording = await c.env.DB.prepare(`
      SELECT id, video_key FROM recordings WHERE match_id = ?
    `).bind(matchId).first<{ id: string; video_key: string }>();

    if (!recording) {
      return c.json<ApiResponse>({
        success: false,
        error: 'No recording found for this match. Record your game with Nexra Vision first.',
      }, 400);
    }

    // Extract basic info for quick display
    const champion = matchData?.champion || null;
    const result = matchData?.win !== undefined ? (matchData.win ? 'win' : 'loss') : null;
    const duration = matchData?.duration || null;
    const gameMode = matchData?.gameMode || null;
    const kills = matchData?.kills || null;
    const deaths = matchData?.deaths || null;
    const assists = matchData?.assists || null;
    const role = matchData?.role || matchData?.teamPosition || null;

    // Create analysis record with all match data - stays in 'pending' status
    const analysisId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO analyses (id, match_id, puuid, region, status, champion, result, duration, game_mode, kills, deaths, assists, role, match_data)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      analysisId,
      matchId,
      puuid,
      region,
      champion,
      result,
      duration,
      gameMode,
      kills,
      deaths,
      assists,
      role,
      matchData ? JSON.stringify(matchData) : null
    ).run();

    // NOTE: Analysis is NOT auto-started. User must call POST /analysis/:id/start

    console.log(`Analysis created (pending): ${analysisId} for ${champion || 'unknown'} (${role || 'unknown role'})`);

    return c.json<ApiResponse>({
      success: true,
      data: { id: analysisId, status: 'pending', champion, role },
    }, 201);
  } catch (error) {
    console.error('Failed to create analysis:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to create analysis' }, 500);
  }
});

// POST /analysis/:id/start - Manually start analysis processing
app.post('/:id/start', requireAuth, analysisRateLimit, async (c) => {
  const id = c.req.param('id');

  try {
    // Get analysis record
    const analysis = await c.env.DB.prepare(`
      SELECT id, match_id, puuid, region, status, match_data FROM analyses WHERE id = ?
    `).bind(id).first<{ id: string; match_id: string; puuid: string; region: string; status: string; match_data: string | null }>();

    if (!analysis) {
      return c.json<ApiResponse>({ success: false, error: 'Analysis not found' }, 404);
    }

    // Check if already processing or completed
    if (analysis.status === 'processing') {
      return c.json<ApiResponse>({
        success: true,
        data: { id: analysis.id, status: 'processing', message: 'Analysis already in progress' },
      });
    }

    if (analysis.status === 'completed') {
      return c.json<ApiResponse>({
        success: true,
        data: { id: analysis.id, status: 'completed', message: 'Analysis already completed' },
      });
    }

    // Get recording info
    const recording = await c.env.DB.prepare(`
      SELECT video_key FROM recordings WHERE match_id = ?
    `).bind(analysis.match_id).first<{ video_key: string }>();

    if (!recording) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Recording not found for this analysis',
      }, 400);
    }

    // Parse match data if available
    let matchData = undefined;
    if (analysis.match_data) {
      try {
        matchData = JSON.parse(analysis.match_data);
      } catch { /* ignore */ }
    }

    // Queue the analysis job
    await c.env.ANALYSIS_QUEUE.send({
      analysisId: analysis.id,
      matchId: analysis.match_id,
      puuid: analysis.puuid,
      region: analysis.region,
      videoKey: recording.video_key,
      matchData,
    });

    // Update status to processing
    await c.env.DB.prepare(`
      UPDATE analyses SET status = 'processing', updated_at = datetime('now') WHERE id = ?
    `).bind(id).run();

    console.log(`Analysis started: ${id}`);

    return c.json<ApiResponse>({
      success: true,
      data: { id: analysis.id, status: 'processing', message: 'Analysis started' },
    });
  } catch (error) {
    console.error('Failed to start analysis:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to start analysis' }, 500);
  }
});

// POST /analysis/:id/reanalyze - Re-run analysis with updated AI
app.post('/:id/reanalyze', requireAuth, analysisRateLimit, async (c) => {
  const id = c.req.param('id');

  try {
    // Get existing analysis
    const existing = await c.env.DB.prepare(`
      SELECT id, match_id, puuid, region FROM analyses WHERE id = ?
    `).bind(id).first<{ id: string; match_id: string; puuid: string; region: string }>();

    if (!existing) {
      return c.json<ApiResponse>({ success: false, error: 'Analysis not found' }, 404);
    }

    // Get recording
    const recording = await c.env.DB.prepare(`
      SELECT video_key FROM recordings WHERE match_id = ?
    `).bind(existing.match_id).first<{ video_key: string }>();

    if (!recording) {
      return c.json<ApiResponse>({ success: false, error: 'Recording not found' }, 404);
    }

    // Reset analysis status
    await c.env.DB.prepare(`
      UPDATE analyses SET
        status = 'processing',
        stats = NULL,
        errors = NULL,
        tips = NULL,
        clips = NULL,
        error_message = NULL,
        completed_at = NULL,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(id).run();

    // Queue the analysis job again
    await c.env.ANALYSIS_QUEUE.send({
      analysisId: existing.id,
      matchId: existing.match_id,
      puuid: existing.puuid,
      region: existing.region,
      videoKey: recording.video_key,
    });

    return c.json<ApiResponse>({
      success: true,
      data: { id: existing.id, status: 'processing', message: 'Analysis restarted with updated AI' },
    });
  } catch (error) {
    console.error('Failed to reanalyze:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to restart analysis' }, 500);
  }
});

// DELETE /analysis/:id - Delete analysis
app.delete('/:id', requireAuth, analysisRateLimit, async (c) => {
  const id = c.req.param('id');

  try {
    // First check if it exists
    const existing = await c.env.DB.prepare(`
      SELECT id FROM analyses WHERE id = ?
    `).bind(id).first();

    if (!existing) {
      return c.json<ApiResponse>({ success: false, error: 'Analysis not found' }, 404);
    }

    await c.env.DB.prepare(`
      DELETE FROM analyses WHERE id = ?
    `).bind(id).run();

    return c.json<ApiResponse>({ success: true });
  } catch (error) {
    console.error('Failed to delete analysis:', error);
    return c.json<ApiResponse>({ success: false, error: 'Failed to delete analysis' }, 500);
  }
});

export default app;
