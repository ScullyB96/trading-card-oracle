import { scrapeEbayCompletedItems, EbayFindingResult } from './scrapers/ebay-finding-scraper.ts';
import { findRelevantMatches, calculateCompValue } from './scrapers/matching-logic.ts';
import { generateSearchQueries } from './query-generator.ts';
import { ExtractedCardKeywords } from './vision-parser.ts';
import { config } from './config.ts';
import { Logger } from './logger.ts';
import { CardProcessingError } from './errors.ts';

/**
 * Main function to fetch and process comparable sales data using the robust eBay Finding API.
 * This is the new, simplified entry point for all data fetching.
 */
export async function fetchProductionComps(
  cardKeywords: ExtractedCardKeywords,
  compLogic: string,
  logger: Logger
) {
  logger.info('Starting NEW robust data fetching process', { operation: 'fetchProductionComps' });

  if (!config.ebayAppId) {
    throw new CardProcessingError('eBay API is not configured on the server.', 'EBAY_CONFIG_ERROR');
  }

  // 1. Generate a set of optimized search queries.
  const querySet = generateSearchQueries(cardKeywords, logger);
  const primaryQuery = querySet.primaryQueries[0] || querySet.allQueries[0];

  if (!primaryQuery) {
    logger.warn('No valid search query could be generated.');
    return createEmptyResult(compLogic, 'Could not generate a search query from the details provided.');
  }

  // 2. Fetch data using the reliable eBay Finding API.
  const { results: ebayComps, error: ebayError } = await scrapeEbayCompletedItems(primaryQuery, config.ebayAppId, { maxResults: 50 });

  if (ebayError) {
    logger.error('eBay Finding API call failed', ebayError);
    // Even if the API fails, we return a structured response instead of crashing.
  }

  if (!ebayComps || ebayComps.length === 0) {
    logger.warn('No comparable sales found from the eBay Finding API.');
    return createEmptyResult(compLogic, `No comparable sales found for "${primaryQuery}". Try a different image or description.`);
  }

  // 3. Normalize and prepare data for matching.
  const normalizedComps = ebayComps.map(comp => ({
    title: comp.title,
    price: comp.price,
    date: comp.date,
    source: 'eBay',
    image: comp.image,
    url: comp.url,
    matchScore: 0, // Will be calculated next
  }));

  // 4. Find the most relevant matches from the results.
  const searchQuery = {
    player: cardKeywords.player,
    year: cardKeywords.year,
    set: cardKeywords.set,
    cardNumber: cardKeywords.cardNumber,
    grade: cardKeywords.grade,
    sport: cardKeywords.sport,
  };
  const matchResult = findRelevantMatches(normalizedComps, searchQuery);

  if (matchResult.relevantComps.length === 0) {
    logger.warn('No relevant comps found after filtering.');
    return createEmptyResult(compLogic, 'Found some listings, but none were relevant enough to provide an estimate.');
  }

  // 5. Calculate the final estimated value based on the relevant comps.
  const compingResult = calculateCompValue(matchResult.relevantComps, compLogic);

  // 6. Return the final, structured result.
  return {
    estimatedValue: compingResult.estimatedValue,
    logicUsed: compLogic,
    exactMatchFound: matchResult.exactMatchFound,
    confidence: compingResult.confidence,
    methodology: compingResult.methodology,
    matchMessage: matchResult.matchMessage,
    comps: matchResult.relevantComps.map(comp => ({
      title: comp.title,
      price: comp.price,
      date: comp.date,
      source: comp.source,
      image: comp.image,
      url: comp.url,
    })),
    errors: ebayError ? [ebayError] : [],
    debug: {
      attemptedQueries: [primaryQuery],
      rawResultCounts: { ebayFindingApi: ebayComps.length },
      relevantCompsCount: matchResult.relevantComps.length,
      architecture: 'Robust API-First v3.0'
    }
  };
}

// Helper to create a consistent empty/error response.
function createEmptyResult(compLogic: string, message: string) {
  return {
    estimatedValue: 0,
    logicUsed: compLogic,
    exactMatchFound: false,
    confidence: 0,
    methodology: 'No data available',
    matchMessage: message,
    comps: [],
    errors: [],
    debug: { architecture: 'Robust API-First v3.0' }
  };
}
