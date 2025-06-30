
import { ExtractedCardKeywords } from './vision-parser.ts';
import { Logger } from './logger.ts';

export interface SearchQuerySet {
  primaryQueries: string[];
  secondaryQueries: string[];
  fallbackQueries: string[];
  allQueries: string[];
}

export function generateSearchQueries(keywords: ExtractedCardKeywords, logger: Logger): SearchQuerySet {
  logger.info('Generating revised search queries', {
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

  // PRIMARY QUERIES - More flexible and broader
  if (year !== 'unknown') {
    primaryQueries.push(`${player} ${year} rookie`);
    primaryQueries.push(`${player} ${year} RC`);
    primaryQueries.push(`${player} ${year} card`);
    
    if (set !== 'unknown') {
      primaryQueries.push(`${player} ${year} ${set}`);
      
      if (cardNumber !== 'unknown') {
        primaryQueries.push(`${player} ${year} ${set} ${cardNumber}`);
      }
    }
  }

  // Add sport-specific queries
  if (sport !== 'unknown') {
    primaryQueries.push(`${player} ${sport} rookie`);
    if (year !== 'unknown') {
      primaryQueries.push(`${player} ${sport} ${year}`);
    }
  }

  // Add team-specific queries
  if (team && team !== 'unknown') {
    primaryQueries.push(`${player} ${team} rookie`);
    if (year !== 'unknown') {
      primaryQueries.push(`${player} ${team} ${year}`);
    }
  }

  // SECONDARY QUERIES - Broader searches
  secondaryQueries.push(`${player} rookie card`);
  secondaryQueries.push(`${player} RC card`);
  
  if (set !== 'unknown') {
    secondaryQueries.push(`${player} ${set}`);
  }

  // Add parallel-specific queries
  if (parallels.length > 0) {
    const topParallel = parallels[0];
    secondaryQueries.push(`${player} ${topParallel}`);
    if (year !== 'unknown') {
      secondaryQueries.push(`${player} ${year} ${topParallel}`);
    }
  }

  // Add special attributes
  if (specialAttributes.length > 0) {
    const topAttribute = specialAttributes[0];
    secondaryQueries.push(`${player} ${topAttribute}`);
  }

  // FALLBACK QUERIES - Very broad
  fallbackQueries.push(`${player} card`);
  fallbackQueries.push(`${player}`);
  
  // Add first/last name variations
  const nameParts = player.split(' ');
  if (nameParts.length >= 2) {
    fallbackQueries.push(`${nameParts[0]} ${nameParts[nameParts.length - 1]} rookie`);
  }

  // Clean and limit queries - more generous limits
  const cleanPrimary = cleanAndLimitQueries(primaryQueries, 6);
  const cleanSecondary = cleanAndLimitQueries(secondaryQueries.filter(q => !cleanPrimary.includes(q)), 4);
  const cleanFallback = cleanAndLimitQueries(fallbackQueries.filter(q => !cleanPrimary.includes(q) && !cleanSecondary.includes(q)), 3);

  const allQueries = [...cleanPrimary, ...cleanSecondary, ...cleanFallback];

  logger.info('Revised query generation complete', {
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
    .filter(query => query.length >= 5) // Reduced minimum length
    .filter(query => !query.includes('unknown'))
    .filter((query, index, self) => self.indexOf(query) === index) // Deduplicate
    .slice(0, maxCount);
}

export function generateSiteSpecificQueries(baseQuery: string, targetSites: string[] = ['ebay.com', '130point.com']): string[] {
  const siteQueries: string[] = [];
  
  // More flexible site queries
  targetSites.forEach(site => {
    if (site.includes('ebay')) {
      siteQueries.push(`${baseQuery} site:ebay.com`);
      siteQueries.push(`${baseQuery} sold ebay`);
    } else if (site.includes('130point')) {
      siteQueries.push(`${baseQuery} site:130point.com`);
      siteQueries.push(`${baseQuery} 130point`);
    }
  });
  
  return siteQueries;
}
