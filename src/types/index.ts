// Environment bindings for Cloudflare Workers
export interface Env {
  DB: D1Database;
  VIDEOS: R2Bucket;
  ANALYSIS_QUEUE: Queue<AnalysisJob>;
  CACHE: KVNamespace;
  ANTHROPIC_API_KEY: string;
  RIOT_API_KEY: string;
  RESEND_API_KEY: string;
  FRONTEND_URL: string;
  ENVIRONMENT: string;
}

// Match data from Riot API (sent by nexra-vision)
export interface RiotMatchData {
  // Basic info
  champion?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  win?: boolean;
  duration?: number;
  gameMode?: string;
  queueId?: number;

  // Role/Position
  role?: string;
  lane?: string;
  teamPosition?: string;

  // CS and Gold
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  goldEarned?: number;
  goldSpent?: number;

  // Vision
  visionScore?: number;
  wardsPlaced?: number;
  wardsKilled?: number;
  detectorWardsPlaced?: number;

  // Damage
  totalDamageDealtToChampions?: number;
  totalDamageTaken?: number;
  damageDealtToObjectives?: number;

  // Combat stats
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
  firstBloodKill?: boolean;
  firstTowerKill?: boolean;

  // Items and Level
  items?: number[];
  champLevel?: number;
  summoner1Id?: number;
  summoner2Id?: number;

  // Player ranking in game (1 = MVP)
  rank?: number;

  // Context for AI analysis
  teammates?: Array<{
    championName: string;
    kills: number;
    deaths: number;
    assists: number;
    totalDamageDealtToChampions?: number;
    goldEarned?: number;
  }>;
  enemies?: Array<{
    championName: string;
    kills: number;
    deaths: number;
    assists: number;
    totalDamageDealtToChampions?: number;
    goldEarned?: number;
  }>;
}

// Queue job for async analysis
export interface AnalysisJob {
  analysisId: string;
  matchId: string;
  puuid: string;
  region: string;
  videoKey: string;
  matchData?: RiotMatchData; // Full match data from Riot API
}

// Error types - Extended for detailed coaching
export type ErrorType =
  | 'positioning'
  | 'timing'
  | 'cs-missing'
  | 'vision'
  | 'objective'
  | 'map-awareness'
  | 'itemization'
  | 'cooldown-tracking'
  | 'trading'
  | 'wave-management'
  | 'roaming'
  | 'teamfight'
  // Extended types from AI analysis
  | 'death-timing'
  | 'power-spike'
  | 'macro-positioning'
  | 'back-timing'
  | 'split-push'
  | 'timing-exploitation';

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface GameError {
  id: string;
  type: ErrorType;
  severity: ErrorSeverity;
  title: string;
  description: string;
  timestamp: number;
  suggestion: string;
  // Video clip timestamps for error replay
  clipStart?: number;
  clipEnd?: number;
  // Extended coaching note
  coachingNote?: string;
  videoClip?: {
    start: number;
    end: number;
    url: string;
  };
}

export interface CoachingTip {
  id: string;
  category: string;
  title: string;
  description: string;
  priority: number;
  relatedErrors?: string[];
  // Practical exercise for improvement
  exercice?: string;
}

export interface VideoClip {
  id: string;
  type: 'error' | 'highlight' | 'death';
  timestamp: number;
  duration: number;
  title: string;
  description: string;
  url: string;
  thumbnailUrl?: string;
  // Video timestamps for clip extraction
  startTime?: number;
  endTime?: number;
  // Link to related error
  errorId?: string;
  // AI Analysis for death clips
  aiAnalysis?: {
    deathCause: string;
    mistakes: string[];
    suggestions: string[];
    situationalAdvice: string;
    severity: ErrorSeverity;
  };
}

// Performance summary from AI analysis
export interface PerformanceSummary {
  overallAssessment: string;
  strengths: string[];
  weaknesses: string[];
  improvementPlan: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
  };
  estimatedRank?: string;
  rankUpTip?: string;
}

export interface AnalysisStats {
  overallScore: number;
  csScore: number;
  visionScore: number;
  positioningScore: number;
  objectiveScore: number;
  deathsAnalyzed: number;
  errorsFound: number;
  comparedToRank: {
    metric: string;
    yours: number;
    average: number;
    percentile: number;
  }[];
  // Performance summary from AI coach
  performanceSummary?: PerformanceSummary;
}

export interface Analysis {
  id: string;
  matchId: string;
  puuid: string;
  region: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;

  // Game info
  champion?: string;
  result?: 'win' | 'loss';
  duration?: number;
  gameMode?: string;
  kills?: number;
  deaths?: number;
  assists?: number;

  // Analysis results
  stats?: AnalysisStats;
  errors?: GameError[];
  tips?: CoachingTip[];
  clips?: VideoClip[];

  // Error info
  errorMessage?: string;
}

export interface Recording {
  id: string;
  matchId: string;
  puuid: string;
  region: string;
  videoKey: string;
  duration?: number;
  fileSize?: number;
  createdAt: string;
  uploadedAt?: string;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
