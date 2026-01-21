// Coaching Tip Generator - Generates personalized tips based on analysis results

import { DetectedError } from '../types';

interface CoachingTip {
  id: string;
  category: string;
  title: string;
  description: string;
  priority: number;
  relatedErrors?: string[];
  role?: string; // Role-specific tip
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

// Role type
type Role = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT' | 'UNKNOWN';

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

// Role-specific coaching tips
const ROLE_SPECIFIC_TIPS: Record<Role, CoachingTip[]> = {
  'TOP': [
    {
      id: 'top-1',
      category: 'Toplaner',
      title: 'Gestion du freeze',
      description: 'En tant que Toplaner, apprends a freeze pres de ta tour. Ca te protege des ganks et force l\'ennemi a overextend pour farm.',
      priority: 1,
      role: 'TOP',
    },
    {
      id: 'top-2',
      category: 'Toplaner',
      title: 'TP pour objectifs',
      description: 'Garde ton TP pour rejoindre les fights bot ou contester Drake. Ne le gaspille pas pour revenir en lane apres un back.',
      priority: 1,
      role: 'TOP',
    },
    {
      id: 'top-3',
      category: 'Toplaner',
      title: 'Herald timing',
      description: 'Entre 8 et 14 min, c\'est TON moment pour le Herald. Ping ton jungler et prepare la vision.',
      priority: 2,
      role: 'TOP',
    },
    {
      id: 'top-4',
      category: 'Toplaner',
      title: 'Split push efficace',
      description: 'Split push seulement avec vision. Pose 2 wards dans la jungle ennemie avant de push profond.',
      priority: 2,
      role: 'TOP',
    },
  ],
  'JUNGLE': [
    {
      id: 'jg-1',
      category: 'Jungler',
      title: 'Objectifs > Ganks',
      description: 'Priorise toujours les objectifs (Drake, Herald, Baron) sur les ganks. Un objectif = avantage garanti.',
      priority: 1,
      role: 'JUNGLE',
    },
    {
      id: 'jg-2',
      category: 'Jungler',
      title: 'Track le jungler ennemi',
      description: 'Note ou le jungler ennemi a ete vu. S\'il gank top, tu peux prendre son bot side ou gank bot.',
      priority: 1,
      role: 'JUNGLE',
    },
    {
      id: 'jg-3',
      category: 'Jungler',
      title: 'Gank des lanes pushees',
      description: 'Ne gank jamais une lane poussee sous tour ennemie. Attend que ton laner push ou gank ailleurs.',
      priority: 2,
      role: 'JUNGLE',
    },
    {
      id: 'jg-4',
      category: 'Jungler',
      title: 'Vision pre-objectif',
      description: '1 minute avant Drake/Baron, place des wards et sweep la zone. C\'est TA responsabilite.',
      priority: 2,
      role: 'JUNGLE',
    },
  ],
  'MID': [
    {
      id: 'mid-1',
      category: 'Midlaner',
      title: 'Roam apres push',
      description: 'Push ta wave AVANT de roam. Sinon tu perds du CS et ton roam peut echouer si ta wave est sous ta tour.',
      priority: 1,
      role: 'MID',
    },
    {
      id: 'mid-2',
      category: 'Midlaner',
      title: 'Prio pour ton jungler',
      description: 'Si tu as la prio mid, ton jungler peut envahir et contester les scuttles. Aide-le sur les contests.',
      priority: 1,
      role: 'MID',
    },
    {
      id: 'mid-3',
      category: 'Midlaner',
      title: 'Track les roams ennemis',
      description: 'Si ton adversaire disparait, PING immediatement. Meme si tu n\'es pas sur, un ping peut sauver tes teammates.',
      priority: 2,
      role: 'MID',
    },
    {
      id: 'mid-4',
      category: 'Midlaner',
      title: 'Conteste les objectifs',
      description: 'Ta position centrale te permet d\'arriver rapidement sur Drake/Herald. Sois present pour chaque contest.',
      priority: 2,
      role: 'MID',
    },
  ],
  'ADC': [
    {
      id: 'adc-1',
      category: 'ADC',
      title: 'Survie = DPS',
      description: 'Un ADC mort fait 0 degats. Reste TOUJOURS derriere ton frontline et ne facecheck jamais.',
      priority: 1,
      role: 'ADC',
    },
    {
      id: 'adc-2',
      category: 'ADC',
      title: 'Kiting en teamfight',
      description: 'Utilise attack-move (A + click) pour kite automatiquement. Frappe la cible la plus proche et safe.',
      priority: 1,
      role: 'ADC',
    },
    {
      id: 'adc-3',
      category: 'ADC',
      title: 'Farm side lane safe',
      description: 'Ne farm pas une side lane sans vision. Si tu ne vois pas 3+ ennemis, joue comme s\'ils venaient vers toi.',
      priority: 2,
      role: 'ADC',
    },
    {
      id: 'adc-4',
      category: 'ADC',
      title: 'Presence sur Drake',
      description: 'Ton DPS est crucial pour secure Drake rapidement. Sois TOUJOURS present, meme si tu dois perdre quelques CS.',
      priority: 2,
      role: 'ADC',
    },
  ],
  'SUPPORT': [
    {
      id: 'sup-1',
      category: 'Support',
      title: 'Vision = Victoire',
      description: 'Achete des Control Wards a CHAQUE back. Place-les pres des objectifs ou dans les bushes de la jungle.',
      priority: 1,
      role: 'SUPPORT',
    },
    {
      id: 'sup-2',
      category: 'Support',
      title: 'Peel ton ADC',
      description: 'En teamfight, ta priorite #1 est de garder ton ADC en vie. Utilise tes CC sur les assassins qui le ciblent.',
      priority: 1,
      role: 'SUPPORT',
    },
    {
      id: 'sup-3',
      category: 'Support',
      title: 'Roam mid efficace',
      description: 'Roam mid apres avoir push la wave bot. Previens ton ADC et ward la riviere avant de partir.',
      priority: 2,
      role: 'SUPPORT',
    },
    {
      id: 'sup-4',
      category: 'Support',
      title: 'Sweep avant objectifs',
      description: 'Utilise ton Sweeper autour de Drake/Baron 1 min avant le spawn. Deny la vision ennemie est crucial.',
      priority: 2,
      role: 'SUPPORT',
    },
  ],
  'UNKNOWN': [],
};

export function generateCoachingTips(
  errors: DetectedError[],
  scores: {
    csScore: number;
    visionScore: number;
    positioningScore: number;
    objectiveScore: number;
    tradingScore: number;
  },
  role: Role = 'UNKNOWN'
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

  // FIRST: Add 1-2 role-specific tips (highest priority)
  const roleTips = ROLE_SPECIFIC_TIPS[role] || [];
  for (const tip of roleTips) {
    if (tips.length >= 2) break; // Max 2 role-specific tips first
    if (usedTipIds.has(tip.id)) continue;

    tips.push({
      ...tip,
      priority: tips.length + 1,
    });
    usedTipIds.add(tip.id);
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
      if (tips.length >= 5) break; // Max 5 tips total

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

  // Add remaining role-specific tips if we have room
  if (tips.length < 5 && role !== 'UNKNOWN') {
    for (const tip of roleTips) {
      if (usedTipIds.has(tip.id)) continue;
      if (tips.length >= 5) break;

      tips.push(tip);
      usedTipIds.add(tip.id);
    }
  }

  // Assign final priorities
  tips.forEach((tip, index) => {
    tip.priority = index + 1;
  });

  return tips;
}
