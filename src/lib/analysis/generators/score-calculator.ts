// Score Calculator - Calculates overall and category scores from analysis results

import { DetectedError } from '../types';

interface ScoreBreakdown {
  overallScore: number;
  csScore: number;
  visionScore: number;
  positioningScore: number;
  objectiveScore: number;
  tradingScore: number;
}

// Error type to category mapping
const ERROR_CATEGORIES: Record<string, keyof Omit<ScoreBreakdown, 'overallScore'>> = {
  'cs-missing': 'csScore',
  'vision': 'visionScore',
  'positioning': 'positioningScore',
  'map-awareness': 'positioningScore',
  'objective': 'objectiveScore',
  'trading': 'tradingScore',
  'timing': 'tradingScore',
  'wave-management': 'csScore',
  'itemization': 'tradingScore',
  'cooldown-tracking': 'tradingScore',
  'roaming': 'positioningScore',
  'teamfight': 'positioningScore',
};

// Severity penalty weights
const SEVERITY_PENALTIES: Record<string, number> = {
  critical: 15,
  high: 10,
  medium: 5,
  low: 2,
};

export function calculateScores(
  errors: DetectedError[],
  detectorStats: {
    deaths: { totalDeaths: number; soloDeaths: number; towerdiveDeaths: number };
    cs: { avgCSPerMin: number; maxCSDiff: number };
    vision: { wardsPerMinute: number; totalWardsPlaced: number };
    objectives: { dragonsLost: number; baronsLost: number };
  },
  matchResult: 'win' | 'loss',
  gameDuration: number
): ScoreBreakdown {
  // Start with perfect scores
  const scores: ScoreBreakdown = {
    overallScore: 100,
    csScore: 100,
    visionScore: 100,
    positioningScore: 100,
    objectiveScore: 100,
    tradingScore: 100,
  };

  // Apply penalties for each error
  for (const error of errors) {
    const category = ERROR_CATEGORIES[error.type] || 'positioningScore';
    const penalty = SEVERITY_PENALTIES[error.severity] || 5;

    scores[category] = Math.max(0, scores[category] - penalty);
  }

  // Bonus/Penalty based on stats

  // CS Score adjustments
  const csPerMin = detectorStats.cs.avgCSPerMin;
  if (csPerMin >= 8) {
    scores.csScore = Math.min(100, scores.csScore + 10);
  } else if (csPerMin >= 7) {
    scores.csScore = Math.min(100, scores.csScore + 5);
  } else if (csPerMin < 5) {
    scores.csScore = Math.max(0, scores.csScore - 10);
  }

  // Vision Score adjustments
  const wardsPerMin = detectorStats.vision.wardsPerMinute;
  if (wardsPerMin >= 1.0) {
    scores.visionScore = Math.min(100, scores.visionScore + 10);
  } else if (wardsPerMin >= 0.7) {
    scores.visionScore = Math.min(100, scores.visionScore + 5);
  } else if (wardsPerMin < 0.3) {
    scores.visionScore = Math.max(0, scores.visionScore - 15);
  }

  // Positioning Score - based on death types
  const deathsPerMin = detectorStats.deaths.totalDeaths / (gameDuration / 60);
  if (deathsPerMin < 0.2) {
    scores.positioningScore = Math.min(100, scores.positioningScore + 10);
  } else if (deathsPerMin > 0.4) {
    scores.positioningScore = Math.max(0, scores.positioningScore - 10);
  }

  // Objective Score adjustments
  if (detectorStats.objectives.baronsLost > 0) {
    scores.objectiveScore = Math.max(0, scores.objectiveScore - 10 * detectorStats.objectives.baronsLost);
  }
  if (detectorStats.objectives.dragonsLost >= 3) {
    scores.objectiveScore = Math.max(0, scores.objectiveScore - 10);
  }

  // Calculate overall score (weighted average)
  const weights = {
    csScore: 0.2,
    visionScore: 0.15,
    positioningScore: 0.3,
    objectiveScore: 0.15,
    tradingScore: 0.2,
  };

  scores.overallScore = Math.round(
    scores.csScore * weights.csScore +
    scores.visionScore * weights.visionScore +
    scores.positioningScore * weights.positioningScore +
    scores.objectiveScore * weights.objectiveScore +
    scores.tradingScore * weights.tradingScore
  );

  // Win bonus
  if (matchResult === 'win') {
    scores.overallScore = Math.min(100, scores.overallScore + 5);
  }

  // Round all scores
  scores.csScore = Math.round(scores.csScore);
  scores.visionScore = Math.round(scores.visionScore);
  scores.positioningScore = Math.round(scores.positioningScore);
  scores.objectiveScore = Math.round(scores.objectiveScore);
  scores.tradingScore = Math.round(scores.tradingScore);

  return scores;
}
