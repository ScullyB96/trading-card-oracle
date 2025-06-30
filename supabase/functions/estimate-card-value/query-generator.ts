
import { ExtractedCardKeywords } from './vision-parser.ts';
import { Logger } from './logger.ts';

export interface SearchQuerySet {
  primaryQueries: string[];
  secondaryQueries: string[];
  fallbackQueries: string[];
  allQueries: string[];
}

export function generateSearchQueries(keywords: ExtractedCardKeywords, logger: Logger): SearchQuerySet {
  logger.info('Generating optimized search queries', {
    operation: 'generateSearchQueries',
    player: keywords.player,
    year: keywords.year,
    set: keywords.set
  });

  const primaryQueries: string[] = [];
  const secondaryQueries: string[] = [];
  const fallbackQueries: string[] = [];

  const {
    player,
    team,
    year,
    set,
    cardNumber,
    parallels,
    specialAttributes,
    grade,
    sport
  } = keywords;

  // Ensure we have minimum required data
  if (!player || player === 'unknown') {
    logger.warn('Cannot generate queries without player name');
    return { primaryQueries: [], secondaryQueries: [], fallbackQueries: [], allQueries: [] };
  }

  // PRIMARY QUERIES - Simplified and more likely to find results
  if (year !== 'unknown' && set !== 'unknown') {
    primaryQueries.push(`${player} ${year} ${set} rookie card`);
    primaryQueries.push(`${player} ${year} ${set} RC`);
    
    if (cardNumber !== 'unknown') {
      primaryQueries.push(`${player} ${year} ${set} #${cardNumber}`);
    }
  }

  if (year !== 'unknown') {
    primaryQueries.push(`${player} ${year} rookie card sold`);
    primaryQueries.push(`${player} ${year} RC sold`);
  }

  // Add parallel-specific queries (limited)
  if (parallels.length > 0) {
    const topParallel = parallels[0]; // Just use the first parallel
    if (year !== 'unknown') {
      primaryQueries.push(`${player} ${year} ${topParallel} card`);
    }
  }

  // SECONDARY QUERIES - Broader searches
  if (set !== 'unknown') {
    secondaryQueries.push(`${player} ${set} rookie`);
  }

  if (sport !== 'unknown') {
    secondaryQueries.push(`${player} ${sport} rookie card`);
  }

  if (team) {
    secondaryQueries.push(`${player} ${team} rookie card`);
  }

  // FALLBACK QUERIES - Very broad
  fallbackQueries.push(`${player} rookie card`);
  fallbackQueries.push(`${player} RC`);

  // Clean and limit queries
  const cleanPrimary = cleanAndLimitQueries(primaryQueries, 4);
  const cleanSecondary = cleanAndLimitQueries(secondaryQueries.filter(q => !cleanPrimary.includes(q)), 3);
  const cleanFallback = cleanAndLimitQueries(fallbackQueries.filter(q => !cleanPrimary.includes(q) && !cleanSecondary.includes(q)), 2);

  const allQueries = [...cleanPrimary, ...cleanSecondary, ...cleanFallback];

  logger.info('Optimized query generation complete', {
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

function cleanAndLimitQueries(queries: string[], maxCount: number): string[] {
  return queries
    .map(query => query.trim())
    .filter(query => query.length >= 8) // Minimum meaningful length
    .filter(query => !query.includes('unknown'))
    .filter((query, index, self) => self.indexOf(query) === index) // Deduplicate
    .slice(0, maxCount); // Strict limit
}

export function generateSiteSpecificQueries(baseQuery: string, targetSites: string[] = ['ebay.com', '130point.com']): string[] {
  const siteQueries: string[] = [];
  
  // Simplified site queries - remove exact quotes that are too restrictive
  targetSites.forEach(site => {
    if (site.includes('ebay')) {
      siteQueries.push(`${baseQuery} sold site:ebay.com`);
    } else if (site.includes('130point')) {
      siteQueries.push(`${baseQuery} site:130point.com`);
    }
  });
  
  return siteQueries;
}
