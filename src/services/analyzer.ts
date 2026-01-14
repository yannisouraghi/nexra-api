import Anthropic from '@anthropic-ai/sdk';
import { Env, AnalysisJob, AnalysisStats, GameError, CoachingTip, VideoClip, RiotMatchData } from '../types';
import { generateId } from '../utils/helpers';

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
  teammates?: Array<{ championName: string; kills: number; deaths: number; assists: number; }>;
  enemies?: Array<{ championName: string; kills: number; deaths: number; assists: number; }>;
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
    const analysis = await analyzeWithClaude(matchData, job, env, visionAnalysis);
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

  const response = await fetch(apiUrl, {
    headers: {
      'X-Riot-Token': env.RIOT_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch match data: ${response.status}`);
  }

  const data = await response.json() as {
    info: {
      gameDuration: number;
      gameMode: string;
      queueId: number;
      participants: Array<{
        puuid: string;
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
  };
}

// Role-specific coaching context
function getRoleContext(role: string): string {
  const contexts: Record<string, string> = {
    'TOP': `En tant que TOPLANER:
- Tu es souvent en 1v1 isolé, la gestion des waves et le contrôle de la lane est CRUCIALE
- Le Herald est TON objectif prioritaire (min 8-14)
- Tu dois créer de la pression split push pour attirer l'attention ennemie
- Ton TP doit être utilisé pour rejoindre les teamfights bot ou contester Drake
- Tu dois tracker le jungler ennemi car tu es vulnérable aux ganks
- En late game, tu dois soit split push soit être avec ton équipe - jamais entre les deux`,

    'JUNGLE': `En tant que JUNGLER:
- Tu es le CHEF D'ORCHESTRE de la macro - tu dictes le tempo de la partie
- La vision autour des objectifs est TA responsabilité principale
- Tu dois tracker le jungler ennemi et contester ses camps quand possible
- Les timings de gank doivent être optimaux (après push de ta lane, summoners down)
- Tu dois prioriser: Objectifs > Contre-gank > Gank > Farm
- Herald avant 14 min, Drake soul est WIN CONDITION`,

    'MID': `En tant que MIDLANER:
- Tu as le plus d'influence sur la map grâce à ta position centrale
- Tu dois ROAM pour aider tes sidelanes après avoir push ta wave
- Tu dois assister ton jungler sur les contests de scuttle et objectifs
- Ta prio de lane permet à ton jungler d'envahir
- En teamfight, ton positionnement et ton burst sont clés
- Tu dois tracker les roams ennemis et ping tes teammates`,

    'ADC': `En tant qu'ADC:
- Ta SURVIE est la priorité absolue - un ADC mort = 0 DPS
- Tu dois farm de manière efficace et safe (objectif 8+ CS/min)
- Tu dois être présent pour CHAQUE Drake (ton DPS est crucial)
- En teamfight, reste DERRIÈRE ton frontline et kite
- Ne jamais facecheck sans vision - c'est le job du support
- Ton positionnement en late game décide des teamfights`,

    'SUPPORT': `En tant que SUPPORT:
- La VISION est ta responsabilité principale - tu dois contrôler la map
- Tu dois roam mid après avoir push la wave bot pour créer des avantages
- Tu dois peel ton ADC en teamfight - sa survie = ta priorité
- Le contrôle de vision autour de Drake/Baron est CRUCIAL
- Tu dois engager les fights au bon moment ou counter-engager
- Tu dois tracker les cooldowns ennemis et ping les dangers`,

    'UNKNOWN': `Analyse générale applicable à tous les rôles.`,
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

// Analyze match with Claude AI - Coach mindset with strategic errors
async function analyzeWithClaude(
  matchData: MatchData,
  job: AnalysisJob,
  env: Env,
  visionAnalysis: VisionAnalysisResult[] = []
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

  const roleContext = getRoleContext(matchData.role);

  // Build vision analysis section if available
  let visionSection = '';
  if (visionAnalysis.length > 0) {
    visionSection = `

## ANALYSE VIDÉO DISPONIBLE
L'IA a analysé ${visionAnalysis.length} clips vidéo de moments clés. Utilise ces informations pour enrichir ton analyse:

${visionAnalysis.map((v, i) => `
### Clip ${i + 1}: ${v.type} à ${Math.floor(v.timestamp / 60)}:${(v.timestamp % 60).toString().padStart(2, '0')}
- **Ce qui s'est passé:** ${v.visualAnalysis}
- **Erreurs détectées visuellement:** ${v.detectedErrors.join(', ') || 'Aucune erreur majeure'}
- **Suggestions:** ${v.suggestions.join(' | ') || 'N/A'}
`).join('\n')}

IMPORTANT: Intègre ces observations visuelles dans tes erreurs et conseils. Les erreurs vues dans la vidéo sont des PREUVES - utilise-les pour être plus précis.
`;
  }

  // Enhanced prompt for strategic coach-level analysis with PERSONALIZED feedback
  const prompt = `Tu es un coach professionnel de League of Legends de niveau Challenger. Tu analyses la partie comme un VRAI COACH: peu de feedback, mais des feedbacks à FORT IMPACT et ULTRA PERSONNALISÉS.
${visionSection}

## RÈGLE D'OR: PERSONNALISATION MAXIMALE
CHAQUE feedback doit être SPÉCIFIQUE à cette partie. Pas de conseils génériques !
- Cite des MOMENTS PRÉCIS de la game (ex: "à 12:30 quand tu as pris ce fight bot")
- Référence les STATS RÉELLES du joueur (ex: "avec tes ${matchData.deaths} morts dont 2 avant Drake")
- Mentionne le CHAMPION joué dans chaque conseil (ex: "sur ${matchData.champion}, tu aurais dû...")
- Compare avec ce qui AURAIT DÛ se passer (ex: "au lieu de mourir solo top, un reset aurait donné...")

## RÔLE DU JOUEUR: ${matchData.role}
${roleContext}

## DONNÉES DE LA PARTIE À UTILISER DANS TES FEEDBACKS
- Champion: ${matchData.champion} (${matchData.role})
- Résultat: ${matchData.result === 'win' ? 'VICTOIRE' : 'DÉFAITE'}
- Durée: ${gameDurationMinutes} minutes (${matchData.duration} secondes)
- KDA: ${matchData.kills}/${matchData.deaths}/${matchData.assists} (Ratio: ${kda})
- CS: ${matchData.cs} total (${csPerMin}/min) - ${matchData.role === 'JUNGLE' ? 'correct pour un jungler' : parseFloat(csPerMin) < 6 ? 'INSUFFISANT, tu perds beaucoup d\'or' : parseFloat(csPerMin) >= 8 ? 'excellent' : 'dans la moyenne'}
- Vision Score: ${matchData.visionScore} - ${matchData.role === 'SUPPORT' ? (matchData.visionScore < 40 ? 'TROP BAS pour un support' : 'correct') : matchData.visionScore < 20 ? 'tu dois poser plus de wards' : 'acceptable'}
${matchData.wardsPlaced !== undefined ? `- Wards posées: ${matchData.wardsPlaced} | Wards détruites: ${matchData.wardsKilled || 0} | Pinks: ${matchData.detectorWardsPlaced || 0}` : ''}
- Or total: ${matchData.goldEarned} (${Math.round(matchData.goldEarned / gameDurationMinutes)} gold/min)
- Dégâts: ${matchData.damageDealt} (${dpm} DPM) - ${matchData.role === 'SUPPORT' ? 'normal pour un support' : dpm < 400 ? 'TRÈS BAS, tu n\'as pas été présent dans les fights' : dpm > 700 ? 'bon output de dégâts' : 'dans la moyenne'}
${matchData.damageDealtToObjectives ? `- Dégâts aux objectifs: ${matchData.damageDealtToObjectives}` : ''}
${matchData.objectives ? `- Objectifs équipe: ${matchData.objectives.dragonKills} Dragons, ${matchData.objectives.baronKills} Barons, ${matchData.objectives.heraldKills} Heralds` : ''}
${matchData.teamGold && matchData.enemyTeamGold ? `- État de la game: ${matchData.teamGold > matchData.enemyTeamGold ? 'ton équipe menait de ' + (matchData.teamGold - matchData.enemyTeamGold) + ' gold' : 'ton équipe était en retard de ' + (matchData.enemyTeamGold - matchData.teamGold) + ' gold'}` : ''}
${matchData.champLevel ? `- Niveau final: ${matchData.champLevel}` : ''}
${matchData.rank ? `- Classement dans la game: ${matchData.rank}/10 ${matchData.rank <= 3 ? '(Top performer)' : matchData.rank >= 8 ? '(Underperforming)' : ''}` : ''}

### MULTIKILLS & HIGHLIGHTS
${matchData.firstBloodKill ? '- First Blood: OUI' : ''}${matchData.firstTowerKill ? ' | First Tower: OUI' : ''}
${matchData.doubleKills ? `- Double kills: ${matchData.doubleKills}` : ''}${matchData.tripleKills ? ` | Triple kills: ${matchData.tripleKills}` : ''}${matchData.quadraKills ? ` | Quadra kills: ${matchData.quadraKills}` : ''}${matchData.pentaKills ? ` | PENTAKILL: ${matchData.pentaKills}` : ''}

${matchData.teammates && matchData.teammates.length > 0 ? `### COMPOSITION D'ÉQUIPE (Tes alliés)
${matchData.teammates.map(t => `- ${t.championName}: ${t.kills}/${t.deaths}/${t.assists}`).join('\n')}` : ''}

${matchData.enemies && matchData.enemies.length > 0 ? `### ÉQUIPE ENNEMIE
${matchData.enemies.map(e => `- ${e.championName}: ${e.kills}/${e.deaths}/${e.assists}`).join('\n')}` : ''}

## ANALYSE REQUISE
En te basant sur ces stats PRÉCISES, déduis ce qui s'est probablement passé:

## TYPES D'ERREURS À DÉTECTER (par priorité)

### PRIORITÉ 1 — ERREURS CRITIQUES (impact direct sur la victoire)
1. **Objectifs majeurs mal gérés**
   - Dragon/Soul donné sans contest alors que l'équipe est vivante
   - Baron/Herald lancé sans vision
   - Baron perdu après un pick-off gagnant
   - Contest d'objectif en infériorité numérique
   - Absence de reset avant un objectif clé

2. **Deaths inutiles avant objectifs**
   - Mort isolée 30-90 secondes avant Dragon/Baron
   - Facecheck sans vision
   - Overextend sans information ennemie
   - Mort en side lane sans pression d'objectif

3. **Power spikes ignorés ou mal exploités**
   - Item clé terminé sans prise d'initiative
   - Fight forcé avant complétion d'un item majeur
   - Back trop tard retardant un power spike
   - Mauvais timing de reset avant un fight important

4. **Mauvaise répartition macro sur la map**
   - 5 joueurs mid sans objectif actif
   - Mauvais split push (sans pression cross-map)
   - Aucun joueur en side lane en mid/late game
   - Défense ou push sur la mauvaise lane

### PRIORITÉ 2 — ERREURS MAJEURES (fort impact situationnel)
5. **Vision insuffisante autour des objectifs**
   - Absence de wards avant Dragon/Baron
   - Aucun sweep avant contest
   - Vision placée trop tard
   - Vision non défendue

6. **Mauvais déroulement des teamfights**
   - Mauvais target focus
   - Engage sans follow-up
   - Carry hors position
   - Fight forcé en désavantage numérique

7. **Mauvais back timings**
   - Back trop tard avant un objectif
   - Back désynchronisé entre joueurs
   - Fight sans items complétés
   - Défense d'objectif sans ressources

### PRIORITÉ 3 — ERREURS MODÉRÉES (impact cumulatif)
8. **Mauvaise gestion des waves**
   - Push sans vision
   - Waves non préparées avant objectif
   - Freeze cassé inutilement
   - Perte de waves sans compensation

9. **Mauvaise gestion du split push**
   - Split sans pression ailleurs
   - Split trop profond sans vision
   - Absence de TP ou de couverture
   - Mauvais timing de regroupement

10. **Mauvaise utilisation des timings ennemis**
    - Non-exploitation d'un death timer
    - Non-punition d'un back ennemi
    - Pas de prise d'objectif après un avantage

### PRIORITÉ 4 — ERREURS MINEURES (à filtrer, mentionner seulement si très récurrent)
11. Trades défavorables répétés en lane
12. Mauvaise utilisation des summoners
13. Inefficacité individuelle isolée

## RÈGLES DU COACH
- Tu es un coach EXPÉRIMENTÉ: peu de feedback mais à FORT IMPACT
- Concentre-toi sur les erreurs MACRO et STRATÉGIQUES, pas les micro-plays
- CHAQUE erreur doit être liée au RÔLE du joueur (${matchData.role})
- Si le joueur est mort ${matchData.deaths} fois, analyse POURQUOI ces morts étaient évitables
- Un ${matchData.role} ne doit PAS faire les mêmes erreurs qu'un autre rôle
- Priorise TOUJOURS les erreurs qui ont coûté des objectifs ou la partie

## FORMAT DE RÉPONSE (JSON) - PERSONNALISATION OBLIGATOIRE
{
  "stats": {
    "overallScore": <0-100 score global>,
    "csScore": <0-100>,
    "visionScore": <0-100>,
    "positioningScore": <0-100>,
    "objectiveScore": <0-100>,
    "macroScore": <0-100 score de décisions macro>,
    "deathsAnalyzed": ${matchData.deaths},
    "errorsFound": <nombre>,
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
      "title": "<5 mots max - percutant, ex: 'Mort inutile avant Drake'>",
      "description": "<PERSONNALISÉ! Ex: 'À environ 18:00, tu es mort en facecheck dans la jungle ennemie avec ton ${matchData.champion}. Cette mort a coûté le 3ème Drake à ton équipe car tu étais le seul avec du DPS. En tant que ${matchData.role}, tu ne dois JAMAIS facecheck sans vision quand un objectif spawn dans 60 secondes.'>",
      "timestamp": <secondes>,
      "suggestion": "<PERSONNALISÉ! Ex: 'Sur ${matchData.champion} en ${matchData.role}, avant chaque Drake tu dois: 1) Vérifier ton timer d'objectif, 2) Si <60sec, ne JAMAIS aller en territoire ennemi, 3) Regrouper avec ton équipe et laisser le support scanner.'>",
      "clipStart": <secondes ou null - UNIQUEMENT pour les erreurs visuelles: morts, fights, positionnement. PAS pour: vision, CS, wave management, itemization>,
      "clipEnd": <secondes ou null - même règle que clipStart>,
      "coachingNote": "<PERSONNALISÉ! Ex: 'Un ${matchData.role} Challenger sur ${matchData.champion} avec ton KDA de ${matchData.kills}/${matchData.deaths}/${matchData.assists} aurait joué safe 1 minute avant Drake. Ton ${dpm} DPM montre que tu es important dans les fights - mourir avant un objectif annule tout ton impact.'>",
      "roleSpecific": true,
      "hasVideoMoment": <true si l'erreur correspond à un MOMENT PRÉCIS visible en vidéo (mort, fight, objectif), false si c'est une stat globale (vision score, CS, etc.)>
    }
  ],
  "tips": [
    {
      "id": "tip-1",
      "category": "<Macro|Objectives|Vision|Wave-Management|Teamfighting|Laning|Role-Specific>",
      "title": "<5 mots max>",
      "description": "<PERSONNALISÉ! Ex: 'Avec tes ${matchData.deaths} morts cette game sur ${matchData.champion}, tu dois améliorer ton awareness avant les objectifs. Règle des 60 secondes: si Drake/Baron spawn dans 1 min, tu dois être visible et safe, pas en train de pusher une sidelane.'>",
      "priority": <1-3>,
      "exercice": "<PERSONNALISÉ! Ex: 'En Practice Tool sur ${matchData.champion}: pose un timer à 5:00, entraîne-toi à te repositionner vers Drake dès 4:00. Fais ça 10 fois jusqu'à ce que ce soit automatique.'>",
      "relatedErrors": ["<error-ids>"]
    }
  ],
  "performanceSummary": {
    "overallAssessment": "<TRÈS PERSONNALISÉ! Ex: 'Cette game sur ${matchData.champion} ${matchData.role} s'est ${matchData.result === 'win' ? 'soldée par une victoire' : 'terminée en défaite'} en ${gameDurationMinutes} minutes. Ton KDA de ${matchData.kills}/${matchData.deaths}/${matchData.assists} et ton ${csPerMin} CS/min montrent que tu as eu du mal en early game. Tes ${matchData.deaths} morts étaient principalement dues à des prises de risques inutiles avant les objectifs - c'est LA raison principale de ${matchData.result === 'loss' ? 'cette défaite' : 'tes difficultés'}.'>",
    "keyMistake": "<LA plus grosse erreur avec DÉTAILS, ex: 'Ta mort à ~18:00 avant le 3ème Drake a fait perdre l'objectif et donné un avantage irréversible à l'ennemi'>",
    "strengths": ["<Basé sur les stats RÉELLES, ex: 'Bon output de dégâts (${dpm} DPM) quand tu étais vivant'>", "<Autre point fort SPÉCIFIQUE>"],
    "weaknesses": ["<Basé sur les stats RÉELLES, ex: 'Trop de morts évitables (${matchData.deaths}) dont la plupart avant des objectifs'>", "<Autre faiblesse SPÉCIFIQUE>"],
    "improvementPlan": {
      "immediate": ["<SPÉCIFIQUE à cette game, ex: 'Dès ta prochaine game sur ${matchData.champion}, pose un timer mental 60 secondes avant chaque Drake/Baron'>"],
      "shortTerm": ["<SPÉCIFIQUE au rôle, ex: 'Cette semaine, focus sur mourir moins de 4 fois par game en ${matchData.role}'>"],
      "longTerm": ["<SPÉCIFIQUE au champion, ex: 'Apprends les power spikes de ${matchData.champion} pour savoir quand tu peux forcer et quand tu dois jouer safe'>"]
    },
    "estimatedRank": "<Basé sur TOUTES les stats: CS/min ${csPerMin}, Vision ${matchData.visionScore}, KDA ${kda}, DPM ${dpm}>",
    "rankUpTip": "<PERSONNALISÉ! Ex: 'Pour monter de ${matchData.result === 'loss' ? 'ce rang' : 'rang'} en ${matchData.role} avec ${matchData.champion}, ta priorité #1 est de réduire tes morts avant objectifs. Avec tes ${matchData.deaths} morts cette game, tu as probablement perdu 2-3 objectifs gratuits.'>"
  }
}

## RÈGLES DE PERSONNALISATION ABSOLUES
1. CHAQUE texte doit contenir au moins 1 stat de la partie (KDA, CS, deaths, DPM, etc.)
2. CHAQUE conseil doit mentionner ${matchData.champion} ou ${matchData.role}
3. CHAQUE erreur doit avoir un timestamp RÉALISTE pour une game de ${gameDurationMinutes} minutes
4. Le performanceSummary.overallAssessment doit faire AU MOINS 3 phrases avec des stats
5. PAS DE CONSEILS GÉNÉRIQUES comme "améliore ton CS" - dis plutôt "avec ${csPerMin} CS/min, tu perds ~1000 gold par rapport à un joueur Gold"

IMPORTANT:
- Maximum 3-5 erreurs IMPORTANTES, pas une liste exhaustive
- Chaque erreur DOIT être pertinente pour ${matchData.role} jouant ${matchData.champion}
- Sois DIRECT et HONNÊTE comme un vrai coach - cite des CHIFFRES
- Focus sur ce qui fait PERDRE des games, pas sur les détails mineurs

## RÈGLES POUR LES CLIPS VIDÉO (clipStart/clipEnd)
CRITIQUE: Ne mets clipStart et clipEnd QUE pour les erreurs qui ont un MOMENT PRÉCIS visible en vidéo:
✅ INCLURE clips pour:
- Morts (death-timing) - on peut voir le joueur mourir
- Teamfights mal joués - on peut voir le positionnement
- Objectifs ratés - on peut voir le fight autour du Dragon/Baron
- Mauvais positionnement - on peut voir où le joueur était

❌ NE PAS INCLURE clips pour:
- Vision insuffisante - c'est une stat globale, pas un moment
- CS manqués - pas intéressant à revoir en vidéo
- Wave management - trop abstrait pour un clip
- Itemization - pas de moment vidéo
- Back timing - difficile à montrer

Si l'erreur n'a PAS de moment précis visible, mets clipStart: null et clipEnd: null`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
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

  const analysis = JSON.parse(jsonMatch[0]) as {
    stats: AnalysisStats;
    errors: Array<GameError & { clipStart?: number; clipEnd?: number; coachingNote?: string; priority?: number; roleSpecific?: boolean }>;
    tips: Array<CoachingTip & { exercice?: string; relatedErrors?: string[] }>;
    performanceSummary?: PerformanceSummary & { keyMistake?: string };
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

  // Store performance summary in stats if available
  if (analysis.performanceSummary) {
    (analysis.stats as AnalysisStats & { performanceSummary?: PerformanceSummary }).performanceSummary = analysis.performanceSummary;
  }

  return {
    stats: analysis.stats,
    errors: analysis.errors,
    tips: analysis.tips,
    clips,
  };
}
