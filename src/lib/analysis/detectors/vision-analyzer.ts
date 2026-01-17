// Vision Analyzer - Analyzes ward placement and vision control

import {
  TimelineFrame,
  MatchParticipant,
  DetectedError,
  DetectorResult,
} from '../types';

function getGamePhase(timestampMs: number): 'early' | 'mid' | 'late' {
  const minutes = timestampMs / 60000;
  if (minutes < 14) return 'early';
  if (minutes < 25) return 'mid';
  return 'late';
}

// Vision benchmarks per game phase (wards placed per 5 min)
const VISION_BENCHMARKS = {
  early: { good: 5, average: 3, poor: 1 },
  mid: { good: 8, average: 5, poor: 2 },
  late: { good: 10, average: 6, poor: 3 },
};

export function analyzeVision(
  frames: TimelineFrame[],
  participants: MatchParticipant[],
  playerPuuid: string
): DetectorResult {
  const errors: DetectedError[] = [];
  const stats = {
    totalWardsPlaced: 0,
    totalWardsKilled: 0,
    controlWardsPlaced: 0,
    wardsPerMinute: 0,
  };

  const playerParticipant = participants.find(p => p.puuid === playerPuuid);
  if (!playerParticipant) {
    return { errors, stats };
  }

  const playerParticipantId = playerParticipant.participantId;
  const isSupport = playerParticipant.teamPosition === 'UTILITY';

  // Track wards in time windows
  const wardsByWindow: { [key: number]: { placed: number; killed: number; control: number } } = {};

  // Process all events
  for (const frame of frames) {
    const windowKey = Math.floor(frame.timestamp / 300000); // 5-minute windows

    if (!wardsByWindow[windowKey]) {
      wardsByWindow[windowKey] = { placed: 0, killed: 0, control: 0 };
    }

    for (const event of frame.events) {
      // Ward placed
      if (event.type === 'WARD_PLACED' && event.creatorId === playerParticipantId) {
        stats.totalWardsPlaced++;
        wardsByWindow[windowKey].placed++;

        if (event.wardType === 'CONTROL_WARD') {
          stats.controlWardsPlaced++;
          wardsByWindow[windowKey].control++;
        }
      }

      // Ward killed
      if (event.type === 'WARD_KILL' && event.killerId === playerParticipantId) {
        stats.totalWardsKilled++;
        wardsByWindow[windowKey].killed++;
      }
    }
  }

  // Analyze each 5-minute window
  for (const [windowKey, data] of Object.entries(wardsByWindow)) {
    const minuteStart = parseInt(windowKey) * 5;
    const minuteEnd = minuteStart + 5;
    const gamePhase = getGamePhase(minuteStart * 60000);
    const benchmark = VISION_BENCHMARKS[gamePhase];

    // Check ward placement
    const adjustedBenchmark = isSupport ? benchmark : {
      good: benchmark.good * 0.6,
      average: benchmark.average * 0.6,
      poor: benchmark.poor * 0.6
    };

    if (data.placed < adjustedBenchmark.poor && minuteStart >= 10) {
      const severity = gamePhase === 'late' ? 'high' : 'medium';

      errors.push({
        type: 'vision',
        severity,
        timestamp: minuteStart * 60,
        title: `Manque de vision (${minuteStart}-${minuteEnd} min)`,
        description: `Tu n'as place que ${data.placed} ward(s) entre ${minuteStart} et ${minuteEnd} min. ${
          isSupport
            ? 'En tant que support, la vision est ta responsabilite principale.'
            : 'Meme en tant que laner, tu dois contribuer a la vision.'
        }`,
        suggestion: isSupport
          ? 'Place des wards strategiques: river, jungle ennemie, objectifs. Utilise ton Oracle Lens pour deward.'
          : 'Achete des Control Wards regulierement. Une ward peut sauver ta vie ou celle de ton equipe.',
        coachingNote: `La vision gagne des games. ${data.placed} ward(s) en 5 min est insuffisant pour avoir une bonne lecture de la map.`,
        context: {
          visionState: {
            playerWardsActive: data.placed,
            areaWarded: data.placed >= adjustedBenchmark.average,
          },
          gamePhase,
        },
      });
    }

    // Check control ward usage in mid/late game
    if (gamePhase !== 'early' && data.control === 0 && minuteStart >= 10) {
      errors.push({
        type: 'vision',
        severity: 'low',
        timestamp: minuteStart * 60,
        title: `Pas de Control Ward (${minuteStart}-${minuteEnd} min)`,
        description: `Tu n'as pas place de Control Ward entre ${minuteStart} et ${minuteEnd} min.`,
        suggestion: 'Les Control Wards sont essentielles pour controler les zones cles (dragon, baron, jungle). Achetes-en a chaque back.',
        coachingNote: 'Une Control Ward coute 75 gold mais peut sauver ta vie ou reveler des embuscades. C\'est l\'un des meilleurs investissements du jeu.',
        context: {
          visionState: {
            playerWardsActive: data.placed,
            areaWarded: false,
          },
          gamePhase,
        },
      });
    }
  }

  // Calculate wards per minute
  const gameMinutes = frames.length;
  if (gameMinutes > 0) {
    stats.wardsPerMinute = Math.round((stats.totalWardsPlaced / gameMinutes) * 10) / 10;
  }

  return { errors, stats };
}
