// Main Analysis Orchestrator
// Coordinates all detectors and generators to produce a complete game analysis

import { analyzeDeaths, analyzeCS, analyzeVision, analyzeObjectives } from './detectors';
import { calculateScores } from './generators/score-calculator';
import { generateCoachingTips } from './generators/coaching-tip-generator';
import {
  TimelineFrame,
  MatchParticipant,
  AnalysisResult,
  DetectedError,
} from './types';

export interface MatchData {
  matchId: string;
  gameDuration: number; // in seconds
  gameMode: string;
  participants: MatchParticipant[];
}

export interface TimelineData {
  frames: TimelineFrame[];
}

/**
 * Performs a complete analysis of a match using Riot API data
 */
export async function analyzeMatch(
  matchData: MatchData,
  timelineData: TimelineData,
  playerPuuid: string
): Promise<AnalysisResult> {
  const { frames } = timelineData;
  const { participants, matchId, gameDuration } = matchData;

  // Find player
  const playerParticipant = participants.find(p => p.puuid === playerPuuid);
  if (!playerParticipant) {
    throw new Error('Player not found in match participants');
  }

  // Run all detectors
  const deathResults = analyzeDeaths(frames, participants, playerPuuid);
  const csResults = analyzeCS(frames, participants, playerPuuid);
  const visionResults = analyzeVision(frames, participants, playerPuuid);
  const objectiveResults = analyzeObjectives(frames, participants, playerPuuid);

  // Combine all errors
  const allErrors: DetectedError[] = [
    ...deathResults.errors,
    ...csResults.errors,
    ...visionResults.errors,
    ...objectiveResults.errors,
  ];

  // Sort errors by timestamp
  allErrors.sort((a, b) => a.timestamp - b.timestamp);

  // Calculate scores
  const scores = calculateScores(
    allErrors,
    {
      deaths: {
        totalDeaths: deathResults.stats.totalDeaths || 0,
        soloDeaths: deathResults.stats.soloDeaths || 0,
        towerdiveDeaths: deathResults.stats.towerdiveDeaths || 0,
      },
      cs: {
        avgCSPerMin: csResults.stats.avgCSPerMin || 0,
        maxCSDiff: csResults.stats.maxCSDiff || 0,
      },
      vision: {
        wardsPerMinute: visionResults.stats.wardsPerMinute || 0,
        totalWardsPlaced: visionResults.stats.totalWardsPlaced || 0,
      },
      objectives: {
        dragonsLost: objectiveResults.stats.dragonsLost || 0,
        baronsLost: objectiveResults.stats.baronsLost || 0,
      },
    },
    playerParticipant.win ? 'win' : 'loss',
    gameDuration
  );

  // Generate coaching tips
  const tips = generateCoachingTips(allErrors, scores);

  // Build final result
  const result: AnalysisResult = {
    matchId,
    puuid: playerPuuid,
    champion: playerParticipant.championName,
    result: playerParticipant.win ? 'win' : 'loss',
    duration: gameDuration,
    errors: allErrors.map((error, index) => ({
      ...error,
      id: `error-${index}-${error.timestamp}`,
    })),
    stats: {
      overallScore: scores.overallScore,
      csScore: scores.csScore,
      visionScore: scores.visionScore,
      positioningScore: scores.positioningScore,
      objectiveScore: scores.objectiveScore,
      tradingScore: scores.tradingScore,
      deathsAnalyzed: deathResults.stats.totalDeaths || 0,
      errorsFound: allErrors.length,
    },
    tips: tips.map((tip, index) => ({
      ...tip,
      id: `tip-${index}`,
    })),
  };

  return result;
}

// Re-export types
export * from './types';
