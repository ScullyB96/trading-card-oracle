
import { ExtractedCardKeywords } from './vision-parser.ts';
import { Logger } from './logger.ts';

export interface QuerySet {
  primaryQueries: string[];
  secondaryQueries: string[];
  fallbackQueries: string[];
  allQueries: string[];
}

export function generateSearchQueries(cardKeywords: ExtractedCardKeywords, logger: Logger): QuerySet {
  logger.info('Generating enhanced search queries v2.0', {
    operation: 'generateSearchQueries',
    player: cardKeywords.player,
    year: cardKeywords.year,
    set: cardKeywords.set
  });

  const primaryQueries: string[] = [];
  const secondaryQueries: string[] = [];
  const fallbackQueries: string[] = [];

  const player = normalizePlayerName(cardKeywords.player);
  const year = cardKeywords.year !== 'unknown' ? cardKeywords.year : '';
  const set = cardKeywords.set !== 'unknown' ? cardKeywords.set : '';
  const cardNumber = cardKeywords.cardNumber !== 'unknown' ? cardKeywords.cardNumber : '';
  const sport = cardKeywords.sport || 'card';

  if (!player) {
    logger.warn('No player name available for search queries');
    return { primaryQueries: [], secondaryQueries: [], fallbackQueries: [], allQueries: [] };
  }

  // PRIMARY QUERIES (highest priority)
  if (year && set) {
    primaryQueries.push(`${player} ${year} ${set} card`);
    primaryQueries.push(`${player} ${year} ${set}`);
    
    if (cardNumber) {
      primaryQueries.push(`${player} ${year} ${set} #${cardNumber}`);
      primaryQueries.push(`${player} ${year} ${set} ${cardNumber}`);
    }
  }

  if (year) {
    primaryQueries.push(`${player} ${year} ${sport} card`);
    primaryQueries.push(`${player} ${year} rookie card`);
    primaryQueries.push(`${player} ${year} RC`);
  }

  // SECONDARY QUERIES (good alternatives)
  if (set && set !== 'unknown') {
    secondaryQueries.push(`${player} ${set} card`);
    secondaryQueries.push(`${player} ${set}`);
  }

  // Add special attributes to queries
  if (cardKeywords.specialAttributes && cardKeywords.specialAttributes.length > 0) {
    for (const attr of cardKeywords.specialAttributes.slice(0, 2)) {
      if (year) {
        secondaryQueries.push(`${player} ${year} ${attr}`);
      }
      secondaryQueries.push(`${player} ${attr} card`);
    }
  }

  // Add parallels to queries
  if (cardKeywords.parallels && cardKeywords.parallels.length > 0) {
    for (const parallel of cardKeywords.parallels.slice(0, 2)) {
      if (year) {
        secondaryQueries.push(`${player} ${year} ${parallel}`);
      }
      secondaryQueries.push(`${player} ${parallel} card`);
    }
  }

  // FALLBACK QUERIES (broader searches)
  fallbackQueries.push(`${player} ${sport} card`);
  fallbackQueries.push(`${player} card`);
  
  if (year) {
    fallbackQueries.push(`${player} ${year}`);
  }

  // Add team-based queries if available
  if (cardKeywords.team && cardKeywords.team !== 'unknown') {
    const teamName = normalizeTeamName(cardKeywords.team);
    fallbackQueries.push(`${player} ${teamName} card`);
    if (year) {
      fallbackQueries.push(`${player} ${teamName} ${year}`);
    }
  }

  // Clean and deduplicate queries
  const cleanPrimary = cleanAndDeduplicateQueries(primaryQueries).slice(0, 4);
  const cleanSecondary = cleanAndDeduplicateQueries(secondaryQueries).slice(0, 3);
  const cleanFallback = cleanAndDeduplicateQueries(fallbackQueries).slice(0, 3);

  const allQueries = [...cleanPrimary, ...cleanSecondary, ...cleanFallback];

  logger.info('Enhanced query generation complete v2.0', {
    operation: 'generateSearchQueries',
    primaryCount: cleanPrimary.length,
    secondaryCount: cleanSecondary.length,
    fallbackCount: cleanFallback.length,
    totalQueries: allQueries.length
  });

  return {
    primaryQueries: cleanPrimary,
    secondaryQueries: cleanSecondary,
    fallbackQueries: cleanFallback,
    allQueries
  };
}

function normalizePlayerName(player: string): string {
  if (!player || player === 'unknown') return '';
  
  return player
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ') // Normalize spaces
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function normalizeTeamName(team: string): string {
  if (!team || team === 'unknown') return '';
  
  // Common team name normalizations
  const teamMappings: { [key: string]: string } = {
    'washington commanders': 'Commanders',
    'kansas city chiefs': 'Chiefs',
    'los angeles lakers': 'Lakers',
    'golden state warriors': 'Warriors',
    'new york yankees': 'Yankees',
    'boston celtics': 'Celtics'
  };
  
  const normalized = team.toLowerCase().trim();
  return teamMappings[normalized] || team.split(' ').pop() || team;
}

function cleanAndDeduplicateQueries(queries: string[]): string[] {
  const cleaned = queries
    .map(query => query.trim())
    .filter(query => query.length > 5 && query.length < 100)
    .map(query => query.replace(/\s+/g, ' '));
  
  // Deduplicate
  const unique = [...new Set(cleaned)];
  
  return unique;
}

// Legacy function for backward compatibility
export function buildSearchQuery(keywords: ExtractedCardKeywords): string {
  const querySet = generateSearchQueries(keywords, { info: () => {}, warn: () => {}, error: () => {} } as Logger);
  return querySet.primaryQueries[0] || querySet.allQueries[0] || 'card';
}
