
import { ExtractedCardKeywords } from './vision-parser.ts';
import { Logger } from './logger.ts';

export interface SearchQuerySet {
  primaryQueries: string[];
  secondaryQueries: string[];
  fallbackQueries: string[];
  allQueries: string[];
}

export function generateSearchQueries(keywords: ExtractedCardKeywords, logger: Logger): SearchQuerySet {
  logger.info('Generating intelligent search query permutations', {
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

  // PRIMARY QUERIES - Most specific, highest priority
  if (year !== 'unknown' && set !== 'unknown' && cardNumber !== 'unknown') {
    // Ultra-specific with all details
    primaryQueries.push(`${year} ${set} ${player} #${cardNumber}`);
    
    if (parallels.length > 0) {
      parallels.forEach(parallel => {
        primaryQueries.push(`${year} ${set} ${player} ${parallel} #${cardNumber}`);
      });
    }
    
    if (specialAttributes.includes('RC') || specialAttributes.includes('Rookie')) {
      primaryQueries.push(`${year} ${set} ${player} RC #${cardNumber}`);
      primaryQueries.push(`${year} ${set} ${player} Rookie #${cardNumber}`);
    }
  }

  if (year !== 'unknown' && set !== 'unknown') {
    // High specificity without card number
    primaryQueries.push(`${year} ${set} ${player} Rookie`);
    primaryQueries.push(`${year} ${set} ${player} RC`);
    
    if (parallels.length > 0) {
      parallels.forEach(parallel => {
        primaryQueries.push(`${year} ${set} ${player} ${parallel}`);
      });
    }
    
    if (team) {
      primaryQueries.push(`${year} ${set} ${player} ${team}`);
    }
  }

  // SECONDARY QUERIES - Good specificity, medium priority
  if (year !== 'unknown') {
    secondaryQueries.push(`${player} ${year} Rookie Card`);
    secondaryQueries.push(`${player} ${year} RC`);
    
    if (sport !== 'unknown') {
      secondaryQueries.push(`${player} ${year} ${sport} Rookie`);
    }
    
    if (team) {
      secondaryQueries.push(`${player} ${year} ${team} Rookie`);
    }
    
    // Include popular sets dynamically
    const popularSets = getPopularSetsForSport(sport);
    popularSets.forEach(popularSet => {
      secondaryQueries.push(`${player} ${year} ${popularSet} RC`);
    });
  }

  if (set !== 'unknown') {
    secondaryQueries.push(`${player} ${set} Rookie`);
    secondaryQueries.push(`${player} ${set} RC`);
    
    if (cardNumber !== 'unknown') {
      secondaryQueries.push(`${player} ${set} #${cardNumber}`);
    }
  }

  // Add parallel-specific queries
  if (parallels.length > 0) {
    parallels.forEach(parallel => {
      if (year !== 'unknown') {
        secondaryQueries.push(`${player} ${year} ${parallel}`);
      }
      secondaryQueries.push(`${player} ${parallel} Rookie`);
    });
  }

  // Add special attributes queries
  specialAttributes.forEach(attr => {
    if (year !== 'unknown') {
      secondaryQueries.push(`${player} ${year} ${attr}`);
    }
    secondaryQueries.push(`${player} ${attr}`);
  });

  // FALLBACK QUERIES - Broad searches, lowest priority
  fallbackQueries.push(`${player} Rookie Card`);
  fallbackQueries.push(`${player} RC`);
  
  if (sport !== 'unknown') {
    fallbackQueries.push(`${player} ${sport} Rookie`);
  }
  
  if (team) {
    fallbackQueries.push(`${player} ${team} Card`);
  }

  // Grade-specific queries if available
  if (grade) {
    if (year !== 'unknown' && set !== 'unknown') {
      primaryQueries.push(`${year} ${set} ${player} ${grade}`);
    }
    secondaryQueries.push(`${player} ${grade}`);
  }

  // Clean and deduplicate queries
  const cleanPrimary = cleanAndDeduplicateQueries(primaryQueries);
  const cleanSecondary = cleanAndDeduplicateQueries(secondaryQueries.filter(q => !cleanPrimary.includes(q)));
  const cleanFallback = cleanAndDeduplicateQueries(fallbackQueries.filter(q => !cleanPrimary.includes(q) && !cleanSecondary.includes(q)));

  const allQueries = [...cleanPrimary, ...cleanSecondary, ...cleanFallback];

  logger.info('Query generation complete', {
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

function getPopularSetsForSport(sport: string): string[] {
  const setsByProvider: { [key: string]: string[] } = {
    football: ['Prizm', 'Select', 'Donruss', 'Optic', 'Chronicles', 'Contenders', 'Phoenix', 'Absolute'],
    basketball: ['Prizm', 'Select', 'Donruss', 'Optic', 'Chronicles', 'Contenders', 'Court Kings', 'Hoops'],
    baseball: ['Topps', 'Bowman', 'Chrome', 'Prizm', 'Diamond Kings', 'Update', 'Heritage', 'Stadium Club'],
    unknown: ['Prizm', 'Select', 'Donruss', 'Optic', 'Chronicles', 'Topps', 'Bowman']
  };

  return setsByProvider[sport] || setsByProvider.unknown;
}

function cleanAndDeduplicateQueries(queries: string[]): string[] {
  return queries
    .map(query => query.trim())
    .filter(query => query.length >= 10) // Minimum meaningful length
    .filter(query => !query.includes('unknown'))
    .filter((query, index, self) => self.indexOf(query) === index) // Deduplicate
    .slice(0, 12); // Reasonable limit per category
}

export function generateSiteSpecificQueries(baseQuery: string, targetSites: string[] = ['ebay.com', '130point.com', 'pwcc.market']): string[] {
  const siteQueries: string[] = [];
  
  targetSites.forEach(site => {
    // For eBay, target sold listings specifically
    if (site.includes('ebay')) {
      siteQueries.push(`"${baseQuery}" sold site:ebay.com/itm/`);
      siteQueries.push(`"${baseQuery}" site:ebay.com/itm/ "sold"`);
    }
    // For 130Point, target their sales pages
    else if (site.includes('130point')) {
      siteQueries.push(`"${baseQuery}" site:130point.com/sales/`);
      siteQueries.push(`"${baseQuery}" site:130point.com "sold"`);
    }
    // For PWCC, target their vault
    else if (site.includes('pwcc')) {
      siteQueries.push(`"${baseQuery}" site:pwcc.market/vault/`);
    }
    // Generic site search
    else {
      siteQueries.push(`"${baseQuery}" site:${site}`);
    }
  });
  
  return siteQueries;
}
