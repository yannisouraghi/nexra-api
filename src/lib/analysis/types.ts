// Types for Riot API Timeline-based Analysis Engine

// Riot API Timeline Frame (every minute of game)
export interface TimelineFrame {
  timestamp: number; // milliseconds
  participantFrames: {
    [participantId: string]: ParticipantFrame;
  };
  events: TimelineEvent[];
}

export interface ParticipantFrame {
  participantId: number;
  position: { x: number; y: number };
  currentGold: number;
  totalGold: number;
  level: number;
  xp: number;
  minionsKilled: number;
  jungleMinionsKilled: number;
  timeEnemySpentControlled: number;
}

// Timeline Events
export type TimelineEventType =
  | 'CHAMPION_KILL'
  | 'ELITE_MONSTER_KILL'
  | 'BUILDING_KILL'
  | 'WARD_PLACED'
  | 'WARD_KILL'
  | 'ITEM_PURCHASED'
  | 'ITEM_DESTROYED'
  | 'ITEM_SOLD'
  | 'ITEM_UNDO'
  | 'SKILL_LEVEL_UP'
  | 'LEVEL_UP'
  | 'TURRET_PLATE_DESTROYED'
  | 'CHAMPION_TRANSFORM'
  | 'DRAGON_SOUL_GIVEN'
  | 'GAME_END';

export interface TimelineEvent {
  type: TimelineEventType;
  timestamp: number;
  participantId?: number;
  // CHAMPION_KILL
  killerId?: number;
  victimId?: number;
  assistingParticipantIds?: number[];
  position?: { x: number; y: number };
  victimDamageReceived?: Array<{
    participantId: number;
    basic: boolean;
    magicDamage: number;
    physicalDamage: number;
    trueDamage: number;
    spellName: string;
    spellSlot: number;
    type: string;
  }>;
  // ELITE_MONSTER_KILL
  monsterType?: 'DRAGON' | 'BARON_NASHOR' | 'RIFTHERALD' | 'ELDER_DRAGON' | 'HORDE';
  monsterSubType?: 'FIRE_DRAGON' | 'WATER_DRAGON' | 'EARTH_DRAGON' | 'AIR_DRAGON' | 'HEXTECH_DRAGON' | 'CHEMTECH_DRAGON';
  killerTeamId?: number;
  // WARD
  wardType?: 'YELLOW_TRINKET' | 'CONTROL_WARD' | 'SIGHT_WARD' | 'BLUE_TRINKET' | 'TEEMO_MUSHROOM' | 'UNDEFINED';
  creatorId?: number;
  // BUILDING_KILL
  buildingType?: 'TOWER_BUILDING' | 'INHIBITOR_BUILDING';
  towerType?: 'OUTER_TURRET' | 'INNER_TURRET' | 'BASE_TURRET' | 'NEXUS_TURRET';
  laneType?: 'TOP_LANE' | 'MID_LANE' | 'BOT_LANE';
  teamId?: number;
  // ITEM
  itemId?: number;
  afterId?: number;
  beforeId?: number;
  goldGain?: number;
  // SKILL/LEVEL
  skillSlot?: number;
}

// Match participant info
export interface MatchParticipant {
  participantId: number;
  puuid: string;
  championId: number;
  championName: string;
  teamId: number;
  teamPosition: string; // TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
  totalGold: number;
  visionScore: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
}

// Analysis context for a specific moment
export interface AnalysisContext {
  timestamp: number;
  gamePhase: 'early' | 'mid' | 'late';
  playerFrame: ParticipantFrame;
  opponentFrame?: ParticipantFrame;
  allFrames: { [participantId: string]: ParticipantFrame };
  recentEvents: TimelineEvent[];
  playerTeamId: number;
}

// Death context for analysis
export interface DeathContext {
  timestamp: number;
  position: { x: number; y: number };
  killerId: number;
  killerChampion: string;
  assistingIds: number[];
  goldDifferential: number;
  levelDifferential: number;
  wasUnderTower: boolean;
  hadVisionOfKiller: boolean;
  nearestAllyDistance: number;
  nearestAllyChampion?: string;
  gamePhase: 'early' | 'mid' | 'late';
  zone: 'safe' | 'neutral' | 'danger';
  recentDamageReceived: Array<{
    source: string;
    damage: number;
    type: 'physical' | 'magic' | 'true';
  }>;
}

// CS analysis snapshot
export interface CSSnapshot {
  timestamp: number;
  playerCS: number;
  opponentCS: number;
  differential: number;
  expectedCS: number; // Based on game time
  missedGold: number;
}

// Objective context
export interface ObjectiveContext {
  timestamp: number;
  objectiveType: 'dragon' | 'baron' | 'herald' | 'tower';
  takenByEnemy: boolean;
  playerAlive: boolean;
  playerDistance: number;
  teamAlive: number;
  enemyAlive: number;
  goldDifferential: number;
}

// Map zones based on coordinates
export type MapZone =
  | 'blue_base'
  | 'red_base'
  | 'blue_jungle'
  | 'red_jungle'
  | 'river_top'
  | 'river_bot'
  | 'dragon_pit'
  | 'baron_pit'
  | 'top_lane'
  | 'mid_lane'
  | 'bot_lane';

// Detector result
export interface DetectorResult {
  errors: DetectedError[];
  stats: DetectorStats;
}

export interface DetectedError {
  id?: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  timestamp: number;
  title: string;
  description: string;
  suggestion: string;
  coachingNote?: string;
  context: {
    goldState?: {
      player: number;
      opponent: number;
      differential: number;
    };
    levelState?: {
      player: number;
      opponent: number;
    };
    mapState?: {
      zone: 'safe' | 'neutral' | 'danger';
      nearestAlly?: { champion: string; distance: number };
      nearestEnemy?: { champion: string; distance: number };
      playerPosition?: { x: number; y: number };
    };
    visionState?: {
      playerWardsActive: number;
      areaWarded: boolean;
    };
    csState?: {
      player: number;
      opponent: number;
      differential: number;
    };
    gamePhase: 'early' | 'mid' | 'late';
  };
}

export interface DetectorStats {
  [key: string]: number;
}

// Full analysis result
export interface AnalysisResult {
  matchId: string;
  puuid: string;
  champion: string;
  result: 'win' | 'loss';
  duration: number;
  errors: DetectedError[];
  stats: {
    overallScore: number;
    csScore: number;
    visionScore: number;
    positioningScore: number;
    objectiveScore: number;
    tradingScore: number;
    deathsAnalyzed: number;
    errorsFound: number;
  };
  tips: Array<{
    id: string;
    category: string;
    title: string;
    description: string;
    priority: number;
    relatedErrors?: string[];
  }>;
}
