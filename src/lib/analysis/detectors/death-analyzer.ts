// Death Analyzer - Analyzes each death with full context from Riot API Timeline

import {
  TimelineFrame,
  MatchParticipant,
  DetectedError,
  DetectorResult,
  MapZone,
} from '../types';

// Map coordinates to zones (Summoner's Rift)
function getMapZone(x: number, y: number, playerTeamId: number): { zone: MapZone; safety: 'safe' | 'neutral' | 'danger' } {
  const isBlueTeam = playerTeamId === 100;

  // River zones
  if ((x > 4000 && x < 11000 && y > 4000 && y < 11000) &&
      Math.abs(x - (15000 - y)) < 3000) {
    if (x < 6000 && y < 6000) {
      return { zone: 'dragon_pit', safety: 'danger' };
    }
    if (x > 9000 && y > 9000) {
      return { zone: 'baron_pit', safety: 'danger' };
    }
    if (y < 7500) {
      return { zone: 'river_bot', safety: 'neutral' };
    }
    return { zone: 'river_top', safety: 'neutral' };
  }

  // Blue side jungle
  if (x < 7000 && y < 7000 && !(x < 3000 && y < 3000)) {
    return {
      zone: 'blue_jungle',
      safety: isBlueTeam ? 'safe' : 'danger',
    };
  }

  // Red side jungle
  if (x > 8000 && y > 8000 && !(x > 12000 && y > 12000)) {
    return {
      zone: 'red_jungle',
      safety: isBlueTeam ? 'danger' : 'safe',
    };
  }

  // Lanes
  if (Math.abs(x - y) < 2000) {
    return { zone: 'mid_lane', safety: 'neutral' };
  }
  if (y > x + 2000) {
    return { zone: 'top_lane', safety: 'neutral' };
  }
  if (x > y + 2000) {
    return { zone: 'bot_lane', safety: 'neutral' };
  }

  // Bases
  if (x < 3000 && y < 3000) {
    return {
      zone: 'blue_base',
      safety: isBlueTeam ? 'safe' : 'danger',
    };
  }
  if (x > 12000 && y > 12000) {
    return {
      zone: 'red_base',
      safety: isBlueTeam ? 'danger' : 'safe',
    };
  }

  return { zone: 'mid_lane', safety: 'neutral' };
}

function getGamePhase(timestampMs: number): 'early' | 'mid' | 'late' {
  const minutes = timestampMs / 60000;
  if (minutes < 14) return 'early';
  if (minutes < 25) return 'mid';
  return 'late';
}

function calculateDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

function isUnderEnemyTower(position: { x: number; y: number }, playerTeamId: number): boolean {
  const blueTowers = [
    { x: 1512, y: 1336 },
    { x: 1169, y: 4287 },
    { x: 4318, y: 1029 },
    { x: 981, y: 10441 },
    { x: 6919, y: 1483 },
  ];

  const redTowers = [
    { x: 13604, y: 13350 },
    { x: 13866, y: 10648 },
    { x: 10504, y: 13604 },
    { x: 8955, y: 13607 },
    { x: 14340, y: 8012 },
  ];

  const enemyTowers = playerTeamId === 100 ? redTowers : blueTowers;
  const towerRange = 850;

  return enemyTowers.some(tower => calculateDistance(position, tower) < towerRange);
}

function findNearestAlly(
  position: { x: number; y: number },
  playerParticipantId: number,
  frame: TimelineFrame['participantFrames'],
  participants: MatchParticipant[],
  playerTeamId: number
): { champion: string; distance: number } | null {
  let nearest: { champion: string; distance: number } | null = null;

  for (const [participantId, participantFrame] of Object.entries(frame)) {
    const id = parseInt(participantId);
    if (id === playerParticipantId) continue;

    const participant = participants.find(p => p.participantId === id);
    if (!participant || participant.teamId !== playerTeamId) continue;

    const distance = calculateDistance(position, participantFrame.position);
    if (!nearest || distance < nearest.distance) {
      nearest = {
        champion: participant.championName,
        distance: Math.round(distance),
      };
    }
  }

  return nearest;
}

export function analyzeDeaths(
  frames: TimelineFrame[],
  participants: MatchParticipant[],
  playerPuuid: string
): DetectorResult {
  const errors: DetectedError[] = [];
  const stats = {
    totalDeaths: 0,
    soloDeaths: 0,
    towerdiveDeaths: 0,
    isolatedDeaths: 0,
    gangDeaths: 0,
  };

  const playerParticipant = participants.find(p => p.puuid === playerPuuid);
  if (!playerParticipant) {
    return { errors, stats };
  }

  const playerParticipantId = playerParticipant.participantId;
  const playerTeamId = playerParticipant.teamId;
  const playerPosition = playerParticipant.teamPosition;

  const opponent = participants.find(
    p => p.teamId !== playerTeamId && p.teamPosition === playerPosition
  );

  for (const frame of frames) {
    for (const event of frame.events) {
      if (event.type !== 'CHAMPION_KILL') continue;
      if (event.victimId !== playerParticipantId) continue;

      stats.totalDeaths++;

      const timestamp = event.timestamp;
      const gamePhase = getGamePhase(timestamp);
      const position = event.position || { x: 7500, y: 7500 };
      const { safety } = getMapZone(position.x, position.y, playerTeamId);

      const currentFrameIndex = Math.floor(timestamp / 60000);
      const currentFrame = frames[currentFrameIndex] || frame;
      const playerFrame = currentFrame.participantFrames[playerParticipantId.toString()];

      const killer = participants.find(p => p.participantId === event.killerId);
      const killerFrame = event.killerId
        ? currentFrame.participantFrames[event.killerId.toString()]
        : null;

      let goldDifferential = 0;
      let levelDifferential = 0;
      if (opponent && playerFrame) {
        const opponentFrame = currentFrame.participantFrames[opponent.participantId.toString()];
        if (opponentFrame) {
          goldDifferential = playerFrame.totalGold - opponentFrame.totalGold;
          levelDifferential = playerFrame.level - opponentFrame.level;
        }
      } else if (killerFrame && playerFrame) {
        goldDifferential = playerFrame.totalGold - killerFrame.totalGold;
        levelDifferential = playerFrame.level - killerFrame.level;
      }

      const wasUnderTower = isUnderEnemyTower(position, playerTeamId);
      const nearestAlly = findNearestAlly(
        position,
        playerParticipantId,
        currentFrame.participantFrames,
        participants,
        playerTeamId
      );

      const assistCount = event.assistingParticipantIds?.length || 0;
      const wasGanked = assistCount >= 1;

      let severity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
      let title = '';
      let description = '';
      let suggestion = '';
      let coachingNote = '';
      let errorType = 'positioning';

      const minuteTimestamp = Math.floor(timestamp / 60000);
      const secondTimestamp = Math.floor((timestamp % 60000) / 1000);
      const timeStr = `${minuteTimestamp}:${secondTimestamp.toString().padStart(2, '0')}`;

      if (wasUnderTower) {
        stats.towerdiveDeaths++;
        severity = 'critical';
        errorType = 'positioning';
        title = 'Mort sous tour ennemie';
        description = `Tu es mort sous la tour ennemie a ${timeStr}. ${
          wasGanked
            ? `Tu as ete pris en sandwich par ${assistCount + 1} ennemis.`
            : `${killer?.championName || 'L\'ennemi'} t'a tue sous sa tour.`
        }`;
        suggestion = 'Ne dive pas sans minions pour tanker la tour, et assure-toi d\'avoir assez de degats pour finir rapidement.';
        coachingNote = wasGanked
          ? 'Les dives coordonnes de l\'ennemi etaient probablement telegraphes. Regarde ta minimap avant d\'aller sous tour.'
          : 'Avant de dive, verifie que tu as: 1) Des minions, 2) Assez de HP, 3) Tes cooldowns prets.';
      } else if (nearestAlly && nearestAlly.distance > 2500) {
        stats.isolatedDeaths++;
        severity = safety === 'danger' ? 'critical' : 'high';
        errorType = 'positioning';
        title = 'Mort en position isolee';
        description = `Tu es mort a ${timeStr} alors que tu etais isole. Ton allie le plus proche (${nearestAlly.champion}) etait a ${nearestAlly.distance} unites.`;
        suggestion = 'Reste proche de ton equipe, surtout quand tu n\'as pas de vision de l\'ennemi.';
        coachingNote = safety === 'danger'
          ? `Tu etais en territoire ennemi. C'est tres risque sans ton equipe.`
          : 'Meme en zone neutre, l\'isolation te rend vulnerable aux picks.';
      } else if (wasGanked && assistCount >= 2) {
        stats.gangDeaths++;
        severity = 'high';
        errorType = 'map-awareness';
        title = 'Mort par gank multiple';
        description = `Tu as ete tue par ${assistCount + 1} ennemis a ${timeStr}. ${
          safety === 'danger'
            ? 'Tu etais en territoire dangereux.'
            : 'L\'ennemi a bien coordonne son gank.'
        }`;
        suggestion = 'Place plus de wards pour voir les rotations ennemies. Joue plus safe quand tu ne vois pas plusieurs ennemis sur la map.';
        coachingNote = 'Avant de push ou de trade, compte les ennemis visibles sur la map. Si tu n\'en vois pas 3+, presume qu\'ils viennent vers toi.';
      } else if (goldDifferential < -1000) {
        severity = 'high';
        errorType = 'trading';
        title = 'Mort avec desavantage gold';
        description = `Tu es mort a ${timeStr} contre ${killer?.championName || 'ton adversaire'} alors que tu avais ${Math.abs(goldDifferential)} gold de retard.`;
        suggestion = 'Evite les trades all-in quand tu es en retard. Farm safe et attends ton jungler ou un item powerspike.';
        coachingNote = `Avec ${Math.abs(goldDifferential)} gold de retard, ton adversaire a probablement 1 item de plus que toi. Respecte ce powerspike.`;
      } else if (levelDifferential < -1) {
        severity = 'medium';
        errorType = 'trading';
        title = 'Mort avec desavantage de niveau';
        description = `Tu es mort a ${timeStr} avec ${Math.abs(levelDifferential)} niveau(x) de retard sur ton adversaire.`;
        suggestion = 'Le niveau donne acces a plus de points de competence et de stats. N\'engage pas contre quelqu\'un de niveau superieur.';
        coachingNote = 'Chaque niveau donne environ 600 gold de stats. Attends d\'egaliser avant de fight.';
      } else {
        stats.soloDeaths++;
        severity = gamePhase === 'late' ? 'high' : 'medium';
        errorType = 'positioning';
        title = 'Mort evitable';
        description = `Tu es mort a ${timeStr} contre ${killer?.championName || 'l\'ennemi'}${wasGanked ? ' avec aide' : ''}.`;
        suggestion = 'Analyse ce qui t\'a amene a cette position. Aurais-tu pu eviter ce fight?';
        coachingNote = gamePhase === 'late'
          ? 'En late game, une mort peut couter la partie. Sois extra prudent avec ton positionnement.'
          : 'Chaque mort donne de l\'avantage a l\'ennemi. Minimise tes morts pour garder le controle.';
      }

      errors.push({
        type: errorType,
        severity,
        timestamp: Math.floor(timestamp / 1000),
        title,
        description,
        suggestion,
        coachingNote,
        context: {
          goldState: {
            player: playerFrame?.totalGold || 0,
            opponent: killerFrame?.totalGold || 0,
            differential: goldDifferential,
          },
          levelState: {
            player: playerFrame?.level || 1,
            opponent: killerFrame?.level || 1,
          },
          mapState: {
            zone: safety,
            nearestAlly: nearestAlly || undefined,
            nearestEnemy: killer ? {
              champion: killer.championName,
              distance: 0,
            } : undefined,
            playerPosition: position,
          },
          gamePhase,
        },
      });
    }
  }

  return { errors, stats };
}
