// CS Analyzer - Tracks CS performance and compares to opponent/benchmarks

import {
  TimelineFrame,
  MatchParticipant,
  DetectedError,
  DetectorResult,
} from '../types';

// Expected CS per minute by game phase
const CS_BENCHMARKS = {
  early: { good: 7, average: 6, poor: 5 },   // 0-14 min
  mid: { good: 7.5, average: 6.5, poor: 5.5 }, // 14-25 min
  late: { good: 8, average: 7, poor: 6 },    // 25+ min
};

function getGamePhase(timestampMs: number): 'early' | 'mid' | 'late' {
  const minutes = timestampMs / 60000;
  if (minutes < 14) return 'early';
  if (minutes < 25) return 'mid';
  return 'late';
}

export function analyzeCS(
  frames: TimelineFrame[],
  participants: MatchParticipant[],
  playerPuuid: string
): DetectorResult {
  const errors: DetectedError[] = [];
  const stats = {
    avgCSPerMin: 0,
    maxCSDiff: 0,
    csBehindMinutes: 0,
    totalCS: 0,
  };

  // Find player and opponent
  const playerParticipant = participants.find(p => p.puuid === playerPuuid);
  if (!playerParticipant) {
    return { errors, stats };
  }

  const playerParticipantId = playerParticipant.participantId;
  const playerTeamId = playerParticipant.teamId;
  const playerPosition = playerParticipant.teamPosition;

  // Find lane opponent
  const opponent = participants.find(
    p => p.teamId !== playerTeamId && p.teamPosition === playerPosition
  );

  // Junglers have different CS patterns
  const isJungler = playerPosition === 'JUNGLE';

  // Track CS at key timestamps (every 5 minutes)
  const checkpoints = [5, 10, 15, 20, 25, 30];
  let lastReportedDiff = 0;
  let totalCSTracked = 0;
  let csCheckpoints = 0;

  for (const checkpoint of checkpoints) {
    const frameIndex = checkpoint; // Frames are per minute
    if (frameIndex >= frames.length) break;

    const frame = frames[frameIndex];
    const playerFrame = frame.participantFrames[playerParticipantId.toString()];
    if (!playerFrame) continue;

    const playerCS = playerFrame.minionsKilled + playerFrame.jungleMinionsKilled;
    totalCSTracked = playerCS;
    csCheckpoints++;

    const gamePhase = getGamePhase(checkpoint * 60000);
    const benchmark = CS_BENCHMARKS[gamePhase];
    const expectedCS = checkpoint * benchmark.average;
    const goodCS = checkpoint * benchmark.good;

    // Check against opponent if exists
    if (opponent) {
      const opponentFrame = frame.participantFrames[opponent.participantId.toString()];
      if (opponentFrame) {
        const opponentCS = opponentFrame.minionsKilled + opponentFrame.jungleMinionsKilled;
        const csDiff = playerCS - opponentCS;

        // Track max diff
        if (Math.abs(csDiff) > Math.abs(stats.maxCSDiff)) {
          stats.maxCSDiff = csDiff;
        }

        // Report significant CS deficit (more than 15 CS behind)
        if (csDiff < -15 && csDiff < lastReportedDiff - 10) {
          lastReportedDiff = csDiff;
          stats.csBehindMinutes++;

          const goldLost = Math.abs(csDiff) * 21; // ~21 gold per minion
          const severity = csDiff < -30 ? 'high' : 'medium';

          errors.push({
            type: 'cs-missing',
            severity,
            timestamp: checkpoint * 60,
            title: `Retard de CS a ${checkpoint} min`,
            description: `Tu as ${playerCS} CS contre ${opponentCS} pour ton adversaire (${csDiff} CS, soit ~${goldLost} gold de retard).`,
            suggestion: isJungler
              ? 'Optimise tes clears de jungle. Ne rate pas de camps et time bien tes respawns.'
              : 'Focus sur le last hit. Si la lane est difficile, utilise tes sorts pour securiser les CS sous tour.',
            coachingNote: csDiff < -30
              ? `${Math.abs(csDiff)} CS de retard est significatif. Ton adversaire a presque un item d'avance juste en CS.`
              : 'Meme 15 CS de retard represente ~300 gold. Ca s\'accumule vite sur la duree de la partie.',
            context: {
              csState: {
                player: playerCS,
                opponent: opponentCS,
                differential: csDiff,
              },
              gamePhase,
            },
          });
        }
      }
    }

    // Check against benchmark (for players without direct opponent tracking)
    if (!opponent || isJungler) {
      const csPerMin = playerCS / checkpoint;

      if (csPerMin < benchmark.poor && checkpoint >= 10) {
        errors.push({
          type: 'cs-missing',
          severity: 'medium',
          timestamp: checkpoint * 60,
          title: `CS en dessous de la moyenne a ${checkpoint} min`,
          description: `Tu as ${playerCS} CS (${csPerMin.toFixed(1)} CS/min). L'objectif est ${benchmark.average} CS/min minimum.`,
          suggestion: isJungler
            ? 'Assure-toi de clear tous tes camps efficacement et de ne pas perdre de temps entre les ganks.'
            : 'Entraine-toi au last hit en practice tool. Chaque minion compte.',
          coachingNote: `A ${checkpoint} min, tu devrais viser ${Math.round(expectedCS)} CS. Tu en as rate ${Math.round(expectedCS - playerCS)}.`,
          context: {
            csState: {
              player: playerCS,
              opponent: Math.round(expectedCS),
              differential: Math.round(playerCS - expectedCS),
            },
            gamePhase,
          },
        });
      }
    }
  }

  // Calculate average CS/min
  if (csCheckpoints > 0 && frames.length > 0) {
    const lastFrame = frames[frames.length - 1];
    const lastPlayerFrame = lastFrame?.participantFrames[playerParticipantId.toString()];
    if (lastPlayerFrame) {
      const totalCS = lastPlayerFrame.minionsKilled + lastPlayerFrame.jungleMinionsKilled;
      const gameMinutes = frames.length;
      stats.avgCSPerMin = Math.round((totalCS / gameMinutes) * 10) / 10;
      stats.totalCS = totalCS;
    }
  }

  return { errors, stats };
}
