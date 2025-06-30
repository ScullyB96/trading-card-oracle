
import { fetchEbayComps } from './scrapers/ebay-scraper.ts';
import { fetch130PointComps } from './scrapers/130point-scraper.ts';
import { scrapeEbayCompletedItems } from './scrapers/ebay-finding-scraper.ts';
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
const rateLimitedFetch = rateLimitedExecutor(2000); // Increased delay

export async function fetchProductionComps(
  cardKeywords: ExtractedCardKeywords,
  sources: string[],
  compLogic: string
): Promise<ProductionScraperResponse> {
  const traceId = generateTraceId();
  const logger = new Logger(traceId);
  const startTime = Date.now();
  
  logger.info('Starting OPTIMIZED production scraping with eBay Finding API', {
    operation: 'fetchProductionComps',
    sources,
    compLogic,
    player: cardKeywords.player,
    year: cardKeywords.year,
    set: cardKeywords.set,
    ebayFindingEnabled: !!config.ebayAppId
  });

  try {
    // STEP 1: Generate optimized search queries (limited count)
    const querySet = generateSearchQueries(cardKeywords, logger);
    
    if (querySet.allQueries.length === 0) {
      throw new Error('No valid search queries generated');
    }

    let allComps: NormalizedComp[] = [];
    let allErrors: Array<{ source: string; message: string }> = [];

    // STEP 2: Try Google Discovery only if enabled (with timeout)
    if (config.search.enabled) {
      logger.info('Phase 1: Google Search Discovery (Optimized)');
      
      try {
        const discoveryPromise = discoverListingsViaGoogle(querySet.primaryQueries, logger, 15);
        const googleDiscovery = await withTimeout(discoveryPromise, 25000, 'Google Discovery');
        
        allErrors = [...allErrors, ...googleDiscovery.errors];

        // STEP 3: Process discovered links (limited)
        if (googleDiscovery.discoveredListings.length > 0) {
          logger.info(`Phase 2: Direct Link Scraping (${Math.min(googleDiscovery.discoveredListings.length, 8)} URLs)`);
          
          const directLinkUrls = googleDiscovery.discoveredListings
            .slice(0, 8) // Limit to prevent timeout
            .map(listing => listing.url);
          
          try {
            const directLinkPromise = scrapeDirectLinks(directLinkUrls, logger);
            const directLinkResults = await withTimeout(directLinkPromise, 20000, 'Direct Link Scraping');
            
            const directComps: NormalizedComp[] = directLinkResults.results.map(result => ({
              title: result.title,
              price: result.price,
              date: result.date,
              source: result.source,
              image: result.image,
              url: result.url,
              matchScore: 0.8
            }));

            allComps = [...directComps];
            allErrors = [...allErrors, ...directLinkResults.errors.map(e => ({ source: e.source, message: e.message }))];
            
            logger.info(`Direct link scraping completed: ${directComps.length} comps found`);
          } catch (directError) {
            logger.error('Direct link scraping failed', directError);
            allErrors.push({ source: 'Direct Scraping', message: directError.message });
          }
        }
      } catch (discoveryError) {
        logger.error('Google discovery failed, falling back to traditional scraping', discoveryError);
        allErrors.push({ source: 'Google Discovery', message: discoveryError.message });
      }
    }

    // STEP 3: Fallback to traditional scraping with eBay Finding API integration
    if (allComps.length < 3) {
      logger.info('Phase 3: Traditional scraping fallback with eBay Finding API');
      
      const fallbackResult = await executeEnhancedFallbackScraping(querySet.primaryQueries.slice(0, 2), sources, logger);
      allComps = [...allComps, ...fallbackResult.comps];
      allErrors = [...allErrors, ...fallbackResult.errors];
    }

    // STEP 4: Process and return results
    const result = await processScrapingResults(allComps, allErrors, cardKeywords, compLogic, logger);
    
    const processingTime = Date.now() - startTime;
    logger.performance('OPTIMIZED fetchProductionComps with eBay Finding API completed', processingTime);
    
    return {
      ...result,
      debug: {
        attemptedQueries: querySet.allQueries,
        rawResultCounts: {
          totalComps: allComps.length,
          highConfidenceComps: allComps.filter(c => c.matchScore >= 0.7).length,
          processedSources: sources.length,
          ebayFindingEnabled: !!config.ebayAppId
        },
        totalProcessingTime: processingTime,
        traceId,
        architecture: 'Optimized Discover-then-Scrape v2.1 with eBay Finding API'
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('OPTIMIZED production scraping with eBay Finding API failed completely', error, { processingTime });
    
    return createRobustErrorResponse(
      'Optimized scraping with eBay Finding API failed',
      compLogic,
      processingTime,
      [],
      {},
      [{ source: 'System', message: `Optimized failure: ${error.message}` }],
      traceId
    );
  }
}

async function executeEnhancedFallbackScraping(
  queries: string[],
  sources: string[],
  logger: Logger
): Promise<{ comps: NormalizedComp[]; errors: Array<{ source: string; message: string }> }> {
  
  logger.info('Executing enhanced fallback scraping with eBay Finding API', {
    operation: 'executeEnhancedFallbackScraping',
    queryCount: queries.length,
    sources,
    ebayFindingEnabled: !!config.ebayAppId
  });

  const comps: NormalizedComp[] = [];
  const errors: Array<{ source: string; message: string }> = [];

  // Only try the first query to avoid timeouts
  const query = queries[0];
  if (!query) return { comps, errors };

  try {
    const promises: Promise<any>[] = [];

    // Traditional eBay scraping
    if (sources.includes('ebay')) {
      promises.push(
        rateLimitedFetch(() => 
          withTimeout(fetchEbayComps(query), 10000, 'eBay quick fallback')
        ).catch(error => ({ results: [], error: { source: 'eBay Quick', message: error.message } }))
      );
    }

    // eBay Finding API scraping (if enabled and configured)
    if (sources.includes('ebay') && config.ebayAppId) {
      logger.info('Adding eBay Finding API to scraping pipeline');
      promises.push(
        rateLimitedFetch(() => 
          withTimeout(scrapeEbayCompletedItems(query, config.ebayAppId, { maxResults: 15 }), 12000, 'eBay Finding API')
        ).catch(error => ({ results: [], error: { source: 'eBay Finding API', message: error.message } }))
      );
    }

    // 130Point scraping
    if (sources.includes('130point')) {
      promises.push(
        rateLimitedFetch(() => 
          withTimeout(fetch130PointComps(query), 10000, '130Point quick fallback')
        ).catch(error => ({ results: [], error: { source: '130Point Quick', message: error.message } }))
      );
    }

    const results = await Promise.all(promises);
    
    let ebayResult = { results: [], error: undefined };
    let ebayFindingResult = { results: [], error: undefined };
    let point130Result = { results: [], error: undefined };
    
    let resultIndex = 0;
    
    if (sources.includes('ebay')) {
      ebayResult = results[resultIndex++] || { results: [], error: undefined };
    }
    
    if (sources.includes('ebay') && config.ebayAppId) {
      ebayFindingResult = results[resultIndex++] || { results: [], error: undefined };
    }
    
    if (sources.includes('130point')) {
      point130Result = results[resultIndex++] || { results: [], error: undefined };
    }

    // Collect errors
    if (ebayResult.error) errors.push(ebayResult.error);
    if (ebayFindingResult.error) errors.push(ebayFindingResult.error);
    if (point130Result.error) errors.push(point130Result.error);

    // Combine and normalize results including eBay Finding API
    const normalizedResult = combineAndNormalizeResults(ebayResult, point130Result, ebayFindingResult);
    comps.push(...normalizedResult.comps);
    errors.push(...normalizedResult.errors);

    logger.info('Enhanced fallback scraping completed', {
      operation: 'executeEnhancedFallbackScraping',
      traditionalEbayResults: ebayResult.results?.length || 0,
      ebayFindingResults: ebayFindingResult.results?.length || 0,
      point130Results: point130Result.results?.length || 0,
      totalComps: comps.length
    });

  } catch (error) {
    logger.error('Enhanced fallback scraping failed', error, { query });
    errors.push({ source: 'Enhanced Fallback', message: `Query failed: ${error.message}` });
  }

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
    logger.warn('No comparable sales found in optimized architecture');
    
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

    const matchResult = findRelevantMatches(comps, searchQuery, 0.1); // Lower threshold
    const compingResult = calculateCompValue(matchResult.relevantComps, compLogic);

    logger.info('Results processed with optimized architecture', {
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
    logger.error('Result processing failed in optimized architecture', error);
    
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
      traceId,
      architecture: 'Optimized Discover-then-Scrape v2.1'
    }
  };
}

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
