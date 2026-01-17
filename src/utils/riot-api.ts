// Riot API utilities for fetching match data and timeline

import { TimelineFrame, TimelineEvent, TimelineEventType, MatchParticipant } from '../lib/analysis/types';

export interface RiotMatchData {
  metadata: {
    matchId: string;
    participants: string[];
  };
  info: {
    gameDuration: number;
    gameMode: string;
    participants: Array<{
      participantId: number;
      puuid: string;
      championId: number;
      championName: string;
      teamId: number;
      teamPosition: string;
      kills: number;
      deaths: number;
      assists: number;
      win: boolean;
      totalGold: number;
      goldEarned: number;
      visionScore: number;
      totalMinionsKilled: number;
      neutralMinionsKilled: number;
    }>;
  };
}

export interface RiotTimelineData {
  metadata: {
    matchId: string;
    participants: string[];
  };
  info: {
    frameInterval: number;
    frames: Array<{
      timestamp: number;
      participantFrames: {
        [key: string]: {
          participantId: number;
          position: { x: number; y: number };
          currentGold: number;
          totalGold: number;
          level: number;
          xp: number;
          minionsKilled: number;
          jungleMinionsKilled: number;
          timeEnemySpentControlled: number;
        };
      };
      events: Array<{
        type: string;
        timestamp: number;
        participantId?: number;
        killerId?: number;
        victimId?: number;
        assistingParticipantIds?: number[];
        position?: { x: number; y: number };
        monsterType?: string;
        monsterSubType?: string;
        killerTeamId?: number;
        wardType?: string;
        creatorId?: number;
        buildingType?: string;
        towerType?: string;
        laneType?: string;
        teamId?: number;
        itemId?: number;
        skillSlot?: number;
      }>;
    }>;
  };
}

// Map region codes to Riot API routing values
const REGIONAL_ROUTING: Record<string, string> = {
  // Americas
  na1: 'americas',
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  // Europe
  euw1: 'europe',
  eun1: 'europe',
  tr1: 'europe',
  ru: 'europe',
  // Asia
  kr: 'asia',
  jp1: 'asia',
  // SEA
  oc1: 'sea',
  ph2: 'sea',
  sg2: 'sea',
  th2: 'sea',
  tw2: 'sea',
  vn2: 'sea',
};

export function getRegionalRouting(region: string): string {
  return REGIONAL_ROUTING[region.toLowerCase()] || 'europe';
}

export async function fetchMatchData(
  matchId: string,
  region: string,
  apiKey: string
): Promise<RiotMatchData> {
  const routing = getRegionalRouting(region);
  const url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`;

  const response = await fetch(url, {
    headers: {
      'X-Riot-Token': apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch match data: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function fetchMatchTimeline(
  matchId: string,
  region: string,
  apiKey: string
): Promise<RiotTimelineData> {
  const routing = getRegionalRouting(region);
  const url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`;

  const response = await fetch(url, {
    headers: {
      'X-Riot-Token': apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch timeline: ${response.status} - ${error}`);
  }

  return response.json();
}

// Transform Riot API data to our analysis format
export function transformMatchData(riotMatch: RiotMatchData): {
  matchId: string;
  gameDuration: number;
  gameMode: string;
  participants: MatchParticipant[];
} {
  return {
    matchId: riotMatch.metadata.matchId,
    gameDuration: riotMatch.info.gameDuration,
    gameMode: riotMatch.info.gameMode,
    participants: riotMatch.info.participants.map(p => ({
      participantId: p.participantId,
      puuid: p.puuid,
      championId: p.championId,
      championName: p.championName,
      teamId: p.teamId,
      teamPosition: p.teamPosition || '',
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      win: p.win,
      totalGold: p.goldEarned,
      visionScore: p.visionScore,
      totalMinionsKilled: p.totalMinionsKilled,
      neutralMinionsKilled: p.neutralMinionsKilled,
    })),
  };
}

export function transformTimelineData(riotTimeline: RiotTimelineData): {
  frames: TimelineFrame[];
} {
  return {
    frames: riotTimeline.info.frames.map(frame => ({
      timestamp: frame.timestamp,
      participantFrames: frame.participantFrames,
      events: frame.events.map(event => ({
        type: event.type as TimelineEventType,
        timestamp: event.timestamp,
        participantId: event.participantId,
        killerId: event.killerId,
        victimId: event.victimId,
        assistingParticipantIds: event.assistingParticipantIds,
        position: event.position,
        monsterType: event.monsterType as TimelineEvent['monsterType'],
        monsterSubType: event.monsterSubType as TimelineEvent['monsterSubType'],
        killerTeamId: event.killerTeamId,
        wardType: event.wardType as TimelineEvent['wardType'],
        creatorId: event.creatorId,
        buildingType: event.buildingType as TimelineEvent['buildingType'],
        towerType: event.towerType as TimelineEvent['towerType'],
        laneType: event.laneType as TimelineEvent['laneType'],
        teamId: event.teamId,
        itemId: event.itemId,
        skillSlot: event.skillSlot,
      })),
    })),
  };
}
