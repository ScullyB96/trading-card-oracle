
import { fetchEbayComps } from './scrapers/ebay-scraper.ts';
import { fetch130PointComps } from './scrapers/130point-scraper.ts';
import { combineAndNormalizeResults, NormalizedComp } from './scrapers/normalizer.ts';
import { findRelevantMatches, calculateCompValue, MatchResult, CompingResult } from './scrapers/matching-logic.ts';
import { discoverListingsViaGoogle } from './google-search-scraper.ts';
import { scrapeDirectLinks } from './direct-link-scrapers.ts';
import { generateSearchQueries } from './query-generator.ts';
import { ExtractedCardKeywords } from './vision-parser.ts';
import { ScrapingError, TimeoutError } from './errors.ts';
import { withTimeout, generateTraceId, rateLimitedExecutor } from './utils.ts';
import { config } from './config.ts';
import { Logger } from './logger.ts';

export interface SalesResult {
  id: string;
  title: string;
  price: number;
  date: string;
  source: string;
  url: string;
  thumbnail?: string;
  type?: string;
  condition?: string;
  matchScore: number;
  selected?: boolean;
}

export interface SearchQuery {
  player: string;
  year: string;
  set: string;
  cardNumber: string;
  grade?: string;
  sport: string;
}

export interface ProductionScraperResponse {
  estimatedValue: string;
  logicUsed: string;
  exactMatchFound: boolean;
  confidence: number;
  methodology: string;
  matchMessage?: string;
  comps: Array<{
    title: string;
    price: number;
    date: string;
    source: string;
    image?: string;
    url: string;
  }>;
  errors: Array<{
    source: string;
    message: string;
  }>;
  debug?: {
    attemptedQueries: string[];
    rawResultCounts: { [key: string]: number };
    totalProcessingTime: number;
    traceId: string;
    architecture: string;
  };
}

// Rate-limited executor for API calls
const rateLimitedFetch = rateLimitedExecutor(1200);

export async function fetchProductionComps(
  cardKeywords: ExtractedCardKeywords,
  sources: string[],
  compLogic: string
): Promise<ProductionScraperResponse> {
  const traceId = generateTraceId();
  const logger = new Logger(traceId);
  const startTime = Date.now();
  
  logger.info('Starting NEW ARCHITECTURE production scraping', {
    operation: 'fetchProductionComps',
    sources,
    compLogic,
    player: cardKeywords.player,
    year: cardKeywords.year,
    set: cardKeywords.set
  });

  try {
    // STEP 1: Generate intelligent search queries
    const querySet = generateSearchQueries(cardKeywords, logger);
    
    if (querySet.allQueries.length === 0) {
      throw new Error('No valid search queries generated');
    }

    // STEP 2: PRIMARY DISCOVERY - Use Google Search API
    logger.info('Phase 1: Google Search Discovery');
    const googleDiscovery = await discoverListingsViaGoogle(querySet.allQueries, logger, 40);
    
    let allComps: NormalizedComp[] = [];
    let allErrors: Array<{ source: string; message: string }> = [...googleDiscovery.errors];

    // STEP 3: Scrape discovered direct links
    if (googleDiscovery.discoveredListings.length > 0) {
      logger.info(`Phase 2: Direct Link Scraping (${googleDiscovery.discoveredListings.length} URLs)`);
      
      const directLinkUrls = googleDiscovery.discoveredListings
        .slice(0, 20) // Limit to prevent timeout
        .map(listing => listing.url);
      
      const directLinkResults = await scrapeDirectLinks(directLinkUrls, logger);
      
      // Convert direct link results to normalized comps
      const directComps: NormalizedComp[] = directLinkResults.results.map(result => ({
        title: result.title,
        price: result.price,
        date: result.date,
        source: result.source,
        image: result.image,
        url: result.url,
        matchScore: 0.8 // High confidence since these came from targeted search
      }));

      allComps = [...directComps];
      allErrors = [...allErrors, ...directLinkResults.errors.map(e => ({ source: e.source, message: e.message }))];
      
      logger.info(`Direct link scraping completed: ${directComps.length} comps found`);
    }

    // STEP 4: FALLBACK - Traditional scraping if insufficient results
    if (allComps.length < 5) {
      logger.info('Phase 3: Fallback to traditional scraping (insufficient direct results)');
      
      const fallbackResult = await executeFallbackScraping(querySet.primaryQueries.slice(0, 3), sources, logger);
      allComps = [...allComps, ...fallbackResult.comps];
      allErrors = [...allErrors, ...fallbackResult.errors];
    }

    // STEP 5: Process and return results
    const result = await processScrapingResults(allComps, allErrors, cardKeywords, compLogic, logger);
    
    const processingTime = Date.now() - startTime;
    logger.performance('NEW ARCHITECTURE fetchProductionComps', processingTime);
    
    return {
      ...result,
      debug: {
        attemptedQueries: querySet.allQueries,
        rawResultCounts: {
          googleDiscovered: googleDiscovery.discoveredListings.length,
          directLinkSuccess: allComps.filter(c => c.matchScore >= 0.8).length,
          fallbackResults: allComps.filter(c => c.matchScore < 0.8).length
        },
        totalProcessingTime: processingTime,
        traceId,
        architecture: 'Discover-then-Scrape v2.0'
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('NEW ARCHITECTURE production scraping failed completely', error, { processingTime });
    
    return createRobustErrorResponse(
      'All scraping strategies failed in new architecture',
      compLogic,
      processingTime,
      [],
      {},
      [{ source: 'System', message: `Complete failure: ${error.message}` }],
      traceId
    );
  }
}

async function executeFallbackScraping(
  queries: string[],
  sources: string[],
  logger: Logger
): Promise<{ comps: NormalizedComp[]; errors: Array<{ source: string; message: string }> }> {
  
  logger.info('Executing fallback traditional scraping', {
    operation: 'executeFallbackScraping',
    queryCount: queries.length,
    sources
  });

  const comps: NormalizedComp[] = [];
  const errors: Array<{ source: string; message: string }> = [];

  for (const query of queries) {
    try {
      // Use existing scrapers as fallback
      let ebayResult = { results: [], error: undefined };
      let point130Result = { results: [], error: undefined };

      if (sources.includes('ebay')) {
        try {
          ebayResult = await rateLimitedFetch(() => 
            withTimeout(fetchEbayComps(query), config.timeout.request, 'eBay fallback scraping')
          );
          if (ebayResult.error) errors.push(ebayResult.error);
        } catch (error) {
          logger.error('eBay fallback scraping failed', error, { query });
          errors.push({ source: 'eBay Fallback', message: error.message });
        }
      }

      if (sources.includes('130point')) {
        try {
          point130Result = await rateLimitedFetch(() => 
            withTimeout(fetch130PointComps(query), config.timeout.request, '130Point fallback scraping')
          );
          if (point130Result.error) errors.push(point130Result.error);
        } catch (error) {
          logger.error('130Point fallback scraping failed', error, { query });
          errors.push({ source: '130Point Fallback', message: error.message });
        }
      }

      // Combine results
      const normalizedResult = combineAndNormalizeResults(ebayResult, point130Result);
      comps.push(...normalizedResult.comps);
      errors.push(...normalizedResult.errors);

    } catch (error) {
      logger.error('Fallback query failed', error, { query });
      errors.push({ source: 'Fallback Scraper', message: `Query failed: ${error.message}` });
    }
  }

  logger.info('Fallback scraping completed', {
    operation: 'executeFallbackScraping',
    compsFound: comps.length,
    errorsEncountered: errors.length
  });

  return { comps, errors };
}

async function processScrapingResults(
  comps: NormalizedComp[],
  errors: Array<{ source: string; message: string }>,
  cardKeywords: ExtractedCardKeywords,
  compLogic: string,
  logger: Logger
): Promise<Omit<ProductionScraperResponse, 'debug'>> {
  
  if (comps.length === 0) {
    logger.warn('No comparable sales found in new architecture');
    
    return {
      estimatedValue: '$0.00',
      logicUsed: compLogic,
      exactMatchFound: false,
      confidence: 0,
      methodology: 'No data available',
      matchMessage: `No comparable sales found for ${cardKeywords.player}${cardKeywords.year !== 'unknown' ? ` ${cardKeywords.year}` : ''}`,
      comps: [],
      errors
    };
  }

  try {
    const searchQuery = {
      player: cardKeywords.player,
      year: cardKeywords.year,
      set: cardKeywords.set,
      cardNumber: cardKeywords.cardNumber,
      grade: cardKeywords.grade,
      sport: cardKeywords.sport
    };

    // Enhanced matching logic for keyword-based searching
    const matchResult = findRelevantMatches(comps, searchQuery, 0.2); // Lower threshold for broader searches
    const compingResult = calculateCompValue(matchResult.relevantComps, compLogic);

    logger.info('Results processed with new architecture', {
      operation: 'processScrapingResults',
      totalComps: comps.length,
      relevantComps: matchResult.relevantComps.length,
      exactMatch: matchResult.exactMatchFound,
      estimatedValue: compingResult.estimatedValue
    });

    return {
      estimatedValue: `$${compingResult.estimatedValue.toFixed(2)}`,
      logicUsed: compLogic,
      exactMatchFound: matchResult.exactMatchFound,
      confidence: compingResult.confidence,
      methodology: compingResult.methodology,
      matchMessage: matchResult.matchMessage,
      comps: matchResult.relevantComps.map(comp => ({
        title: comp.title || 'Unknown Title',
        price: comp.price || 0,
        date: comp.date || new Date().toISOString().split('T')[0],
        source: comp.source || 'Unknown',
        image: comp.image,
        url: comp.url || '#'
      })),
      errors
    };
    
  } catch (error) {
    logger.error('Result processing failed in new architecture', error);
    
    // Emergency fallback calculation
    const prices = comps.map(c => c.price).filter(p => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    
    return {
      estimatedValue: `$${avgPrice.toFixed(2)}`,
      logicUsed: compLogic,
      exactMatchFound: false,
      confidence: 0.3,
      methodology: 'Emergency fallback calculation',
      matchMessage: 'Processing failed, using basic average',
      comps: comps.slice(0, 5).map(comp => ({
        title: comp.title || 'Unknown Title',
        price: comp.price || 0,
        date: comp.date || new Date().toISOString().split('T')[0],
        source: comp.source || 'Unknown',
        image: comp.image,
        url: comp.url || '#'
      })),
      errors: [
        ...errors,
        { source: 'Result Processor', message: `Processing failed: ${error.message}` }
      ]
    };
  }
}

function createRobustErrorResponse(
  message: string,
  compLogic: string,
  processingTime: number,
  attemptedQueries: string[] = [],
  rawResultCounts: { [key: string]: number } = {},
  errors: Array<{ source: string; message: string }> = [],
  traceId: string = generateTraceId()
): ProductionScraperResponse {
  return {
    estimatedValue: '$0.00',
    logicUsed: compLogic,
    exactMatchFound: false,
    confidence: 0,
    methodology: 'Error occurred - no data processed',
    matchMessage: message,
    comps: [],
    errors: errors.length > 0 ? errors : [{
      source: 'System',
      message: message
    }],
    debug: {
      attemptedQueries,
      rawResultCounts,
      totalProcessingTime: processingTime,
      traceId
    }
  };
}

// Legacy function maintained for backward compatibility
export async function fetchRealSalesData(cardKeywords: ExtractedCardKeywords, sources: string[]): Promise<any[]> {
  try {
    const result = await fetchProductionComps(cardKeywords, sources, 'average3');
    
    return result.comps.map((comp, index) => ({
      id: `${comp.source.toLowerCase()}_${Date.now()}_${index}`,
      title: comp.title,
      price: comp.price,
      date: comp.date,
      source: comp.source,
      url: comp.url,
      thumbnail: comp.image,
      matchScore: 0.5,
      selected: true
    }));
  } catch (error) {
    console.error('Legacy fetchRealSalesData failed:', error);
    return [];
  }
}
