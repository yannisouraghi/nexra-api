// Coaching Tip Generator - Generates personalized tips based on analysis results

import { DetectedError } from '../types';

interface CoachingTip {
  id: string;
  category: string;
  title: string;
  description: string;
  priority: number;
  relatedErrors?: string[];
}

// Error type to category mapping
const ERROR_CATEGORIES: Record<string, string> = {
  'cs-missing': 'Farm',
  'vision': 'Vision',
  'positioning': 'Positionnement',
  'map-awareness': 'Conscience Map',
  'objective': 'Objectifs',
  'trading': 'Trades',
  'timing': 'Timing',
  'wave-management': 'Gestion Waves',
  'itemization': 'Items',
  'cooldown-tracking': 'Cooldowns',
  'roaming': 'Roaming',
  'teamfight': 'Teamfight',
};

// Pre-defined coaching tips by category
const COACHING_TIPS: Record<string, CoachingTip[]> = {
  'cs-missing': [
    {
      id: 'cs-1',
      category: 'Farm',
      title: 'Pratique le last hit',
      description: 'Va en Practice Tool et entraine-toi a last hit sans utiliser de sorts. Vise 80+ CS a 10 min.',
      priority: 1,
    },
    {
      id: 'cs-2',
      category: 'Farm',
      title: 'CS sous tour',
      description: 'Apprends le pattern: 2 coups de tour + 1 auto pour les melees, 1 coup de tour + 1 auto pour les casters (avec items de depart).',
      priority: 2,
    },
  ],
  'vision': [
    {
      id: 'vision-1',
      category: 'Vision',
      title: 'Achete des Control Wards',
      description: 'Achete une Control Ward a chaque back. Place-la dans ta jungle ou pres des objectifs.',
      priority: 1,
    },
    {
      id: 'vision-2',
      category: 'Vision',
      title: 'Ward avant les objectifs',
      description: 'Place des wards 1 minute avant le spawn du Dragon/Baron pour avoir l\'information.',
      priority: 2,
    },
  ],
  'positioning': [
    {
      id: 'pos-1',
      category: 'Positionnement',
      title: 'Reste avec ton equipe',
      description: 'En mid/late game, ne te separe pas de ton equipe sauf si tu as de la vision et que tu sais ou sont les ennemis.',
      priority: 1,
    },
    {
      id: 'pos-2',
      category: 'Positionnement',
      title: 'Respecte le fog of war',
      description: 'Si tu ne vois pas 3+ ennemis sur la map, joue comme s\'ils venaient vers toi.',
      priority: 2,
    },
  ],
  'map-awareness': [
    {
      id: 'map-1',
      category: 'Conscience Map',
      title: 'Regarde ta minimap',
      description: 'Force-toi a regarder ta minimap toutes les 3 secondes. C\'est une habitude a developper.',
      priority: 1,
    },
    {
      id: 'map-2',
      category: 'Conscience Map',
      title: 'Track le jungler ennemi',
      description: 'Note mentalement ou le jungler ennemi a ete vu. S\'il etait bot, il sera top dans 30-40 sec.',
      priority: 2,
    },
  ],
  'objective': [
    {
      id: 'obj-1',
      category: 'Objectifs',
      title: 'Priorise les objectifs',
      description: 'Apres un kill ou un avantage, pense toujours: "Quel objectif puis-je prendre?"',
      priority: 1,
    },
    {
      id: 'obj-2',
      category: 'Objectifs',
      title: 'Time les objectifs',
      description: 'Le Dragon respawn 5 min apres, le Baron 6 min. Prepare-toi 1 min avant.',
      priority: 2,
    },
  ],
  'trading': [
    {
      id: 'trade-1',
      category: 'Trades',
      title: 'Trade quand l\'ennemi last hit',
      description: 'Attaque l\'ennemi quand il s\'approche pour last hit un minion. Il doit choisir entre te frapper ou prendre le CS.',
      priority: 1,
    },
    {
      id: 'trade-2',
      category: 'Trades',
      title: 'Respecte les powerspikes',
      description: 'Fais attention aux niveaux 2, 3, 6 et aux completions d\'items. Ce sont des moments ou ton adversaire devient plus fort.',
      priority: 2,
    },
  ],
};

export function generateCoachingTips(
  errors: DetectedError[],
  scores: {
    csScore: number;
    visionScore: number;
    positioningScore: number;
    objectiveScore: number;
    tradingScore: number;
  }
): CoachingTip[] {
  const tips: CoachingTip[] = [];
  const usedTipIds = new Set<string>();

  // Count errors by type
  const errorCounts: Record<string, number> = {};
  const errorIds: Record<string, string[]> = {};

  for (const error of errors) {
    const type = error.type;
    errorCounts[type] = (errorCounts[type] || 0) + 1;
    if (!errorIds[type]) errorIds[type] = [];
    errorIds[type].push(`error-${error.timestamp}`);
  }

  // Sort error types by count (most frequent first)
  const sortedTypes = Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);

  // Add tips for most common error types
  for (const errorType of sortedTypes) {
    const categoryTips = COACHING_TIPS[errorType];
    if (!categoryTips) continue;

    for (const tip of categoryTips) {
      if (usedTipIds.has(tip.id)) continue;
      if (tips.length >= 5) break; // Max 5 tips

      tips.push({
        ...tip,
        relatedErrors: errorIds[errorType]?.slice(0, 3),
      });
      usedTipIds.add(tip.id);
    }
  }

  // Add tips based on low scores
  const scoreCategories: Array<{ score: number; category: string }> = [
    { score: scores.csScore, category: 'cs-missing' },
    { score: scores.visionScore, category: 'vision' },
    { score: scores.positioningScore, category: 'positioning' },
    { score: scores.objectiveScore, category: 'objective' },
    { score: scores.tradingScore, category: 'trading' },
  ];

  // Sort by lowest score first
  scoreCategories.sort((a, b) => a.score - b.score);

  for (const { score, category } of scoreCategories) {
    if (score < 60 && tips.length < 5) {
      const categoryTips = COACHING_TIPS[category];
      if (!categoryTips) continue;

      for (const tip of categoryTips) {
        if (usedTipIds.has(tip.id)) continue;
        if (tips.length >= 5) break;

        tips.push(tip);
        usedTipIds.add(tip.id);
      }
    }
  }

  // Assign final priorities
  tips.forEach((tip, index) => {
    tip.priority = index + 1;
  });

  return tips;
}
