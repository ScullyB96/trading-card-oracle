
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
  success: boolean;
  estimatedValue: number;
  confidence: number;
  methodology: string;
  comps: Array<{
    id: string;
    title: string;
    price: number;
    date: string;
    source: string;
    image?: string;
    url: string;
    matchScore: number;
  }>;
  warnings: string[];
  exactMatchFound: boolean;
  matchMessage: string;
  dataPoints: number;
  priceRange: {
    low: number;
    high: number;
  };
  productionResponse: {
    architecture: string;
    discoveryPhase: {
      queriesGenerated: number;
      linksDiscovered: number;
      sourcesUsed: string[];
    };
    scrapingPhase: {
      linksProcessed: number;
      salesExtracted: number;
      processingTime: string;
    };
    valuationPhase: {
      logic: string;
      confidence: number;
      methodology: string;
    };
  };
}

// Rate-limited executor for API calls
const rateLimitedFetch = rateLimitedExecutor(2000);

export async function fetchProductionComps(
  cardKeywords: ExtractedCardKeywords,
  sources: string[],
  compLogic: string
): Promise<ProductionScraperResponse> {
  const traceId = generateTraceId();
  const logger = new Logger(traceId);
  const startTime = Date.now();
  
  logger.info('Starting production scraping with Discover-then-Scrape architecture', {
    operation: 'fetchProductionComps',
    sources,
    compLogic,
    player: cardKeywords.player,
    year: cardKeywords.year,
    set: cardKeywords.set,
    traceId
  });

  try {
    // STEP 1: Generate optimized search queries
    const querySet = generateSearchQueries(cardKeywords, logger);
    
    if (querySet.allQueries.length === 0) {
      throw new Error('No valid search queries generated');
    }

    logger.info('Search queries generated', {
      operation: 'generateQueries',
      primaryCount: querySet.primaryQueries.length,
      totalQueries: querySet.allQueries.length,
      traceId
    });

    let allComps: NormalizedComp[] = [];
    let allWarnings: string[] = [];
    let discoveredLinks = 0;
    let linksProcessed = 0;

    // STEP 2: Discovery Phase - Use Google Search if enabled
    if (config.search.enabled && config.googleSearchApiKey && config.googleSearchEngineId) {
      logger.info('Phase 1: Google Search Discovery');
      
      try {
        const discoveryPromise = discoverListingsViaGoogle(
          querySet.primaryQueries.slice(0, 3), // Use top 3 queries for discovery
          logger,
          15 // Max results per query
        );
        
        const googleDiscovery = await withTimeout(discoveryPromise, 25000, 'Google Discovery');
        discoveredLinks = googleDiscovery.discoveredListings?.length || 0;
        
        if (googleDiscovery.errors?.length > 0) {
          allWarnings.push(...googleDiscovery.errors.map(e => e.message));
        }

        // STEP 3: Direct Link Scraping Phase
        if (discoveredLinks > 0) {
          logger.info(`Phase 2: Direct Link Scraping (${discoveredLinks} URLs)`);
          
          const directLinkUrls = googleDiscovery.discoveredListings
            .slice(0, 12) // Limit to first 12 URLs to prevent timeout
            .map(listing => listing.url);
          
          try {
            const directLinkPromise = scrapeDirectLinks(directLinkUrls, logger);
            const directLinkResults = await withTimeout(directLinkPromise, 20000, 'Direct Link Scraping');
            
            linksProcessed = directLinkUrls.length;
            
            // Convert direct link results to normalized comps
            const directComps: NormalizedComp[] = directLinkResults.results.map((result, index) => ({
              title: result.title || 'Unknown Title',
              price: result.price || 0,
              date: result.date || new Date().toISOString().split('T')[0],
              source: result.source || 'Direct Link',
              image: result.image,
              url: result.url || '#',
              matchScore: 0.8 // High match score for direct discovery
            }));

            allComps = [...directComps];
            
            if (directLinkResults.errors?.length > 0) {
              allWarnings.push(...directLinkResults.errors.map(e => `Direct scraping: ${e.message}`));
            }
            
            logger.info(`Direct link scraping completed: ${directComps.length} comps found`);
          } catch (directError) {
            logger.error('Direct link scraping failed', directError);
            allWarnings.push(`Direct scraping failed: ${directError.message}`);
          }
        }
      } catch (discoveryError) {
        logger.error('Google discovery failed, falling back to traditional scraping', discoveryError);
        allWarnings.push(`Discovery failed: ${discoveryError.message}`);
      }
    }

    // STEP 4: Fallback Phase - Traditional scraping if insufficient results
    if (allComps.length < 3) {
      logger.info('Phase 3: Traditional scraping fallback', {
        currentComps: allComps.length,
        needMore: 3 - allComps.length
      });
      
      const fallbackResult = await executeFallbackScraping(
        querySet.primaryQueries.slice(0, 2), // Use top 2 queries for fallback
        sources,
        logger
      );
      
      allComps = [...allComps, ...fallbackResult.comps];
      allWarnings = [...allWarnings, ...fallbackResult.warnings];
    }

    // STEP 5: Process and return results
    const result = await processScrapingResults(
      allComps,
      allWarnings,
      cardKeywords,
      compLogic,
      logger
    );
    
    const processingTime = Date.now() - startTime;
    logger.info('Production scraping completed', {
      operation: 'fetchProductionComps',
      totalComps: allComps.length,
      processingTime,
      success: true,
      traceId
    });
    
    return {
      ...result,
      productionResponse: {
        architecture: 'Discover-then-Scrape v2.1',
        discoveryPhase: {
          queriesGenerated: querySet.allQueries.length,
          linksDiscovered: discoveredLinks,
          sourcesUsed: sources
        },
        scrapingPhase: {
          linksProcessed: linksProcessed,
          salesExtracted: allComps.length,
          processingTime: 'Real-time'
        },
        valuationPhase: {
          logic: compLogic,
          confidence: result.confidence,
          methodology: result.methodology
        }
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('Production scraping failed completely', error, { processingTime, traceId });
    
    return createErrorResponse(
      'Production scraping failed',
      compLogic,
      processingTime,
      querySet?.allQueries || [],
      [{ message: `System error: ${error.message}` }],
      traceId
    );
  }
}

async function executeFallbackScraping(
  queries: string[],
  sources: string[],
  logger: Logger
): Promise<{ comps: NormalizedComp[]; warnings: string[] }> {
  
  logger.info('Executing fallback scraping', {
    operation: 'executeFallbackScraping',
    queryCount: queries.length,
    sources
  });

  const comps: NormalizedComp[] = [];
  const warnings: string[] = [];

  // Use only the first query to avoid timeouts
  const query = queries[0];
  if (!query) return { comps, warnings };

  try {
    const promises: Promise<any>[] = [];

    // Traditional eBay scraping
    if (sources.includes('ebay')) {
      promises.push(
        rateLimitedFetch(() => 
          withTimeout(fetchEbayComps(query), 12000, 'eBay fallback')
        ).catch(error => ({ 
          results: [], 
          error: { source: 'eBay', message: error.message } 
        }))
      );
    }

    // eBay Finding API scraping (if configured)
    if (sources.includes('ebay') && config.ebayAppId) {
      logger.info('Adding eBay Finding API to fallback scraping');
      promises.push(
        rateLimitedFetch(() => 
          withTimeout(
            scrapeEbayCompletedItems(query, config.ebayAppId, { maxResults: 20 }), 
            15000, 
            'eBay Finding API'
          )
        ).catch(error => ({ 
          results: [], 
          error: { source: 'eBay Finding API', message: error.message } 
        }))
      );
    }

    // 130Point scraping
    if (sources.includes('130point')) {
      promises.push(
        rateLimitedFetch(() => 
          withTimeout(fetch130PointComps(query), 12000, '130Point fallback')
        ).catch(error => ({ 
          results: [], 
          error: { source: '130Point', message: error.message } 
        }))
      );
    }

    const results = await Promise.all(promises);
    
    // Process results in order
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

    // Collect warnings from errors
    if (ebayResult.error) warnings.push(ebayResult.error.message);
    if (ebayFindingResult.error) warnings.push(ebayFindingResult.error.message);
    if (point130Result.error) warnings.push(point130Result.error.message);

    // Combine and normalize results
    const normalizedResult = combineAndNormalizeResults(
      ebayResult, 
      point130Result, 
      ebayFindingResult
    );
    
    comps.push(...normalizedResult.comps);
    warnings.push(...normalizedResult.errors.map(e => e.message));

    logger.info('Fallback scraping completed', {
      operation: 'executeFallbackScraping',
      ebayResults: ebayResult.results?.length || 0,
      ebayFindingResults: ebayFindingResult.results?.length || 0,
      point130Results: point130Result.results?.length || 0,
      totalComps: comps.length
    });

  } catch (error) {
    logger.error('Fallback scraping failed', error, { query });
    warnings.push(`Fallback scraping failed: ${error.message}`);
  }

  return { comps, warnings };
}

async function processScrapingResults(
  comps: NormalizedComp[],
  warnings: string[],
  cardKeywords: ExtractedCardKeywords,
  compLogic: string,
  logger: Logger
): Promise<Omit<ProductionScraperResponse, 'productionResponse'>> {
  
  if (comps.length === 0) {
    logger.warn('No comparable sales found');
    
    return {
      success: false,
      estimatedValue: 0,
      confidence: 0,
      methodology: 'No data available',
      comps: [],
      warnings: [...warnings, 'No comparable sales found'],
      exactMatchFound: false,
      matchMessage: `No comparable sales found for ${cardKeywords.player}${cardKeywords.year !== 'unknown' ? ` ${cardKeywords.year}` : ''}`,
      dataPoints: 0,
      priceRange: { low: 0, high: 0 }
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

    const matchResult = findRelevantMatches(comps, searchQuery, 0.2); // Reasonable threshold
    const compingResult = calculateCompValue(matchResult.relevantComps, compLogic);

    // Generate comp results with proper IDs and match scores
    const compResults = matchResult.relevantComps.map((comp, index) => ({
      id: `comp_${Date.now()}_${index}`,
      title: comp.title || 'Unknown Title',
      price: comp.price || 0,
      date: comp.date || new Date().toISOString().split('T')[0],
      source: comp.source || 'Unknown',
      image: comp.image,
      url: comp.url || '#',
      matchScore: comp.matchScore || 0.5
    }));

    logger.info('Results processed successfully', {
      operation: 'processScrapingResults',
      totalComps: comps.length,
      relevantComps: matchResult.relevantComps.length,
      exactMatch: matchResult.exactMatchFound,
      estimatedValue: compingResult.estimatedValue
    });

    return {
      success: true,
      estimatedValue: compingResult.estimatedValue,
      confidence: compingResult.confidence,
      methodology: compingResult.methodology,
      comps: compResults,
      warnings,
      exactMatchFound: matchResult.exactMatchFound,
      matchMessage: matchResult.matchMessage || 'Analysis complete',
      dataPoints: matchResult.relevantComps.length,
      priceRange: {
        low: compingResult.priceRange.low,
        high: compingResult.priceRange.high
      }
    };
    
  } catch (error) {
    logger.error('Result processing failed', error);
    
    // Emergency fallback calculation
    const prices = comps.map(c => c.price).filter(p => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    
    const fallbackComps = comps.slice(0, 10).map((comp, index) => ({
      id: `fallback_comp_${Date.now()}_${index}`,
      title: comp.title || 'Unknown Title',
      price: comp.price || 0,
      date: comp.date || new Date().toISOString().split('T')[0],
      source: comp.source || 'Unknown',
      image: comp.image,
      url: comp.url || '#',
      matchScore: 0.3
    }));
    
    return {
      success: true,
      estimatedValue: avgPrice,
      confidence: 0.3,
      methodology: 'Emergency fallback calculation',
      comps: fallbackComps,
      warnings: [
        ...warnings,
        `Processing failed: ${error.message}. Using basic average calculation.`
      ],
      exactMatchFound: false,
      matchMessage: 'Processing failed, using basic calculation',
      dataPoints: fallbackComps.length,
      priceRange: {
        low: Math.min(...prices.filter(p => p > 0)) || 0,
        high: Math.max(...prices) || 0
      }
    };
  }
}

function createErrorResponse(
  message: string,
  compLogic: string,
  processingTime: number,
  attemptedQueries: string[] = [],
  errors: Array<{ message: string }> = [],
  traceId: string = generateTraceId()
): ProductionScraperResponse {
  return {
    success: false,
    estimatedValue: 0,
    confidence: 0,
    methodology: 'Error occurred - no data processed',
    comps: [],
    warnings: errors.map(e => e.message),
    exactMatchFound: false,
    matchMessage: message,
    dataPoints: 0,
    priceRange: { low: 0, high: 0 },
    productionResponse: {
      architecture: 'Discover-then-Scrape v2.1',
      discoveryPhase: {
        queriesGenerated: attemptedQueries.length,
        linksDiscovered: 0,
        sourcesUsed: []
      },
      scrapingPhase: {
        linksProcessed: 0,
        salesExtracted: 0,
        processingTime: `${processingTime}ms`
      },
      valuationPhase: {
        logic: compLogic,
        confidence: 0,
        methodology: 'Error occurred'
      }
    }
  };
}

// Legacy function for backward compatibility
export async function fetchRealSalesData(cardKeywords: ExtractedCardKeywords, sources: string[]): Promise<any[]> {
  try {
    const result = await fetchProductionComps(cardKeywords, sources, 'average3');
    
    return result.comps.map((comp) => ({
      id: comp.id,
      title: comp.title,
      price: comp.price,
      date: comp.date,
      source: comp.source,
      url: comp.url,
      thumbnail: comp.image,
      matchScore: comp.matchScore,
      selected: true
    }));
  } catch (error) {
    console.error('Legacy fetchRealSalesData failed:', error);
    return [];
  }
}
