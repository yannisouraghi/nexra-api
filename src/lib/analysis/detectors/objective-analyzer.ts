// Objective Analyzer - Analyzes objective control (Dragon, Baron, Herald)

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

// Objective positions
const DRAGON_PIT = { x: 9866, y: 4414 };
const BARON_PIT = { x: 5007, y: 10471 };

function calculateDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

export function analyzeObjectives(
  frames: TimelineFrame[],
  participants: MatchParticipant[],
  playerPuuid: string
): DetectorResult {
  const errors: DetectedError[] = [];
  const stats = {
    dragonsContested: 0,
    dragonsLost: 0,
    baronsContested: 0,
    baronsLost: 0,
    heraldsContested: 0,
  };

  const playerParticipant = participants.find(p => p.puuid === playerPuuid);
  if (!playerParticipant) {
    return { errors, stats };
  }

  const playerParticipantId = playerParticipant.participantId;
  const playerTeamId = playerParticipant.teamId;
  const isJungler = playerParticipant.teamPosition === 'JUNGLE';

  // Find recent deaths to check if player was dead during objective
  const playerDeaths: { timestamp: number; deathTimer: number }[] = [];

  for (const frame of frames) {
    for (const event of frame.events) {
      if (event.type === 'CHAMPION_KILL' && event.victimId === playerParticipantId) {
        const gamePhase = getGamePhase(event.timestamp);
        // Death timers vary by game time and level
        const deathTimer = gamePhase === 'early' ? 15000 :
                          gamePhase === 'mid' ? 30000 : 50000;
        playerDeaths.push({
          timestamp: event.timestamp,
          deathTimer,
        });
      }
    }
  }

  // Check if player was dead at a given timestamp
  function wasPlayerDead(timestamp: number): boolean {
    return playerDeaths.some(death =>
      timestamp > death.timestamp && timestamp < death.timestamp + death.deathTimer
    );
  }

  // Analyze objective events
  for (const frame of frames) {
    for (const event of frame.events) {
      if (event.type !== 'ELITE_MONSTER_KILL') continue;

      const timestamp = event.timestamp;
      const gamePhase = getGamePhase(timestamp);
      const takenByEnemy = event.killerTeamId !== playerTeamId;

      if (!takenByEnemy) continue; // Only analyze lost objectives

      const minuteTimestamp = Math.floor(timestamp / 60000);
      const secondTimestamp = Math.floor((timestamp % 60000) / 1000);
      const timeStr = `${minuteTimestamp}:${secondTimestamp.toString().padStart(2, '0')}`;

      // Get player position at this time
      const frameIndex = Math.floor(timestamp / 60000);
      const currentFrame = frames[frameIndex] || frame;
      const playerFrame = currentFrame.participantFrames[playerParticipantId.toString()];
      const playerPos = playerFrame?.position || { x: 7500, y: 7500 };

      const wasDead = wasPlayerDead(timestamp);

      // Analyze by objective type
      switch (event.monsterType) {
        case 'DRAGON':
        case 'ELDER_DRAGON': {
          const isElder = event.monsterType === 'ELDER_DRAGON';
          const distance = calculateDistance(playerPos, DRAGON_PIT);
          stats.dragonsLost++;

          if (!wasDead && distance > 4000) {
            const severity = isElder ? 'critical' : gamePhase === 'late' ? 'high' : 'medium';

            errors.push({
              type: 'objective',
              severity,
              timestamp: Math.floor(timestamp / 1000),
              title: isElder ? 'Elder Dragon perdu' : `Dragon ${event.monsterSubType?.replace('_DRAGON', '') || ''} perdu`,
              description: `L'ennemi a pris le ${isElder ? 'Elder Dragon' : 'Dragon'} a ${timeStr}. Tu etais a ${Math.round(distance)} unites de distance (${wasDead ? 'mort' : 'vivant'}).`,
              suggestion: isJungler
                ? 'En tant que jungler, tu dois timer les objectifs et etre present. Ward la zone 1 min avant le spawn.'
                : 'Sois pret a pivoter vers le Dragon quand il spawn. Communique avec ton equipe.',
              coachingNote: isElder
                ? 'L\'Elder Dragon est souvent game-deciding. Tout doit etre organise autour de cet objectif.'
                : `Le Dragon donne des buffs permanents a ton equipe. ${distance > 6000 ? 'Tu etais beaucoup trop loin pour contester.' : 'Rapproche-toi plus tot pour avoir le priority.'}`,
              context: {
                mapState: {
                  zone: 'danger',
                  playerPosition: playerPos,
                },
                gamePhase,
              },
            });
          }
          break;
        }

        case 'BARON_NASHOR': {
          const distance = calculateDistance(playerPos, BARON_PIT);
          stats.baronsLost++;

          if (!wasDead && distance > 4000) {
            errors.push({
              type: 'objective',
              severity: 'critical',
              timestamp: Math.floor(timestamp / 1000),
              title: 'Baron Nashor perdu',
              description: `L'ennemi a pris le Baron a ${timeStr}. Tu etais a ${Math.round(distance)} unites de distance.`,
              suggestion: 'Le Baron est l\'objectif le plus important du mid/late game. Groupe avec ton equipe pour le contester ou le prendre.',
              coachingNote: 'Un Baron donne un enorme avantage en siege et en gold. Perdre un Baron sans le contester est souvent un point tournant negatif.',
              context: {
                mapState: {
                  zone: 'danger',
                  playerPosition: playerPos,
                },
                gamePhase,
              },
            });
          }
          break;
        }

        case 'RIFTHERALD': {
          const distance = calculateDistance(playerPos, BARON_PIT); // Herald spawns at Baron pit
          stats.heraldsContested++;

          if (!wasDead && distance > 5000 && gamePhase === 'early') {
            errors.push({
              type: 'objective',
              severity: 'medium',
              timestamp: Math.floor(timestamp / 1000),
              title: 'Herald perdu',
              description: `L'ennemi a pris le Herald a ${timeStr}. Tu etais a ${Math.round(distance)} unites de distance.`,
              suggestion: 'Le Herald peut detruire une tour entiere. Aide ton jungler a le secure ou au moins conteste le.',
              coachingNote: 'Le Herald est tres utile pour accelerer le early game. Une tour en moins ouvre la map pour ton equipe.',
              context: {
                mapState: {
                  zone: 'neutral',
                  playerPosition: playerPos,
                },
                gamePhase,
              },
            });
          }
          break;
        }
      }
    }
  }

  return { errors, stats };
}
