import Anthropic from '@anthropic-ai/sdk';
import { Env, AnalysisJob, AnalysisStats, GameError, CoachingTip, VideoClip, RiotMatchData } from '../types';
import { generateId } from '../utils/helpers';

interface DeathDetail {
  deathNumber: number;
  timestamp: number; // in seconds
  gamePhase: 'early' | 'mid' | 'late';
  killer: string;
  assistants: string[];
  wasGank: boolean;
  position: { x: number; y: number };
  zone: string;
  goldDiff: number;
  levelDiff: number;
  playerLevel: number;
  killerLevel: number;
}

interface MatchData {
  champion: string;
  result: 'win' | 'loss';
  duration: number;
  gameMode: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  visionScore: number;
  goldEarned: number;
  damageDealt: number;
  role: string;
  lane: string;
  timeline?: MatchTimeline;
  teamGold?: number;
  enemyTeamGold?: number;
  objectives?: {
    dragonKills: number;
    baronKills: number;
    heraldKills: number;
    turretKills: number;
  };
  deathTimestamps?: number[];
  // Extended data from nexra-vision
  wardsPlaced?: number;
  wardsKilled?: number;
  detectorWardsPlaced?: number;
  damageDealtToObjectives?: number;
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
  firstBloodKill?: boolean;
  firstTowerKill?: boolean;
  champLevel?: number;
  rank?: number;
  teammates?: Array<{ championName: string; kills: number; deaths: number; assists: number; role?: string; }>;
  enemies?: Array<{ championName: string; kills: number; deaths: number; assists: number; role?: string; }>;
  // New: Enhanced analysis data
  laneOpponent?: { championName: string; kills: number; deaths: number; assists: number; };
  matchupInfo?: string; // e.g., "Darius vs Garen - Darius favored"
  deathDetails?: DeathDetail[];
}

interface MatchTimeline {
  participantFrames: Array<{
    timestamp: number;
    gold: number;
    xp: number;
    cs: number;
    position: { x: number; y: number };
  }>;
  events: Array<{
    type: string;
    timestamp: number;
    killerId?: number;
    victimId?: number;
    position?: { x: number; y: number };
  }>;
}

interface PerformanceSummary {
  overallAssessment: string;
  strengths: string[];
  weaknesses: string[];
  improvementPlan: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
  };
}

// Get readable game mode from queueId
function getGameModeFromQueue(queueId?: number, gameMode?: string): string {
  const queueModes: Record<number, string> = {
    420: 'Ranked Solo/Duo',
    440: 'Ranked Flex',
    400: 'Normal Draft',
    430: 'Normal Blind',
    450: 'ARAM',
    900: 'URF',
    1020: 'One for All',
    1300: 'Nexus Blitz',
    1400: 'Ultimate Spellbook',
    0: 'Custom',
  };

  // If we have a queueId, use it
  if (queueId !== undefined && queueModes[queueId]) {
    return queueModes[queueId];
  }

  // Fallback to parsing gameMode string
  if (gameMode) {
    const mode = gameMode.toUpperCase();
    if (mode === 'ARAM') return 'ARAM';
    if (mode === 'URF' || mode === 'ARURF') return 'URF';
    if (mode === 'ONEFORALL') return 'One for All';
    if (mode === 'PRACTICETOOL') return 'Practice';
    if (mode.includes('RANKED')) return 'Ranked';
  }

  return gameMode || 'Classic';
}

// Convert RiotMatchData from nexra-vision to internal MatchData format
function convertRiotMatchData(riotData: RiotMatchData): MatchData {
  const cs = (riotData.totalMinionsKilled || 0) + (riotData.neutralMinionsKilled || 0);

  // Calculate team gold from teammates if available
  let teamGold = riotData.goldEarned || 0;
  let enemyTeamGold = 0;
  if (riotData.teammates) {
    teamGold += riotData.teammates.reduce((sum, t) => sum + (t.goldEarned || 0), 0);
  }
  if (riotData.enemies) {
    enemyTeamGold = riotData.enemies.reduce((sum, e) => sum + (e.goldEarned || 0), 0);
  }

  // Determine role
  const roleMap: Record<string, string> = {
    'TOP': 'TOP',
    'JUNGLE': 'JUNGLE',
    'MIDDLE': 'MID',
    'MID': 'MID',
    'BOTTOM': 'ADC',
    'ADC': 'ADC',
    'UTILITY': 'SUPPORT',
    'SUPPORT': 'SUPPORT',
  };
  const role = roleMap[riotData.role?.toUpperCase() || ''] ||
               roleMap[riotData.teamPosition?.toUpperCase() || ''] ||
               'UNKNOWN';

  // Get proper game mode from queueId
  const gameMode = getGameModeFromQueue(riotData.queueId, riotData.gameMode);

  return {
    champion: riotData.champion || 'Unknown',
    result: riotData.win ? 'win' : 'loss',
    duration: riotData.duration || 0,
    gameMode,
    kills: riotData.kills || 0,
    deaths: riotData.deaths || 0,
    assists: riotData.assists || 0,
    cs,
    visionScore: riotData.visionScore || 0,
    goldEarned: riotData.goldEarned || 0,
    damageDealt: riotData.totalDamageDealtToChampions || 0,
    role,
    lane: riotData.lane || 'UNKNOWN',
    teamGold,
    enemyTeamGold,
    // Extended data
    wardsPlaced: riotData.wardsPlaced,
    wardsKilled: riotData.wardsKilled,
    detectorWardsPlaced: riotData.detectorWardsPlaced,
    damageDealtToObjectives: riotData.damageDealtToObjectives,
    doubleKills: riotData.doubleKills,
    tripleKills: riotData.tripleKills,
    quadraKills: riotData.quadraKills,
    pentaKills: riotData.pentaKills,
    firstBloodKill: riotData.firstBloodKill,
    firstTowerKill: riotData.firstTowerKill,
    champLevel: riotData.champLevel,
    rank: riotData.rank,
    teammates: riotData.teammates?.map(t => ({
      championName: t.championName,
      kills: t.kills,
      deaths: t.deaths,
      assists: t.assists,
    })),
    enemies: riotData.enemies?.map(e => ({
      championName: e.championName,
      kills: e.kills,
      deaths: e.deaths,
      assists: e.assists,
    })),
  };
}

// Stored clip metadata from recording
interface StoredClip {
  id: string;
  index: number;
  type: string;
  description: string;
  startTime: number;
  endTime: number;
  severity: string;
  frameKeys: string[];
  frameCount: number;
}

// Analyze video clips with Claude Vision
async function analyzeClipsWithVision(
  clips: StoredClip[],
  matchData: MatchData,
  env: Env
): Promise<Array<{
  clipIndex: number;
  type: string;
  timestamp: number;
  visualAnalysis: string;
  detectedErrors: string[];
  suggestions: string[];
}>> {
  const anthropic = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
  });

  const clipAnalyses = [];

  for (const clip of clips) {
    try {
      // Load frames from R2
      const frameImages: Array<{ type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }> = [];

      for (const frameKey of clip.frameKeys.slice(0, 5)) { // Max 5 frames per clip
        const frame = await env.VIDEOS.get(frameKey);
        if (frame) {
          const arrayBuffer = await frame.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
          frameImages.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64,
            },
          });
        }
      }

      if (frameImages.length === 0) {
        console.log(`No frames found for clip ${clip.index}, skipping vision analysis`);
        continue;
      }

      console.log(`Analyzing clip ${clip.index} with ${frameImages.length} frames...`);

      // Create vision prompt
      const visionPrompt = `Tu es un coach professionnel de League of Legends qui analyse une séquence vidéo d'un joueur.

CONTEXTE:
- Champion joué: ${matchData.champion} (${matchData.role})
- Type de moment: ${clip.type} (${clip.description})
- Timestamp: ${Math.floor(clip.startTime / 60)}:${(clip.startTime % 60).toString().padStart(2, '0')}
- Durée de la game: ${Math.floor(matchData.duration / 60)} minutes

ANALYSE LES IMAGES:
Ces ${frameImages.length} images sont extraites d'un moment clé de la partie. Analyse:

1. **Position du joueur** - Où est-il sur la map? Est-ce une bonne position pour son rôle?
2. **État du combat** - Y a-t-il un fight? Le joueur est-il en danger?
3. **Minimap** (si visible) - Où sont les alliés/ennemis?
4. **Erreurs visibles** - Qu'est-ce qui a mal tourné?
5. **Ce qu'il aurait dû faire** - Quelle était la bonne décision?

RÉPONDS EN JSON:
{
  "situationDescription": "Description de ce qui se passe dans les images",
  "playerPosition": "Bonne/Mauvaise - explication",
  "detectedErrors": ["Erreur 1", "Erreur 2"],
  "whatShouldHaveDone": "Ce que le joueur aurait dû faire",
  "coachingTip": "Conseil spécifique pour ${matchData.champion} ${matchData.role}"
}`;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              ...frameImages,
              { type: 'text', text: visionPrompt },
            ],
          },
        ],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        try {
          const jsonMatch = content.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            clipAnalyses.push({
              clipIndex: clip.index,
              type: clip.type,
              timestamp: clip.startTime,
              visualAnalysis: analysis.situationDescription || '',
              detectedErrors: analysis.detectedErrors || [],
              suggestions: [analysis.whatShouldHaveDone, analysis.coachingTip].filter(Boolean),
            });
          }
        } catch (parseErr) {
          console.error(`Failed to parse vision response for clip ${clip.index}`);
        }
      }

      // Add small delay between clips to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (err) {
      console.error(`Vision analysis failed for clip ${clip.index}:`, err);
    }
  }

  return clipAnalyses;
}

// Helper to update analysis progress
async function updateProgress(env: Env, analysisId: string, progress: number, message: string): Promise<void> {
  await env.DB.prepare(`
    UPDATE analyses SET progress = ?, progress_message = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(progress, message, analysisId).run();
  console.log(`[${analysisId}] Progress: ${progress}% - ${message}`);
}

// Process analysis job from queue
export async function processAnalysisJob(job: AnalysisJob, env: Env): Promise<void> {
  console.log(`Processing analysis job: ${job.analysisId}`);

  try {
    // Start progress tracking
    await updateProgress(env, job.analysisId, 5, 'Initialisation...');

    let matchData: MatchData | null = null;

    // 1. First, try to use match data sent by nexra-vision (preferred)
    await updateProgress(env, job.analysisId, 10, 'Chargement des données de match...');
    if (job.matchData && job.matchData.champion) {
      console.log('Using match data from nexra-vision');
      matchData = convertRiotMatchData(job.matchData);
      console.log(`Match data: ${matchData.champion} ${matchData.role} (${matchData.kills}/${matchData.deaths}/${matchData.assists})`);
    }
    // 2. Fallback: Fetch from Riot API if not provided and it's a real match
    else if (!job.matchId.startsWith('NEXRA_')) {
      try {
        console.log('Fetching match data from Riot API...');
        matchData = await fetchMatchData(job.matchId, job.puuid, job.region, env);
        console.log(`Got match data from Riot API: ${matchData.champion} ${matchData.role}`);
      } catch (err) {
        console.log('Could not fetch from Riot API, using video-only analysis');
      }
    } else {
      console.log('Practice/Custom game detected, using video-only analysis');
    }

    // 3. If we have match data, update the analysis record
    if (matchData) {
      await env.DB.prepare(`
        UPDATE analyses SET
          champion = ?,
          result = ?,
          duration = ?,
          game_mode = ?,
          kills = ?,
          deaths = ?,
          assists = ?,
          role = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        matchData.champion,
        matchData.result,
        matchData.duration,
        matchData.gameMode,
        matchData.kills,
        matchData.deaths,
        matchData.assists,
        matchData.role,
        job.analysisId
      ).run();
    } else {
      // Use placeholder data for practice/custom games
      matchData = {
        champion: 'Unknown',
        result: 'win',
        duration: 600,
        gameMode: 'Practice Tool',
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        visionScore: 0,
        goldEarned: 0,
        damageDealt: 0,
        role: 'UNKNOWN',
        lane: 'UNKNOWN',
      };

      await env.DB.prepare(`
        UPDATE analyses SET
          game_mode = 'Practice Tool',
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(job.analysisId).run();
    }

    // 3. Check for video clips and analyze with Vision
    await updateProgress(env, job.analysisId, 25, 'Recherche des clips vidéo...');
    let visionAnalysis: Awaited<ReturnType<typeof analyzeClipsWithVision>> = [];

    // Try to get clips from the recording
    const recording = await env.DB.prepare(`
      SELECT clips FROM recordings WHERE match_id = ?
    `).bind(job.matchId).first<{ clips: string | null }>();

    if (recording?.clips) {
      const storedClips: StoredClip[] = JSON.parse(recording.clips);
      if (storedClips.length > 0) {
        await updateProgress(env, job.analysisId, 30, `Analyse de ${storedClips.length} clips vidéo...`);
        console.log(`Found ${storedClips.length} video clips, analyzing with Vision...`);
        visionAnalysis = await analyzeClipsWithVision(storedClips, matchData, env);
        console.log(`Vision analysis complete: ${visionAnalysis.length} clips analyzed`);
        await updateProgress(env, job.analysisId, 55, 'Clips analysés avec succès');
      }
    } else {
      await updateProgress(env, job.analysisId, 40, 'Pas de clips vidéo trouvés');
    }

    // 4. Analyze with Claude AI (including vision analysis results)
    await updateProgress(env, job.analysisId, 60, 'Analyse IA en cours avec Claude...');
    const analysis = await analyzeWithClaude(matchData, job, env, visionAnalysis, job.language || 'en');
    await updateProgress(env, job.analysisId, 90, 'Analyse IA terminée, sauvegarde...');

    // 5. Store results
    await env.DB.prepare(`
      UPDATE analyses SET
        status = 'completed',
        progress = 100,
        progress_message = 'Analyse terminée',
        stats = ?,
        errors = ?,
        tips = ?,
        clips = ?,
        completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      JSON.stringify(analysis.stats),
      JSON.stringify(analysis.errors),
      JSON.stringify(analysis.tips),
      JSON.stringify(analysis.clips),
      job.analysisId
    ).run();

    console.log(`Analysis completed: ${job.analysisId}`);
  } catch (error) {
    console.error(`Analysis failed: ${job.analysisId}`, error);

    // Mark as failed
    await env.DB.prepare(`
      UPDATE analyses SET
        status = 'failed',
        error_message = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      error instanceof Error ? error.message : 'Unknown error',
      job.analysisId
    ).run();

    throw error;
  }
}

// Get map zone from coordinates
function getZoneName(x: number, y: number, playerTeamId: number): string {
  const isBlueTeam = playerTeamId === 100;

  // River zones
  if ((x > 4000 && x < 11000 && y > 4000 && y < 11000) && Math.abs(x - (15000 - y)) < 3000) {
    if (x < 6000 && y < 6000) return 'Dragon pit';
    if (x > 9000 && y > 9000) return 'Baron pit';
    if (y < 7500) return 'River (bot side)';
    return 'River (top side)';
  }

  // Blue side jungle
  if (x < 7000 && y < 7000 && !(x < 3000 && y < 3000)) {
    return isBlueTeam ? 'Allied jungle (blue side)' : 'Enemy jungle (blue side)';
  }

  // Red side jungle
  if (x > 8000 && y > 8000 && !(x > 12000 && y > 12000)) {
    return isBlueTeam ? 'Enemy jungle (red side)' : 'Allied jungle (red side)';
  }

  // Lanes
  if (Math.abs(x - y) < 2000) return 'Mid lane';
  if (y > x + 2000) return 'Top lane';
  if (x > y + 2000) return 'Bot lane';

  // Bases
  if (x < 3000 && y < 3000) return isBlueTeam ? 'Allied base' : 'Enemy base';
  if (x > 12000 && y > 12000) return isBlueTeam ? 'Enemy base' : 'Allied base';

  return 'Unknown area';
}

function getGamePhaseFromTimestamp(timestampMs: number): 'early' | 'mid' | 'late' {
  const minutes = timestampMs / 60000;
  if (minutes < 14) return 'early';
  if (minutes < 25) return 'mid';
  return 'late';
}

// Fetch match data from Riot API with timeline
async function fetchMatchData(matchId: string, puuid: string, region: string, env: Env): Promise<MatchData> {
  const regionRouting: Record<string, string> = {
    'EUW1': 'europe',
    'EUN1': 'europe',
    'NA1': 'americas',
    'KR': 'asia',
    'JP1': 'asia',
  };

  const routingRegion = regionRouting[region] || 'europe';
  const apiUrl = `https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
  const timelineUrl = `https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`;

  // Fetch match data and timeline in parallel
  const [matchResponse, timelineResponse] = await Promise.all([
    fetch(apiUrl, { headers: { 'X-Riot-Token': env.RIOT_API_KEY } }),
    fetch(timelineUrl, { headers: { 'X-Riot-Token': env.RIOT_API_KEY } })
  ]);

  if (!matchResponse.ok) {
    throw new Error(`Failed to fetch match data: ${matchResponse.status}`);
  }

  const data = await matchResponse.json() as {
    info: {
      gameDuration: number;
      gameMode: string;
      queueId: number;
      participants: Array<{
        puuid: string;
        participantId: number;
        championName: string;
        win: boolean;
        kills: number;
        deaths: number;
        assists: number;
        totalMinionsKilled: number;
        neutralMinionsKilled: number;
        visionScore: number;
        goldEarned: number;
        totalDamageDealtToChampions: number;
        teamPosition: string;
        lane: string;
        role: string;
        teamId: number;
        champLevel: number;
      }>;
      teams: Array<{
        teamId: number;
        objectives: {
          dragon: { kills: number };
          baron: { kills: number };
          riftHerald: { kills: number };
          tower: { kills: number };
        };
      }>;
    };
  };

  // Find the player by puuid
  const participant = data.info.participants.find(p => p.puuid === puuid) || data.info.participants[0];
  const playerTeam = data.info.teams.find(t => t.teamId === participant.teamId);
  const playerParticipantId = participant.participantId;

  // Calculate team gold totals
  const playerTeamParticipants = data.info.participants.filter(p => p.teamId === participant.teamId);
  const enemyTeamParticipants = data.info.participants.filter(p => p.teamId !== participant.teamId);
  const teamGold = playerTeamParticipants.reduce((sum, p) => sum + p.goldEarned, 0);
  const enemyTeamGold = enemyTeamParticipants.reduce((sum, p) => sum + p.goldEarned, 0);

  // Map Riot role to readable format
  const roleMap: Record<string, string> = {
    'TOP': 'TOP',
    'JUNGLE': 'JUNGLE',
    'MIDDLE': 'MID',
    'BOTTOM': 'ADC',
    'UTILITY': 'SUPPORT',
    '': 'UNKNOWN',
  };

  // Find lane opponent (same role on enemy team)
  const playerRole = participant.teamPosition;
  const laneOpponent = enemyTeamParticipants.find(p => p.teamPosition === playerRole);

  // Build teammates and enemies with roles
  const teammates = playerTeamParticipants
    .filter(p => p.puuid !== puuid)
    .map(p => ({
      championName: p.championName,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      role: roleMap[p.teamPosition] || p.teamPosition || 'UNKNOWN',
    }));

  const enemies = enemyTeamParticipants.map(p => ({
    championName: p.championName,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    role: roleMap[p.teamPosition] || p.teamPosition || 'UNKNOWN',
  }));

  // Extract death details from timeline
  let deathDetails: DeathDetail[] = [];

  if (timelineResponse.ok) {
    const timelineData = await timelineResponse.json() as {
      info: {
        frames: Array<{
          timestamp: number;
          participantFrames: Record<string, {
            participantId: number;
            totalGold: number;
            level: number;
            position: { x: number; y: number };
          }>;
          events: Array<{
            type: string;
            timestamp: number;
            killerId?: number;
            victimId?: number;
            assistingParticipantIds?: number[];
            position?: { x: number; y: number };
          }>;
        }>;
      };
    };

    let deathNumber = 0;
    for (const frame of timelineData.info.frames) {
      for (const event of frame.events) {
        if (event.type === 'CHAMPION_KILL' && event.victimId === playerParticipantId) {
          deathNumber++;

          const killer = data.info.participants.find(p => p.participantId === event.killerId);
          const assistants = (event.assistingParticipantIds || [])
            .map(id => data.info.participants.find(p => p.participantId === id)?.championName)
            .filter((name): name is string => !!name);

          const position = event.position || { x: 7500, y: 7500 };
          const zone = getZoneName(position.x, position.y, participant.teamId);

          // Get gold/level at time of death
          const frameIndex = Math.floor(event.timestamp / 60000);
          const currentFrame = timelineData.info.frames[frameIndex] || frame;
          const playerFrame = currentFrame.participantFrames[playerParticipantId.toString()];
          const killerFrame = event.killerId ? currentFrame.participantFrames[event.killerId.toString()] : null;

          const goldDiff = playerFrame && killerFrame
            ? playerFrame.totalGold - killerFrame.totalGold
            : 0;
          const levelDiff = playerFrame && killerFrame
            ? playerFrame.level - killerFrame.level
            : 0;

          deathDetails.push({
            deathNumber,
            timestamp: Math.floor(event.timestamp / 1000),
            gamePhase: getGamePhaseFromTimestamp(event.timestamp),
            killer: killer?.championName || 'Unknown',
            assistants,
            wasGank: assistants.length >= 1,
            position,
            zone,
            goldDiff,
            levelDiff,
            playerLevel: playerFrame?.level || 1,
            killerLevel: killerFrame?.level || 1,
          });
        }
      }
    }
  }

  // Generate matchup info
  let matchupInfo: string | undefined;
  if (laneOpponent) {
    matchupInfo = `${participant.championName} vs ${laneOpponent.championName} in ${roleMap[playerRole] || playerRole}`;
  }

  return {
    champion: participant.championName,
    result: participant.win ? 'win' : 'loss',
    duration: data.info.gameDuration,
    gameMode: getGameModeFromQueue(data.info.queueId, data.info.gameMode),
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
    visionScore: participant.visionScore,
    goldEarned: participant.goldEarned,
    damageDealt: participant.totalDamageDealtToChampions,
    role: roleMap[participant.teamPosition] || participant.teamPosition || 'UNKNOWN',
    lane: participant.lane,
    teamGold,
    enemyTeamGold,
    objectives: playerTeam ? {
      dragonKills: playerTeam.objectives.dragon.kills,
      baronKills: playerTeam.objectives.baron.kills,
      heraldKills: playerTeam.objectives.riftHerald.kills,
      turretKills: playerTeam.objectives.tower.kills,
    } : undefined,
    teammates,
    enemies,
    laneOpponent: laneOpponent ? {
      championName: laneOpponent.championName,
      kills: laneOpponent.kills,
      deaths: laneOpponent.deaths,
      assists: laneOpponent.assists,
    } : undefined,
    matchupInfo,
    deathDetails,
    champLevel: participant.champLevel,
  };
}

// Role-specific coaching context with detailed benchmarks and priorities
function getRoleContext(role: string, matchData: MatchData): string {
  const gameDurationMinutes = Math.floor(matchData.duration / 60);
  const csPerMin = matchData.duration > 0 ? (matchData.cs / (matchData.duration / 60)).toFixed(1) : '0';
  const dpm = matchData.duration > 0 ? Math.round(matchData.damageDealt / (matchData.duration / 60)) : 0;

  const contexts: Record<string, string> = {
    'TOP': `## ANALYSE SPÉCIFIQUE TOPLANER

### BENCHMARKS TOPLANER (comparés à tes stats)
| Métrique | Bronze-Silver | Gold-Plat | Diamond+ | TES STATS |
|----------|---------------|-----------|----------|-----------|
| CS/min | 5.5-6.5 | 7.0-7.5 | 8.0+ | ${csPerMin} ${parseFloat(csPerMin) < 6.5 ? '⚠️ INSUFFISANT' : parseFloat(csPerMin) >= 8 ? '✅ EXCELLENT' : '➡️ Correct'} |
| Vision Score | 15-20 | 25-35 | 40+ | ${matchData.visionScore} ${matchData.visionScore < 20 ? '⚠️ TROP BAS' : '➡️ OK'} |
| Deaths | 5-7 | 3-5 | 2-4 | ${matchData.deaths} ${matchData.deaths > 5 ? '⚠️ TROP DE MORTS' : '➡️ OK'} |
| DPM | 400-500 | 500-600 | 600+ | ${dpm} |

### ERREURS TYPIQUES TOPLANER À DÉTECTER
1. **Mort en 1v1 évitable** - Trade forcé sans avantage ou sous le niveau de puissance
2. **Gank subi sans vision** - Push sans ward, position avancée sans info jungler
3. **TP mal utilisé** - TP pour farm au lieu de rejoindre un fight décisif bot/drake
4. **Herald ignoré** - Aucune pression sur Herald entre 8-14 min
5. **Split push sans vision** - Push profond sans wards = mort certaine
6. **Mauvais wave management** - Freeze cassé, slow push mal exécuté, back au mauvais moment

### RESPONSABILITÉS TOPLANER
- Tu es souvent en 1v1 isolé → la gestion des waves est CRUCIALE
- Le Herald est TON objectif prioritaire (min 8-14)
- Tu dois créer de la pression split push pour attirer l'attention ennemie
- Ton TP doit être utilisé pour rejoindre les teamfights bot ou contester Drake
- Tu dois tracker le jungler ennemi car tu es vulnérable aux ganks
- En late game: soit split push avec vision, soit groupé avec l'équipe - JAMAIS entre les deux

### POINTS CLÉS À ANALYSER POUR CE TOPLANER
- Combien de morts dues à des ganks non détectés?
- Le TP a-t-il été utilisé pour des objectifs ou gaspillé?
- A-t-il participé au Herald?
- Son CS montre-t-il une bonne gestion de wave?`,

    'JUNGLE': `## ANALYSE SPÉCIFIQUE JUNGLER

### BENCHMARKS JUNGLER (comparés à tes stats)
| Métrique | Bronze-Silver | Gold-Plat | Diamond+ | TES STATS |
|----------|---------------|-----------|----------|-----------|
| CS/min (camps) | 4.5-5.0 | 5.5-6.0 | 6.5+ | ${csPerMin} ${parseFloat(csPerMin) < 5 ? '⚠️ FARM LENTE' : parseFloat(csPerMin) >= 6 ? '✅ BON FARM' : '➡️ Correct'} |
| Vision Score | 25-35 | 40-50 | 55+ | ${matchData.visionScore} ${matchData.visionScore < 30 ? '⚠️ VISION INSUFFISANTE' : '✅ OK'} |
| Deaths | 4-6 | 3-5 | 2-4 | ${matchData.deaths} ${matchData.deaths > 5 ? '⚠️ TROP DE MORTS' : '➡️ OK'} |
| Kill Participation | 40-50% | 55-65% | 70%+ | À estimer |

### ERREURS TYPIQUES JUNGLER À DÉTECTER
1. **Objectif perdu sans contest** - Dragon/Herald donné gratuitement
2. **Pathing inefficace** - Camps laissés, temps perdu à errer
3. **Gank forcé** - Gank une lane poussée sous tour ennemie = échec garanti
4. **Pas de track jungler ennemi** - Se faire contre-jungle sans réagir
5. **Mort avant objectif** - Mourir 30-60 sec avant Drake/Baron = auto-lose objectif
6. **Mauvais smite** - Baron/Drake volé ou raté

### RESPONSABILITÉS JUNGLER
- Tu es le CHEF D'ORCHESTRE de la macro - tu dictes le tempo de la partie
- La vision autour des objectifs est TA responsabilité principale
- Tu dois tracker le jungler ennemi et contester ses camps quand possible
- Les timings de gank doivent être optimaux (après push allié, summoners ennemis down)
- PRIORISATION: Objectifs > Contre-gank > Gank > Farm
- Herald avant 14 min, Drake Soul est WIN CONDITION

### POINTS CLÉS À ANALYSER POUR CE JUNGLER
- Combien d'objectifs majeurs sécurisés vs perdus?
- Le pathing était-il efficace (camps up = mauvais pathing)?
- Les ganks étaient-ils sur des lanes gankables?
- A-t-il été présent pour les objectifs?`,

    'MID': `## ANALYSE SPÉCIFIQUE MIDLANER

### BENCHMARKS MIDLANER (comparés à tes stats)
| Métrique | Bronze-Silver | Gold-Plat | Diamond+ | TES STATS |
|----------|---------------|-----------|----------|-----------|
| CS/min | 6.0-7.0 | 7.5-8.5 | 9.0+ | ${csPerMin} ${parseFloat(csPerMin) < 7 ? '⚠️ CS À AMÉLIORER' : parseFloat(csPerMin) >= 8.5 ? '✅ EXCELLENT' : '➡️ Correct'} |
| Vision Score | 20-25 | 30-40 | 45+ | ${matchData.visionScore} ${matchData.visionScore < 25 ? '⚠️ PLUS DE WARDS' : '➡️ OK'} |
| Deaths | 4-6 | 3-5 | 2-4 | ${matchData.deaths} ${matchData.deaths > 5 ? '⚠️ TROP DE MORTS' : '➡️ OK'} |
| DPM | 450-550 | 550-700 | 750+ | ${dpm} ${dpm < 500 ? '⚠️ DPM BAS' : dpm >= 700 ? '✅ BON DPM' : '➡️ OK'} |

### ERREURS TYPIQUES MIDLANER À DÉTECTER
1. **Roam raté** - Roam sans push préalable = perte CS + raté
2. **Pas de prio pour jungler** - Lane perdue = jungler ne peut pas envahir
3. **Mort solo en lane** - Trade mal calculé ou gank non détecté
4. **Pas d'assistance objectifs** - Absent sur les contests drake/herald
5. **Mauvais positionnement teamfight** - Trop devant ou isolé
6. **Roam ennemi non suivi** - Pas de ping, pas de follow = teammates morts

### RESPONSABILITÉS MIDLANER
- Tu as le plus d'influence sur la map grâce à ta position centrale
- Tu dois ROAM pour aider tes sidelanes APRÈS avoir push ta wave
- Tu dois assister ton jungler sur les contests de scuttle et objectifs
- Ta prio de lane permet à ton jungler d'envahir
- En teamfight, ton positionnement et ton burst/DPS sont clés
- Tu dois tracker les roams ennemis et PING tes teammates

### POINTS CLÉS À ANALYSER POUR CE MIDLANER
- Les roams étaient-ils bien timés (après push)?
- A-t-il aidé son jungler sur les objectifs?
- Son DPM reflète-t-il une présence dans les fights?
- Les morts étaient-elles en lane ou en roam?`,

    'ADC': `## ANALYSE SPÉCIFIQUE ADC

### BENCHMARKS ADC (comparés à tes stats)
| Métrique | Bronze-Silver | Gold-Plat | Diamond+ | TES STATS |
|----------|---------------|-----------|----------|-----------|
| CS/min | 6.5-7.5 | 8.0-9.0 | 9.5+ | ${csPerMin} ${parseFloat(csPerMin) < 7.5 ? '⚠️ CS CRITIQUE' : parseFloat(csPerMin) >= 9 ? '✅ EXCELLENT' : '➡️ Correct'} |
| Deaths | 4-6 | 3-5 | 2-4 | ${matchData.deaths} ${matchData.deaths > 5 ? '⚠️ SURVIE CRITIQUE' : matchData.deaths <= 3 ? '✅ BONNE SURVIE' : '➡️ OK'} |
| DPM | 500-600 | 650-800 | 850+ | ${dpm} ${dpm < 550 ? '⚠️ DPM TRÈS BAS' : dpm >= 750 ? '✅ BON DPM' : '➡️ OK'} |
| Vision Score | 15-20 | 20-30 | 30+ | ${matchData.visionScore} |

### ERREURS TYPIQUES ADC À DÉTECTER
1. **Mort en teamfight par mauvais positionnement** - Trop avancé, pas derrière le frontline
2. **Facecheck sans vision** - JAMAIS facecheck en tant qu'ADC
3. **Absent sur Drake** - Ton DPS est crucial pour secure Drake
4. **Farm side lane sans vision** - Push seul = cible facile
5. **Mauvais target en teamfight** - Focus le tank au lieu du carry accessible
6. **Kiting insuffisant** - Pas d'utilisation d'auto-attack move

### RESPONSABILITÉS ADC
- Ta SURVIE est la priorité absolue - un ADC mort = 0 DPS pour l'équipe
- Tu dois farm de manière efficace ET safe (objectif 8+ CS/min)
- Tu dois être présent pour CHAQUE Drake (ton DPS est crucial pour secure)
- En teamfight, reste TOUJOURS DERRIÈRE ton frontline et kite
- Ne jamais facecheck sans vision - c'est le job du support
- Ton positionnement en late game DÉCIDE des teamfights

### POINTS CLÉS À ANALYSER POUR CET ADC
- Les morts étaient-elles dues à un mauvais positionnement?
- Le DPM est-il cohérent avec le temps passé en vie?
- A-t-il été présent pour les Drakes?
- Le CS montre-t-il un farming efficace?`,

    'SUPPORT': `## ANALYSE SPÉCIFIQUE SUPPORT

### BENCHMARKS SUPPORT (comparés à tes stats)
| Métrique | Bronze-Silver | Gold-Plat | Diamond+ | TES STATS |
|----------|---------------|-----------|----------|-----------|
| Vision Score | 35-45 | 50-65 | 75+ | ${matchData.visionScore} ${matchData.visionScore < 40 ? '⚠️ VISION CRITIQUE' : matchData.visionScore >= 60 ? '✅ EXCELLENT' : '➡️ Correct'} |
| Wards/min | 0.8-1.0 | 1.2-1.5 | 1.8+ | ${matchData.wardsPlaced ? (matchData.wardsPlaced / gameDurationMinutes).toFixed(1) : 'N/A'} |
| Deaths | 4-6 | 3-5 | 2-4 | ${matchData.deaths} ${matchData.deaths > 5 ? '⚠️ TROP DE MORTS' : '➡️ OK'} |
| Kill Participation | 50-60% | 65-75% | 80%+ | À estimer |

### ERREURS TYPIQUES SUPPORT À DÉTECTER
1. **Vision insuffisante** - Pas de wards avant objectifs, pink non utilisées
2. **Roam mal timé** - Laisser l'ADC 1v2 au mauvais moment
3. **Engage raté** - Engage sans follow-up ou en désavantage numérique
4. **Peel inexistant** - ADC meurt car non protégé
5. **Position trop avancée** - Support meurt en premier = équipe sans utility
6. **Pas de deny vision** - Sweeper non utilisé, wards ennemies non détruites

### RESPONSABILITÉS SUPPORT
- La VISION est ta responsabilité principale - tu dois contrôler la map
- Tu dois roam mid APRÈS avoir push la wave bot pour créer des avantages
- Tu dois PEEL ton ADC en teamfight - sa survie = ta priorité
- Le contrôle de vision autour de Drake/Baron est CRUCIAL
- Tu dois engager les fights au bon moment ou counter-engager
- Tu dois tracker les cooldowns ennemis et PING les dangers

### POINTS CLÉS À ANALYSER POUR CE SUPPORT
- Le vision score est-il suffisant pour le rôle?
- Les wards étaient-elles bien placées (objectifs, jungle)?
- L'ADC est-il mort par manque de peel?
- Les engages/disengage étaient-ils bien timés?`,

    'UNKNOWN': `Analyse générale applicable à tous les rôles. Les benchmarks standards s'appliquent.`,
  };

  return contexts[role] || contexts['UNKNOWN'];
}

// Vision analysis result type
interface VisionAnalysisResult {
  clipIndex: number;
  type: string;
  timestamp: number;
  visualAnalysis: string;
  detectedErrors: string[];
  suggestions: string[];
}

// Language names for prompt
const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  pt: 'Portuguese',
};

// Analyze match with Claude AI - Professional Coach Analysis
async function analyzeWithClaude(
  matchData: MatchData,
  job: AnalysisJob,
  env: Env,
  visionAnalysis: VisionAnalysisResult[] = [],
  language: string = 'en'
): Promise<{
  stats: AnalysisStats;
  errors: GameError[];
  tips: CoachingTip[];
  clips: VideoClip[];
}> {
  const anthropic = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
  });

  const gameDurationMinutes = Math.floor(matchData.duration / 60);
  const csPerMin = matchData.duration > 0 ? (matchData.cs / (matchData.duration / 60)).toFixed(1) : '0';
  const kda = ((matchData.kills + matchData.assists) / Math.max(1, matchData.deaths)).toFixed(2);
  const dpm = matchData.duration > 0 ? Math.round(matchData.damageDealt / (matchData.duration / 60)) : 0;

  const roleContext = getRoleContext(matchData.role, matchData);
  const outputLanguage = LANGUAGE_INSTRUCTIONS[language] || 'English';

  // Build vision analysis section if available
  let visionSection = '';
  if (visionAnalysis.length > 0) {
    visionSection = `

## VIDEO ANALYSIS AVAILABLE
AI analyzed ${visionAnalysis.length} video clips of key moments. Use this to enrich your analysis:

${visionAnalysis.map((v, i) => `
### Clip ${i + 1}: ${v.type} at ${Math.floor(v.timestamp / 60)}:${(v.timestamp % 60).toString().padStart(2, '0')}
- **What happened:** ${v.visualAnalysis}
- **Detected errors:** ${v.detectedErrors.join(', ') || 'No major errors'}
- **Suggestions:** ${v.suggestions.join(' | ') || 'N/A'}
`).join('\n')}

IMPORTANT: Integrate these visual observations into your errors and tips. Video errors are PROOF - use them for precision.
`;
  }

  // Professional Coach Prompt - Actionable feedback for ranking up
  const prompt = `You are an elite League of Legends coach who has trained professional players and helped thousands climb from Iron to Challenger. Your analysis style is:

1. **DIRECT & HONEST** - No sugarcoating, tell players exactly what they did wrong
2. **ACTIONABLE** - Every piece of feedback must have a clear action the player can take
3. **SPECIFIC** - Reference exact moments, stats, and situations from THIS game
4. **IMPACTFUL** - Focus on the 3-5 mistakes that cost the most LP, not minor details

**CRITICAL: ALL YOUR TEXT OUTPUT IN THE JSON RESPONSE MUST BE WRITTEN IN ${outputLanguage.toUpperCase()}.**
This includes all titles, descriptions, assessments, tips, coaching notes, and any other text content.
${visionSection}

## YOUR COACHING PHILOSOPHY
- Players don't improve by hearing "nice try" - they improve by understanding exactly what went wrong
- The goal is to help this player RANK UP, not to make them feel good
- Focus on PATTERNS that lose games repeatedly, not one-off mistakes
- Be specific: "You died at 14:23 by facechecking red buff with no vision" not "improve your vision"

## GOLDEN RULE: MAXIMUM PERSONALIZATION
Every piece of feedback must be SPECIFIC to THIS game:
- Reference EXACT moments (e.g., "at 12:30 when you took that fight bot lane")
- Use REAL stats (e.g., "with your ${matchData.deaths} deaths, 2 of which happened before Drake")
- Mention the CHAMPION played (e.g., "on ${matchData.champion}, you should have...")
- Compare to what SHOULD have happened (e.g., "instead of dying solo top, a reset would have...")

## PLAYER ROLE: ${matchData.role}
${roleContext}

## MATCH DATA TO USE IN YOUR FEEDBACK
- Champion: ${matchData.champion} (${matchData.role})
- Result: ${matchData.result === 'win' ? 'VICTORY' : 'DEFEAT'}
- Duration: ${gameDurationMinutes} minutes (${matchData.duration} seconds)
- KDA: ${matchData.kills}/${matchData.deaths}/${matchData.assists} (Ratio: ${kda})
- CS: ${matchData.cs} total (${csPerMin}/min) - ${matchData.role === 'JUNGLE' ? 'acceptable for jungler' : parseFloat(csPerMin) < 6 ? 'INSUFFICIENT, losing a lot of gold' : parseFloat(csPerMin) >= 8 ? 'excellent' : 'average'}
- Vision Score: ${matchData.visionScore}
- Total gold: ${matchData.goldEarned} (${Math.round(matchData.goldEarned / gameDurationMinutes)} gold/min)
- Damage: ${matchData.damageDealt} (${dpm} DPM) - ${matchData.role === 'SUPPORT' ? 'normal for support' : dpm < 400 ? 'VERY LOW, not present in fights' : dpm > 700 ? 'good damage output' : 'average'}
${matchData.damageDealtToObjectives ? `- Objective damage: ${matchData.damageDealtToObjectives}` : ''}
${matchData.objectives ? `- Team objectives: ${matchData.objectives.dragonKills} Dragons, ${matchData.objectives.baronKills} Barons, ${matchData.objectives.heraldKills} Heralds` : ''}
${matchData.teamGold && matchData.enemyTeamGold ? `- Game state: ${matchData.teamGold > matchData.enemyTeamGold ? 'your team was ahead by ' + (matchData.teamGold - matchData.enemyTeamGold) + ' gold' : 'your team was behind by ' + (matchData.enemyTeamGold - matchData.teamGold) + ' gold'}` : ''}
${matchData.champLevel ? `- Final level: ${matchData.champLevel}` : ''}
${matchData.rank ? `- In-game rank: ${matchData.rank}/10 ${matchData.rank <= 3 ? '(Top performer)' : matchData.rank >= 8 ? '(Underperforming)' : ''}` : ''}

${matchData.laneOpponent ? `### LANE MATCHUP
- **Your champion:** ${matchData.champion}
- **Lane opponent:** ${matchData.laneOpponent.championName} (${matchData.laneOpponent.kills}/${matchData.laneOpponent.deaths}/${matchData.laneOpponent.assists})
- **Matchup:** ${matchData.matchupInfo || 'Unknown matchup'}
Analyze this matchup: Was the player playing the matchup correctly? Did they respect enemy power spikes?` : ''}

### MULTIKILLS & HIGHLIGHTS
${matchData.firstBloodKill ? '- First Blood: YES' : ''}${matchData.firstTowerKill ? ' | First Tower: YES' : ''}
${matchData.doubleKills ? `- Double kills: ${matchData.doubleKills}` : ''}${matchData.tripleKills ? ` | Triple kills: ${matchData.tripleKills}` : ''}${matchData.quadraKills ? ` | Quadra kills: ${matchData.quadraKills}` : ''}${matchData.pentaKills ? ` | PENTAKILL: ${matchData.pentaKills}` : ''}

${matchData.teammates && matchData.teammates.length > 0 ? `### TEAM COMPOSITION (Your allies)
${matchData.teammates.map(t => `- ${t.championName} (${t.role || 'Unknown'}): ${t.kills}/${t.deaths}/${t.assists}`).join('\n')}` : ''}

${matchData.enemies && matchData.enemies.length > 0 ? `### ENEMY TEAM
${matchData.enemies.map(e => `- ${e.championName} (${e.role || 'Unknown'}): ${e.kills}/${e.deaths}/${e.assists}`).join('\n')}` : ''}

${matchData.deathDetails && matchData.deathDetails.length > 0 ? `### EXACT DEATH DETAILS (FROM GAME DATA - USE THESE!)
These are the REAL deaths from the game. Use this information to provide accurate analysis:

${matchData.deathDetails.map(d => {
  const minutes = Math.floor(d.timestamp / 60);
  const seconds = d.timestamp % 60;
  const timeStr = minutes + ':' + seconds.toString().padStart(2, '0');
  const gankInfo = d.wasGank ? '**GANK by ' + d.killer + (d.assistants.length > 0 ? ' + ' + d.assistants.join(', ') : '') + '**' : '1v1 vs ' + d.killer;
  const goldInfo = d.goldDiff > 0 ? '+' + d.goldDiff + ' gold ahead' : d.goldDiff < 0 ? d.goldDiff + ' gold behind' : 'even gold';
  return '**Death #' + d.deathNumber + '** at ' + timeStr + ' (' + d.gamePhase + ' game)\n  - ' + gankInfo + '\n  - Location: ' + d.zone + '\n  - Level: You (Lvl ' + d.playerLevel + ') vs Killer (Lvl ' + d.killerLevel + ') = ' + (d.levelDiff > 0 ? '+' + d.levelDiff : d.levelDiff) + ' level diff\n  - Gold state: ' + goldInfo + '\n  - Was this avoidable? Analyze the situation!';
}).join('\n\n')}

IMPORTANT: Use these EXACT death details in your deathsAnalysis. Do NOT invent deaths or change the details!` : ''}

## ANALYSIS REQUIRED
Based on these PRECISE stats, deduce what likely happened:

## ERROR TYPES TO DETECT (by priority)

### PRIORITY 1 — CRITICAL ERRORS (direct impact on victory)
1. **Major objectives mismanaged**
   - Dragon/Soul given away without contest while team is alive
   - Baron/Herald started without vision
   - Baron lost after winning a pick-off
   - Contesting objectives while outnumbered
   - No reset before a key objective

2. **Useless deaths before objectives**
   - Isolated death 30-90 seconds before Dragon/Baron
   - Facecheck without vision
   - Overextend without enemy information
   - Death in side lane without objective pressure

3. **Power spikes ignored or poorly exploited**
   - Key item completed without taking initiative
   - Fight forced before completing a major item
   - Late back delaying a power spike
   - Bad reset timing before an important fight

4. **Poor macro distribution on the map**
   - 5 players mid without an active objective
   - Bad split push (without cross-map pressure)
   - No player in side lane during mid/late game
   - Defense or push on the wrong lane

### PRIORITY 2 — MAJOR ERRORS (high situational impact)
5. **Insufficient vision around objectives**
   - No wards before Dragon/Baron
   - No sweep before contesting
   - Vision placed too late
   - Vision not defended

6. **Poor teamfight execution**
   - Bad target focus
   - Engage without follow-up
   - Carry out of position
   - Fight forced while outnumbered

7. **Bad back timings**
   - Back too late before an objective
   - Desynchronized backs between players
   - Fight without completed items
   - Defending objective without resources

### PRIORITY 3 — MODERATE ERRORS (cumulative impact)
8. **Poor wave management**
   - Push without vision
   - Waves not prepared before objective
   - Freeze broken unnecessarily
   - Waves lost without compensation

9. **Poor split push management**
   - Split without pressure elsewhere
   - Split too deep without vision
   - No TP or coverage
   - Bad regrouping timing

10. **Poor use of enemy timings**
    - Not exploiting a death timer
    - Not punishing an enemy back
    - No objective taken after an advantage

### PRIORITY 4 — MINOR ERRORS (filter, mention only if very recurrent)
11. Repeated unfavorable trades in lane
12. Poor use of summoner spells
13. Isolated individual inefficiency

## COACH RULES
- You are an EXPERIENCED coach: few feedbacks but HIGH IMPACT
- Focus on MACRO and STRATEGIC errors, not micro-plays
- EACH error must be related to the player's ROLE (${matchData.role})
- If the player died ${matchData.deaths} times, analyze WHY these deaths were avoidable
- A ${matchData.role} must NOT make the same mistakes as another role
- ALWAYS prioritize errors that cost objectives or the game

## SCORE CALCULATION GUIDELINES (MANDATORY - USE THESE FORMULAS!)
Calculate scores based on ACTUAL stats. Different performances MUST result in different scores.

### CS SCORE (csScore) - Role specific:
${matchData.role === 'SUPPORT' ? `- Support: CS doesn't matter, base score = 70
- Adjust based on roaming effectiveness and pressure created` : matchData.role === 'JUNGLE' ? `- Jungle benchmark: 5.5 CS/min = 50 points, 6.5+ = 80+, 7.5+ = 95+
- Player has ${csPerMin} CS/min → Calculate proportionally
- Below 4.5 = under 40 points` : `- Lane benchmark: 7.0 CS/min = 50 points, 8.5+ = 80+, 9.5+ = 95+
- Player has ${csPerMin} CS/min → Calculate proportionally
- Below 5.5 = under 40 points, Below 6.5 = under 50 points`}

### VISION SCORE (visionScore):
${matchData.role === 'SUPPORT' ? `- Support benchmark: 50 vision = 50 points, 70+ = 80+, 90+ = 95+
- Player has ${matchData.visionScore} → Calculate proportionally` : matchData.role === 'JUNGLE' ? `- Jungle benchmark: 35 vision = 50 points, 50+ = 75+, 65+ = 90+
- Player has ${matchData.visionScore} → Calculate proportionally` : `- Laner benchmark: 25 vision = 50 points, 35+ = 70+, 45+ = 85+
- Player has ${matchData.visionScore} → Calculate proportionally`}

### POSITIONING SCORE (positioningScore):
- Base: Start at 70
- Each AVOIDABLE death: -8 points (max -40)
- Each death from bad positioning (gank without vision, facecheck): -10 points
- Player has ${matchData.deaths} deaths → Analyze each death to calculate

### OBJECTIVE SCORE (objectiveScore):
- Base: 50 if loss, 65 if win
- +10 if team got Dragon Soul / +5 per dragon
- +15 if Baron secured / -10 if Baron thrown
- Adjust based on player's contribution (${matchData.role} responsibility)

### MACRO SCORE (macroScore):
- Base: 50
- Good rotations, timings, wave management: +5 to +15 each
- Bad split push, AFK farming while team fights: -10 each
- Missing key objectives for no reason: -15

### OVERALL SCORE FORMULA:
overallScore = (csScore × ${matchData.role === 'SUPPORT' ? '0.05' : matchData.role === 'JUNGLE' ? '0.15' : '0.25'})
             + (visionScore × ${matchData.role === 'SUPPORT' ? '0.25' : '0.10'})
             + (positioningScore × 0.25)
             + (objectiveScore × ${matchData.role === 'JUNGLE' ? '0.25' : '0.15'})
             + (macroScore × ${matchData.role === 'SUPPORT' || matchData.role === 'JUNGLE' ? '0.25' : '0.25'})
             ${matchData.result === 'win' ? '+ 5 (win bonus)' : '- 5 (loss penalty)'}

KDA MODIFIER: KDA of ${kda}
- KDA >= 4.0: +5 to overall
- KDA >= 3.0: +2 to overall
- KDA < 1.5: -5 to overall
- KDA < 1.0: -10 to overall

DEATH PENALTY: ${matchData.deaths} deaths
- 0-2 deaths: +5 to overall
- 3-4 deaths: no modifier
- 5-6 deaths: -5 to overall
- 7+ deaths: -10 to overall

**IMPORTANT: The final overallScore MUST reflect the actual performance. A player with ${csPerMin} CS/min, ${matchData.deaths} deaths, ${kda} KDA cannot have the same score as someone with very different stats!**

## RESPONSE FORMAT (JSON) - MANDATORY PERSONALIZATION
{
  "stats": {
    "overallScore": <0-100 - CALCULATED using formulas above, not arbitrary>,
    "csScore": <0-100 - from CS calculation>,
    "visionScore": <0-100 - from vision calculation>,
    "positioningScore": <0-100 - from positioning/deaths calculation>,
    "objectiveScore": <0-100 - from objective calculation>,
    "macroScore": <0-100 - from macro calculation>,
    "deathsAnalyzed": ${matchData.deaths},
    "errorsFound": <number>,
    "comparedToRank": [
      {"metric": "CS/min", "yours": ${csPerMin}, "average": ${matchData.role === 'SUPPORT' ? '1.5' : matchData.role === 'JUNGLE' ? '5.5' : '7.0'}, "percentile": <0-100>},
      {"metric": "Vision Score", "yours": ${matchData.visionScore}, "average": ${matchData.role === 'SUPPORT' ? '50' : matchData.role === 'JUNGLE' ? '35' : '25'}, "percentile": <0-100>},
      {"metric": "KDA", "yours": ${kda}, "average": 2.5, "percentile": <0-100>},
      {"metric": "DPM", "yours": ${dpm}, "average": ${matchData.role === 'SUPPORT' ? '300' : matchData.role === 'ADC' ? '600' : '500'}, "percentile": <0-100>}
    ]
  },
  "errors": [
    {
      "id": "error-1",
      "type": "<objective|death-timing|power-spike|macro-positioning|vision|teamfight|back-timing|wave-management|split-push|timing-exploitation>",
      "severity": "<critical|high|medium|low>",
      "priority": <1-4>,
      "title": "<5 words max - impactful>",
      "description": "<PERSONALIZED! Reference specific moments, stats, champion, role>",
      "timestamp": <seconds>,
      "suggestion": "<PERSONALIZED! Specific actionable advice for this champion and role>",
      "clipStart": <seconds or null - ONLY for visual errors: deaths, fights, positioning. NOT for: vision, CS, wave management, itemization>,
      "clipEnd": <seconds or null - same rule as clipStart>,
      "coachingNote": "<PERSONALIZED! What a Challenger player would have done differently>",
      "roleSpecific": true,
      "hasVideoMoment": <true if error corresponds to a SPECIFIC MOMENT visible in video (death, fight, objective), false if it's a global stat (vision score, CS, etc.)>
    }
  ],
  "tips": [
    {
      "id": "tip-1",
      "category": "<Macro|Objectives|Vision|Wave-Management|Teamfighting|Laning|Role-Specific>",
      "title": "<5 words max>",
      "description": "<PERSONALIZED! Reference deaths, champion, specific advice>",
      "priority": <1-3>,
      "exercice": "<PERSONALIZED! Specific practice drill for this champion>",
      "relatedErrors": ["<error-ids>"]
    }
  ],
  "performanceSummary": {
    "overallAssessment": "<HIGHLY PERSONALIZED! At least 3 sentences with stats. Summarize the game, KDA, CS/min, main issues, and what cost the game or made it difficult>",
    "keyMistake": "<THE biggest mistake with DETAILS>",
    "strengths": ["<Based on REAL stats>", "<Another SPECIFIC strength>"],
    "weaknesses": ["<Based on REAL stats>", "<Another SPECIFIC weakness>"],
    "improvementPlan": {
      "immediate": ["<SPECIFIC to this game>"],
      "shortTerm": ["<SPECIFIC to the role>"],
      "longTerm": ["<SPECIFIC to the champion>"]
    },
    "estimatedRank": "<Based on ALL stats: CS/min ${csPerMin}, Vision ${matchData.visionScore}, KDA ${kda}, DPM ${dpm}>",
    "rankUpTip": "<PERSONALIZED! Priority #1 to climb in ${matchData.role} with ${matchData.champion}>"
  },
  "deathsAnalysis": [
    {
      "deathNumber": 1,
      "timestamp": <seconds - estimated time of death>,
      "gamePhase": "<early|mid|late>",
      "situationContext": "<DETAILED! Describe the game state: 'Around 8 minutes, you were pushing top lane without vision while your jungler was bot side. The enemy Nocturne had just finished his clear and was likely pathing top.'>",
      "fightAnalysis": {
        "wasWinnable": <true|false>,
        "reason": "<DETAILED! 'This fight was NOT winnable because: 1) You were level 5 vs their level 6 (ultimate disadvantage), 2) You had ~500 gold deficit from missing CS, 3) No flash available (used 2 minutes ago), 4) Enemy jungler was nearby'>",
        "goldState": "<ahead|even|behind by approximately X gold>",
        "levelState": "<your level vs enemy level>",
        "cooldownsAvailable": "<Flash, ult, key abilities - what was up/down>"
      },
      "whatWentWrong": "<Be specific: 'You overstayed in lane with low HP after a bad trade. Instead of backing with 1200 gold for your spike, you greeded for 2 more minions and got dove 2v1.'>",
      "whatShouldHaveDone": "<ACTIONABLE! 'After that trade at 7:30 left you at 40% HP, the correct play was to shove the wave and back immediately. Your opponent couldn't freeze because the wave was too big.'>",
      "deathCost": "<What this death cost: 'This death gave the enemy ~400 gold, 2 tower plates, and denied you ~12 CS. Total swing: approximately 800 gold advantage to the enemy.'>",
      "coachVerdict": "<critical|avoidable|unlucky|acceptable>"
    }
  ]
}

## DEATHS ANALYSIS RULES
- Generate ONE entry per death (${matchData.deaths} deaths = ${matchData.deaths} entries)
${matchData.deathDetails && matchData.deathDetails.length > 0 ? `- USE THE EXACT DEATH DETAILS PROVIDED ABOVE! Do NOT invent or change timestamps, killers, or assistants.
- Each death has: exact timestamp, killer name, assistant names (if ganked), zone/location, gold diff, level diff
- If deathDetails show assistants, it was a GANK - say "ganked by X + Y" not "1v1"` : `- Estimate timestamps based on game flow: early deaths (0-10 min), mid-game deaths (10-25 min), late deaths (25+ min)`}
- Use REAL game knowledge: level advantages, item spikes, summoner cooldowns, jungle clear timers
- Be BRUTALLY HONEST about whether the fight was winnable - use LoL fundamentals:
  * Level advantages (especially level 6 power spike)
  * Item completion timings (BF Sword, Lost Chapter, Mythic, etc.)
  * Summoner spell availability (Flash is a 5-min CD)
  * Number advantage (1v2, 2v3, etc. - CHECK THE ASSISTANTS LIST!)
  * Position on map (was the player overextended in enemy territory?)
- The "coachVerdict" should be:
  * "critical" - This death directly lost an objective or the game
  * "avoidable" - Player made a clear mistake, should have known better
  * "unlucky" - Bad RNG, unexpected enemy play, or hard to predict
  * "acceptable" - Trading death for a worthy objective or outplay attempt that was reasonable

## ABSOLUTE PERSONALIZATION RULES
1. EACH text must contain at least 1 stat from the game (KDA, CS, deaths, DPM, etc.)
2. EACH advice must mention ${matchData.champion} or ${matchData.role}
3. EACH error must have a REALISTIC timestamp for a ${gameDurationMinutes} minute game
4. The performanceSummary.overallAssessment must have AT LEAST 3 sentences with stats
5. NO GENERIC ADVICE like "improve your CS" - instead say "with ${csPerMin} CS/min, you're losing ~1000 gold compared to a Gold player"

IMPORTANT:
- Maximum 3-5 IMPORTANT errors, not an exhaustive list
- Each error MUST be relevant for ${matchData.role} playing ${matchData.champion}
- Be DIRECT and HONEST like a real coach - cite NUMBERS
- Focus on what LOSES games, not minor details

## VIDEO CLIP RULES (clipStart/clipEnd)
CRITICAL: Only set clipStart and clipEnd for errors that have a SPECIFIC MOMENT visible in video:
✅ INCLUDE clips for:
- Deaths (death-timing) - you can see the player die
- Poorly played teamfights - you can see positioning
- Failed objectives - you can see the fight around Dragon/Baron
- Bad positioning - you can see where the player was

❌ DO NOT INCLUDE clips for:
- Insufficient vision - it's a global stat, not a moment
- Missed CS - not interesting to review in video
- Wave management - too abstract for a clip
- Itemization - no video moment
- Back timing - hard to show

If the error does NOT have a specific visible moment, set clipStart: null and clipEnd: null

REMINDER: Write ALL text content in ${outputLanguage.toUpperCase()}.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000, // Increased for detailed deaths analysis
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Extract JSON from response
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  // Parse JSON from response
  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse Claude response as JSON');
  }

  // Death analysis type
  interface DeathAnalysisEntry {
    deathNumber: number;
    timestamp: number;
    gamePhase: 'early' | 'mid' | 'late';
    situationContext: string;
    fightAnalysis: {
      wasWinnable: boolean;
      reason: string;
      goldState: string;
      levelState: string;
      cooldownsAvailable: string;
    };
    whatWentWrong: string;
    whatShouldHaveDone: string;
    deathCost: string;
    coachVerdict: 'critical' | 'avoidable' | 'unlucky' | 'acceptable';
  }

  const analysis = JSON.parse(jsonMatch[0]) as {
    stats: AnalysisStats;
    errors: Array<GameError & { clipStart?: number; clipEnd?: number; coachingNote?: string; priority?: number; roleSpecific?: boolean }>;
    tips: Array<CoachingTip & { exercice?: string; relatedErrors?: string[] }>;
    performanceSummary?: PerformanceSummary & { keyMistake?: string };
    deathsAnalysis?: DeathAnalysisEntry[];
  };

  // Add IDs to errors and tips if missing
  analysis.errors = analysis.errors.map((e, i) => ({
    ...e,
    id: e.id || `error-${generateId()}-${i}`,
  }));

  analysis.tips = analysis.tips.map((t, i) => ({
    ...t,
    id: t.id || `tip-${generateId()}-${i}`,
  }));

  // Sort errors by priority (critical first)
  analysis.errors.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
  });

  // Generate video clips - prefer real clips from vision analysis, fallback to AI-estimated
  let clips: VideoClip[] = [];

  // Error types that deserve a video clip (have a specific in-game moment)
  const clippableErrorTypes = new Set([
    'death-timing',      // Mort avant objectif
    'objective',         // Mauvaise gestion d'objectif (fight visible)
    'teamfight',         // Erreur en teamfight
    'positioning',       // Mauvais positionnement (visible)
    'macro-positioning', // Mauvaise position macro
    'timing',            // Mauvais timing (engage, etc.)
  ]);

  // Error types that should NOT have clips (statistical/global errors)
  const nonClippablePatterns = [
    'vision',           // Vision score is a global stat
    'cs-missing',       // CS is tracked globally
    'wave-management',  // Usually not a specific moment
    'itemization',      // No video needed
    'back-timing',      // Hard to show in video
  ];

  // Helper to check if an error is clippable
  const isClippableError = (error: { type: string; title: string; description: string }) => {
    // Check if type is explicitly clippable
    if (clippableErrorTypes.has(error.type)) return true;

    // Check if type is explicitly non-clippable
    if (nonClippablePatterns.some(pattern => error.type.includes(pattern))) return false;

    // Check title/description for death-related content (always clippable)
    const text = `${error.title} ${error.description}`.toLowerCase();
    if (text.includes('mort') || text.includes('death') || text.includes('tué') || text.includes('killed')) {
      return true;
    }

    // Check for fight-related content
    if (text.includes('fight') || text.includes('combat') || text.includes('engage') || text.includes('teamfight')) {
      return true;
    }

    // Check for objective-related content with specific moment
    if (text.includes('dragon') || text.includes('baron') || text.includes('herald') || text.includes('nash')) {
      return true;
    }

    // Default: don't clip if we're unsure
    return false;
  };

  // If we have vision analysis with real timestamps, use those (they are always relevant)
  if (visionAnalysis.length > 0) {
    clips = visionAnalysis.map((va, i) => {
      // Find matching error if any
      const matchingError = analysis.errors.find(e =>
        Math.abs(e.timestamp - va.timestamp) < 30 // Within 30 seconds
      );

      // Build AI analysis for death clips
      const aiAnalysis = va.type === 'death' ? {
        deathCause: va.visualAnalysis || matchingError?.description || 'Mort analysée par IA',
        mistakes: va.detectedErrors.length > 0 ? va.detectedErrors : (matchingError ? [matchingError.description] : []),
        suggestions: va.suggestions.length > 0 ? va.suggestions : (matchingError ? [matchingError.suggestion] : []),
        situationalAdvice: matchingError?.coachingNote || `Sur ${matchData.champion} en ${matchData.role}, cette mort aurait pu être évitée avec une meilleure conscience de la carte.`,
        severity: matchingError?.severity || 'medium' as const,
      } : undefined;

      return {
        id: `clip-${generateId()}-${i}`,
        type: va.type as 'error' | 'death' | 'highlight',
        timestamp: va.timestamp,
        duration: 25,
        title: matchingError?.title || `${va.type === 'death' ? 'Mort' : va.type} à ${Math.floor(va.timestamp / 60)}:${(va.timestamp % 60).toString().padStart(2, '0')}`,
        description: va.visualAnalysis || matchingError?.description || '',
        url: `${job.matchId}/clip-${i}`,
        thumbnailUrl: undefined,
        startTime: Math.max(0, va.timestamp - 15),
        endTime: va.timestamp + 10,
        errorId: matchingError?.id,
        aiAnalysis,
      };
    });
  } else {
    // Fallback to AI-estimated clips based on errors
    // ONLY include clips for errors that make sense to show in video
    clips = analysis.errors
      .filter(e => e.clipStart !== undefined && e.clipStart !== null && e.clipEnd !== undefined && e.clipEnd !== null)
      .filter(e => (e as { hasVideoMoment?: boolean }).hasVideoMoment !== false) // Respect AI's hasVideoMoment flag
      .filter(e => isClippableError(e)) // Double-check with our rules
      .slice(0, 5) // Limit to 5 most important clips
      .map((error, i) => {
        // Check if this is a death-related error
        const isDeath = error.type === 'death-timing' ||
                        error.title.toLowerCase().includes('mort') ||
                        error.description.toLowerCase().includes('mort');

        const aiAnalysis = isDeath ? {
          deathCause: error.description,
          mistakes: [error.description],
          suggestions: [error.suggestion],
          situationalAdvice: error.coachingNote || `Sur ${matchData.champion} en ${matchData.role}, évite ce type de mort en améliorant ton positionnement.`,
          severity: error.severity,
        } : undefined;

        return {
          id: `clip-${generateId()}-${i}`,
          type: isDeath ? 'death' as const : 'error' as const,
          timestamp: error.timestamp,
          duration: (error.clipEnd || error.timestamp + 15) - (error.clipStart || error.timestamp - 5),
          title: error.title,
          description: error.coachingNote || error.description,
          url: `${job.matchId}/clip-${i}`,
          thumbnailUrl: undefined,
          startTime: error.clipStart || Math.max(0, error.timestamp - 5),
          endTime: error.clipEnd || error.timestamp + 15,
          errorId: error.id,
          aiAnalysis,
        };
      });
  }

  console.log(`Generated ${clips.length} relevant clips for analysis`);

  // Store performance summary and deaths analysis in stats if available
  if (analysis.performanceSummary) {
    (analysis.stats as AnalysisStats & { performanceSummary?: PerformanceSummary }).performanceSummary = analysis.performanceSummary;
  }
  if (analysis.deathsAnalysis) {
    (analysis.stats as AnalysisStats & { deathsAnalysis?: typeof analysis.deathsAnalysis }).deathsAnalysis = analysis.deathsAnalysis;
  }

  return {
    stats: analysis.stats,
    errors: analysis.errors,
    tips: analysis.tips,
    clips,
  };
}

// Simplified interface for external API calls
export interface SimpleMatchData {
  matchId: string;
  champion: string;
  role: string;
  result: 'win' | 'loss';
  duration: number;
  gameMode: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  visionScore: number;
  goldEarned: number;
  damageDealt: number;
  wardsPlaced?: number;
  wardsKilled?: number;
  detectorWardsPlaced?: number;
  damageDealtToObjectives?: number;
  objectives?: {
    dragonKills: number;
    baronKills: number;
    heraldKills: number;
    turretKills: number;
  };
  teammates?: Array<{ championName: string; kills: number; deaths: number; assists: number }>;
  enemies?: Array<{ championName: string; kills: number; deaths: number; assists: number }>;
  // Enriched timeline data
  deathDetails?: DeathDetail[];
  objectiveTimeline?: Array<{
    type: string;
    subType?: string;
    timestamp: number;
    gamePhase: 'early' | 'mid' | 'late';
    wasPlayerTeam: boolean;
    wasPlayerAlive: boolean;
    playerDistanceToObjective: number | null;
  }>;
  teamGold?: number;
  enemyTeamGold?: number;
  laneOpponent?: { championName: string; kills: number; deaths: number; assists: number };
  matchupInfo?: string;
}

// Supported languages for AI analysis output
export type AnalysisLanguage = 'en' | 'fr' | 'es' | 'de' | 'pt';

const LANGUAGE_NAMES: Record<AnalysisLanguage, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  pt: 'Portuguese',
};

/**
 * Analyze a match using Claude AI - simplified version for API calls
 * This function can be used without video analysis or job queue
 */
export async function analyzeMatchWithAI(
  matchData: SimpleMatchData,
  env: Env,
  language: AnalysisLanguage = 'en'
): Promise<{
  stats: AnalysisStats;
  errors: GameError[];
  tips: CoachingTip[];
  clips: VideoClip[];
}> {
  // Convert to internal MatchData format
  const internalMatchData: MatchData = {
    champion: matchData.champion,
    result: matchData.result,
    duration: matchData.duration,
    gameMode: matchData.gameMode,
    kills: matchData.kills,
    deaths: matchData.deaths,
    assists: matchData.assists,
    cs: matchData.cs,
    visionScore: matchData.visionScore,
    goldEarned: matchData.goldEarned,
    damageDealt: matchData.damageDealt,
    role: matchData.role,
    lane: matchData.role,
    wardsPlaced: matchData.wardsPlaced,
    wardsKilled: matchData.wardsKilled,
    detectorWardsPlaced: matchData.detectorWardsPlaced,
    damageDealtToObjectives: matchData.damageDealtToObjectives,
    objectives: matchData.objectives,
    teammates: matchData.teammates,
    enemies: matchData.enemies,
    // Enriched timeline data
    deathDetails: matchData.deathDetails,
    teamGold: matchData.teamGold,
    enemyTeamGold: matchData.enemyTeamGold,
    laneOpponent: matchData.laneOpponent,
    matchupInfo: matchData.matchupInfo,
  };

  // Create a minimal job for internal use (only matchId is needed for clip URLs)
  const minimalJob: AnalysisJob = {
    analysisId: `api-${generateId()}`,
    matchId: matchData.matchId,
    puuid: '',
    region: '',
    videoKey: '',
  };

  // Call the AI analysis function without vision analysis
  return analyzeWithClaude(internalMatchData, minimalJob, env, [], language);
}
