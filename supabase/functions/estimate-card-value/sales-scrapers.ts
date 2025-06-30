
import { fetchEbayComps } from './scrapers/ebay-scraper.ts';
import { fetch130PointComps } from './scrapers/130point-scraper.ts';
import { combineAndNormalizeResults, NormalizedComp } from './scrapers/normalizer.ts';
import { findRelevantMatches, calculateCompValue, MatchResult, CompingResult } from './scrapers/matching-logic.ts';
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
  };
}

// Rate-limited executor for API calls
const rateLimitedFetch = rateLimitedExecutor(1200);

export async function fetchProductionComps(
  query: SearchQuery,
  sources: string[],
  compLogic: string
): Promise<ProductionScraperResponse> {
  const traceId = generateTraceId();
  const logger = new Logger(traceId);
  const startTime = Date.now();
  
  logger.info('Starting resilient production scraping', {
    operation: 'fetchProductionComps',
    sources,
    compLogic,
    query: {
      player: query.player,
      year: query.year,
      set: query.set,
      sport: query.sport
    }
  });

  try {
    // Validate sources with fallback
    const validSources = validateSourcesWithFallback(sources, logger);
    
    // Build multiple search strategies
    const searchStrategies = buildSearchStrategies(query, logger);
    
    // Execute resilient scraping
    const scrapingResult = await executeResilientScraping(searchStrategies, validSources, logger);
    
    // Process results with error tolerance
    const result = await processResultsWithFallbacks(scrapingResult, query, compLogic, logger);
    
    const processingTime = Date.now() - startTime;
    logger.performance('fetchProductionComps', processingTime);
    
    return {
      ...result,
      debug: {
        attemptedQueries: searchStrategies,
        rawResultCounts: scrapingResult.rawResultCounts,
        totalProcessingTime: processingTime,
        traceId
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('Production scraping failed completely', error, { processingTime });
    
    return createRobustErrorResponse(
      'All scraping strategies failed',
      compLogic,
      processingTime,
      [],
      {},
      [{ source: 'System', message: `Complete failure: ${error.message}` }],
      traceId
    );
  }
}

function validateSourcesWithFallback(sources: string[], logger: Logger): string[] {
  const validSourceList = ['ebay', '130point'];
  const validSources = sources.filter(s => validSourceList.includes(s));
  
  if (validSources.length === 0) {
    logger.warn('No valid sources provided, using all available sources as fallback');
    return validSourceList; // Use all sources as fallback
  }
  
  return validSources;
}

function buildSearchStrategies(query: SearchQuery, logger: Logger): string[] {
  logger.info('Building resilient search strategies', { operation: 'buildSearchStrategies' });
  
  const strategies: string[] = [];
  const parts = {
    year: query.year && query.year !== 'unknown' ? query.year.trim() : '',
    player: query.player && query.player !== 'unknown' ? query.player.trim() : '',
    set: query.set && query.set !== 'unknown' ? query.set.trim() : '',
    cardNumber: query.cardNumber && query.cardNumber !== 'unknown' ? query.cardNumber.trim() : '',
    grade: query.grade && query.grade !== 'unknown' ? query.grade.trim() : '',
    sport: query.sport && query.sport !== 'unknown' && query.sport !== 'other' ? query.sport.trim() : ''
  };

  // Strategy 1: Full precision search
  if (parts.year && parts.player && parts.set && parts.cardNumber) {
    strategies.push(`${parts.year} ${parts.set} ${parts.player} #${parts.cardNumber}`);
  }

  // Strategy 2: High precision without card number
  if (parts.year && parts.player && parts.set) {
    strategies.push(`${parts.year} ${parts.set} ${parts.player} Rookie`);
    strategies.push(`${parts.year} ${parts.set} ${parts.player} RC`);
  }

  // Strategy 3: Player and year focused
  if (parts.player && parts.year) {
    strategies.push(`${parts.player} ${parts.year} Rookie Card`);
    strategies.push(`${parts.player} ${parts.year} RC`);
  }

  // Strategy 4: Brand-specific searches
  if (parts.player && parts.year) {
    const popularSets = ['Prizm', 'Select', 'Donruss', 'Optic', 'Chronicles'];
    popularSets.forEach(set => {
      strategies.push(`${parts.player} ${parts.year} ${set} RC`);
    });
  }

  // Strategy 5: Broad player search
  if (parts.player) {
    strategies.push(`${parts.player} Rookie Card`);
    strategies.push(`${parts.player} RC`);
  }

  // Strategy 6: Sport-specific fallback
  if (parts.player && parts.sport) {
    strategies.push(`${parts.player} ${parts.sport} Rookie`);
  }

  const finalStrategies = strategies
    .filter(s => s.length > 8)
    .filter(s => !s.includes('unknown'))
    .slice(0, Math.max(6, config.limits.maxQueries)); // Ensure we have enough strategies

  logger.info('Search strategies built', { 
    operation: 'buildSearchStrategies',
    strategyCount: finalStrategies.length,
    strategies: finalStrategies
  });

  return finalStrategies;
}

interface ResilientScrapingResult {
  comps: NormalizedComp[];
  errors: Array<{ source: string; message: string }>;
  rawResultCounts: { [key: string]: number };
  successfulSources: string[];
}

async function executeResilientScraping(
  searchStrategies: string[],
  validSources: string[],
  logger: Logger
): Promise<ResilientScrapingResult> {
  logger.info('Executing resilient scraping', { 
    operation: 'executeResilientScraping',
    strategyCount: searchStrategies.length,
    sources: validSources
  });

  let allComps: NormalizedComp[] = [];
  let allErrors: Array<{ source: string; message: string }> = [];
  const rawResultCounts: { [key: string]: number } = {};
  const successfulSources: string[] = [];

  // Try each search strategy until we get sufficient results
  for (const [index, searchQuery] of searchStrategies.entries()) {
    try {
      const strategyResult = await processSearchQueryResilient(searchQuery, validSources, logger);
      
      allComps = allComps.concat(strategyResult.comps);
      allErrors = allErrors.concat(strategyResult.errors);
      Object.assign(rawResultCounts, strategyResult.rawResultCounts);
      
      // Track successful sources
      strategyResult.successfulSources.forEach(source => {
        if (!successfulSources.includes(source)) {
          successfulSources.push(source);
        }
      });
      
      logger.info(`Strategy ${index + 1} completed`, {
        operation: 'executeResilientScraping',
        query: searchQuery,
        compsFound: strategyResult.comps.length,
        totalComps: allComps.length
      });
      
      // Early exit if we have sufficient high-quality data
      if (allComps.length >= 8 && successfulSources.length >= 2) {
        logger.info('Sufficient high-quality data found, stopping search', {
          operation: 'executeResilientScraping',
          compCount: allComps.length,
          sources: successfulSources
        });
        break;
      }
      
      // Continue if we still need more data
      if (allComps.length >= 3 && index >= 2) {
        logger.info('Minimum data threshold met, continuing for better results', {
          operation: 'executeResilientScraping',
          compCount: allComps.length
        });
      }
      
    } catch (error) {
      logger.error('Search strategy failed', error, { 
        operation: 'executeResilientScraping',
        strategy: index + 1,
        query: searchQuery
      });
      
      allErrors.push({
        source: 'Search Strategy',
        message: `Strategy ${index + 1} failed: ${error.message}`
      });
    }
  }

  // Deduplicate results
  const uniqueComps = deduplicateCompsResilient(allComps, logger);
  
  return {
    comps: uniqueComps,
    errors: allErrors,
    rawResultCounts,
    successfulSources
  };
}

async function processSearchQueryResilient(
  searchQuery: string,
  validSources: string[],
  logger: Logger
): Promise<{ comps: NormalizedComp[]; errors: Array<{ source: string; message: string }>; rawResultCounts: { [key: string]: number }; successfulSources: string[] }> {
  
  const errors: Array<{ source: string; message: string }> = [];
  const rawResultCounts: { [key: string]: number } = {};
  const successfulSources: string[] = [];
  
  // Scrape eBay with resilient error handling
  let ebayResult = { results: [], error: undefined };
  if (validSources.includes('ebay')) {
    try {
      ebayResult = await rateLimitedFetch(() => 
        withTimeout(fetchEbayComps(searchQuery), config.timeout.request, 'eBay scraping')
      );
      
      if (ebayResult.results.length > 0) {
        successfulSources.push('ebay');
      }
      
      if (ebayResult.error) {
        errors.push(ebayResult.error);
      }
      
    } catch (error) {
      logger.error('eBay scraping failed', error, { query: searchQuery });
      errors.push({ source: 'eBay', message: `Scraping failed: ${error.message}` });
      ebayResult = { results: [], error: { source: 'eBay', message: error.message } };
    }
  }
  
  // Scrape 130Point with resilient error handling
  let point130Result = { results: [], error: undefined };
  if (validSources.includes('130point')) {
    try {
      point130Result = await rateLimitedFetch(() => 
        withTimeout(fetch130PointComps(searchQuery), config.timeout.request, '130Point scraping')
      );
      
      if (point130Result.results.length > 0) {
        successfulSources.push('130point');
      }
      
      if (point130Result.error) {
        errors.push(point130Result.error);
      }
      
    } catch (error) {
      logger.error('130Point scraping failed', error, { query: searchQuery });
      errors.push({ source: '130Point', message: `Scraping failed: ${error.message}` });
      point130Result = { results: [], error: { source: '130Point', message: error.message } };
    }
  }

  // Record counts
  rawResultCounts[`eBay_${searchQuery}`] = ebayResult.results.length;
  rawResultCounts[`130Point_${searchQuery}`] = point130Result.results.length;

  // Combine and normalize with error tolerance
  let normalizationResult;
  try {
    normalizationResult = combineAndNormalizeResults(ebayResult, point130Result);
  } catch (error) {
    logger.error('Normalization failed', error, { query: searchQuery });
    errors.push({ source: 'Normalizer', message: `Data normalization failed: ${error.message}` });
    
    // Return whatever we can salvage
    normalizationResult = {
      comps: [],
      errors: [...errors, { source: 'Normalizer', message: 'Normalization failed, no data available' }]
    };
  }
  
  return {
    comps: normalizationResult.comps || [],
    errors: [...errors, ...(normalizationResult.errors || [])],
    rawResultCounts,
    successfulSources
  };
}

function deduplicateCompsResilient(comps: NormalizedComp[], logger: Logger): NormalizedComp[] {
  try {
    const seen = new Map<string, NormalizedComp>();
    
    for (const comp of comps) {
      try {
        const signature = createCompSignatureResilient(comp);
        const existing = seen.get(signature);
        
        if (!existing || new Date(comp.date) > new Date(existing.date)) {
          seen.set(signature, comp);
        }
      } catch (error) {
        logger.warn('Failed to process comp for deduplication', { error: error.message, comp: comp.title });
        // Continue processing other comps
      }
    }
    
    const dedupedResults = Array.from(seen.values())
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    logger.info('Resilient deduplication complete', {
      operation: 'deduplicateCompsResilient',
      originalCount: comps.length,
      dedupedCount: dedupedResults.length
    });
    
    return dedupedResults;
    
  } catch (error) {
    logger.error('Deduplication failed completely', error);
    // Return original comps if deduplication fails
    return comps.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }
}

function createCompSignatureResilient(comp: NormalizedComp): string {
  try {
    const normalizedTitle = (comp.title || '').toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const titleWords = normalizedTitle.split(' ')
      .filter(word => word.length > 2)
      .sort()
      .slice(0, 6);
    
    const price = comp.price || 0;
    const priceGroup = Math.floor(price / 10) * 10;
    const source = comp.source || 'unknown';
    
    return `${titleWords.join('')}_${priceGroup}_${source}`;
    
  } catch (error) {
    // Fallback signature if processing fails
    return `${comp.title || 'unknown'}_${comp.price || 0}_${comp.source || 'unknown'}`;
  }
}

async function processResultsWithFallbacks(
  scrapingResult: ResilientScrapingResult,
  query: SearchQuery,
  compLogic: string,
  logger: Logger
): Promise<Omit<ProductionScraperResponse, 'debug'>> {
  
  if (scrapingResult.comps.length === 0) {
    logger.warn('No comparable sales found', { operation: 'processResultsWithFallbacks' });
    
    return {
      estimatedValue: '$0.00',
      logicUsed: compLogic,
      exactMatchFound: false,
      confidence: 0,
      methodology: 'No data available',
      matchMessage: `No comparable sales found for ${query.player}${query.year !== 'unknown' ? ` ${query.year}` : ''}`,
      comps: [],
      errors: scrapingResult.errors.length > 0 ? scrapingResult.errors : [{
        source: 'System',
        message: 'No sales data found across all sources and search strategies'
      }]
    };
  }

  try {
    // Find relevant matches with error handling
    let matchResult: MatchResult;
    try {
      matchResult = findRelevantMatches(scrapingResult.comps, query, 0.3);
    } catch (error) {
      logger.error('Match finding failed', error);
      
      // Fallback: use all comps as relevant matches
      matchResult = {
        relevantComps: scrapingResult.comps.slice(0, 10), // Limit to prevent processing issues
        exactMatchFound: false,
        matchMessage: 'Using all available sales data (match finding failed)'
      };
    }
    
    // Calculate estimated value with error handling
    let compingResult: CompingResult;
    try {
      compingResult = calculateCompValue(matchResult.relevantComps, compLogic);
    } catch (error) {
      logger.error('Value calculation failed', error);
      
      // Fallback calculation
      const prices = matchResult.relevantComps.map(c => c.price).filter(p => p > 0);
      const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
      
      compingResult = {
        estimatedValue: avgPrice,
        confidence: 0.3,
        methodology: 'Simple average (calculation failed)'
      };
    }
    
    logger.info('Results processed successfully', {
      operation: 'processResultsWithFallbacks',
      compCount: matchResult.relevantComps.length,
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
      errors: scrapingResult.errors
    };
    
  } catch (error) {
    logger.error('Complete result processing failed', error);
    
    // Ultimate fallback
    const prices = scrapingResult.comps.map(c => c.price).filter(p => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    
    return {
      estimatedValue: `$${avgPrice.toFixed(2)}`,
      logicUsed: compLogic,
      exactMatchFound: false,
      confidence: 0.2,
      methodology: 'Emergency fallback calculation',
      matchMessage: 'Processing failed, using basic average',
      comps: scrapingResult.comps.slice(0, 5).map(comp => ({
        title: comp.title || 'Unknown Title',
        price: comp.price || 0,
        date: comp.date || new Date().toISOString().split('T')[0],
        source: comp.source || 'Unknown',
        image: comp.image,
        url: comp.url || '#'
      })),
      errors: [
        ...scrapingResult.errors,
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
export async function fetchRealSalesData(query: SearchQuery, sources: string[]): Promise<SalesResult[]> {
  try {
    const result = await fetchProductionComps(query, sources, 'average3');
    
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
