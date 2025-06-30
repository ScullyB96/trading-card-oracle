
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
  
  logger.info('Starting production scraping', {
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
    // Validate sources
    const validSources = validateSources(sources);
    if (validSources.length === 0) {
      throw new ScrapingError('No valid sources selected', 'validation');
    }

    // Build optimized search queries
    const searchQueries = buildOptimizedSearchQueries(query, logger);
    
    // Execute scraping with timeout protection
    const scrapingResult = await withTimeout(
      executeScrapingStrategy(searchQueries, validSources, logger),
      config.timeout.scraping,
      'scraping'
    );

    // Process and calculate results
    const result = await processScrapingResults(scrapingResult, query, compLogic, logger);
    
    const processingTime = Date.now() - startTime;
    logger.performance('fetchProductionComps', processingTime);
    
    return {
      ...result,
      debug: {
        attemptedQueries: searchQueries,
        rawResultCounts: scrapingResult.rawResultCounts,
        totalProcessingTime: processingTime,
        traceId
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('Production scraping failed', error, { processingTime });
    
    return createErrorResponse(
      error instanceof ScrapingError ? error.message : 'Scraping operation failed',
      compLogic,
      processingTime,
      [],
      {},
      [{ source: 'System', message: error.message }],
      traceId
    );
  }
}

function validateSources(sources: string[]): string[] {
  const validSourceList = ['ebay', '130point'];
  return sources.filter(s => validSourceList.includes(s));
}

function buildOptimizedSearchQueries(query: SearchQuery, logger: Logger): string[] {
  logger.info('Building optimized search queries', { operation: 'buildOptimizedSearchQueries' });
  
  const queries: string[] = [];
  const parts = {
    year: query.year && query.year !== 'unknown' ? query.year.trim() : '',
    player: query.player && query.player !== 'unknown' ? query.player.trim() : '',
    set: query.set && query.set !== 'unknown' ? query.set.trim() : '',
    cardNumber: query.cardNumber && query.cardNumber !== 'unknown' ? query.cardNumber.trim() : '',
    grade: query.grade && query.grade !== 'unknown' ? query.grade.trim() : '',
    sport: query.sport && query.sport !== 'unknown' && query.sport !== 'other' ? query.sport.trim() : ''
  };

  // High-precision search (full details)
  if (parts.year && parts.player && parts.set && parts.cardNumber) {
    queries.push(`${parts.year} ${parts.set} ${parts.player} #${parts.cardNumber}`);
  }

  // Medium-precision search (no card number)
  if (parts.year && parts.player && parts.set) {
    queries.push(`${parts.year} ${parts.set} ${parts.player} Rookie`);
  }

  // Player-focused search
  if (parts.player && parts.year) {
    queries.push(`${parts.player} ${parts.year} Prizm RC`);
  }

  // Fallback search
  if (parts.player) {
    queries.push(`${parts.player} Rookie Card`);
  }

  const optimizedQueries = queries
    .filter(q => q.length > 8)
    .filter(q => !q.includes('unknown'))
    .slice(0, config.limits.maxQueries);

  logger.info('Search queries built', { 
    operation: 'buildOptimizedSearchQueries',
    queryCount: optimizedQueries.length,
    queries: optimizedQueries
  });

  return optimizedQueries;
}

interface ScrapingResult {
  comps: NormalizedComp[];
  errors: Array<{ source: string; message: string }>;
  rawResultCounts: { [key: string]: number };
}

async function executeScrapingStrategy(
  searchQueries: string[],
  validSources: string[],
  logger: Logger
): Promise<ScrapingResult> {
  logger.info('Executing scraping strategy', { 
    operation: 'executeScrapingStrategy',
    queryCount: searchQueries.length,
    sources: validSources
  });

  let allComps: NormalizedComp[] = [];
  let allErrors: Array<{ source: string; message: string }> = [];
  const rawResultCounts: { [key: string]: number } = {};

  for (const searchQuery of searchQueries) {
    try {
      const queryResult = await processSearchQuery(searchQuery, validSources, logger);
      
      allComps = allComps.concat(queryResult.comps);
      allErrors = allErrors.concat(queryResult.errors);
      Object.assign(rawResultCounts, queryResult.rawResultCounts);
      
      // Early exit if we have sufficient data
      if (allComps.length >= 5) {
        logger.info('Sufficient data found, stopping search', {
          operation: 'executeScrapingStrategy',
          compCount: allComps.length,
          query: searchQuery
        });
        break;
      }
      
    } catch (error) {
      logger.error('Search query failed', error, { 
        operation: 'executeScrapingStrategy',
        query: searchQuery
      });
      
      allErrors.push({
        source: 'System',
        message: `Query failed: ${error.message}`
      });
    }
  }

  // Deduplicate results
  const uniqueComps = deduplicateComps(allComps, logger);
  
  return {
    comps: uniqueComps,
    errors: allErrors,
    rawResultCounts
  };
}

async function processSearchQuery(
  searchQuery: string,
  validSources: string[],
  logger: Logger
): Promise<ScrapingResult> {
  const fetchPromises: Promise<any>[] = [];
  
  if (validSources.includes('ebay')) {
    fetchPromises.push(
      rateLimitedFetch(() => fetchEbayComps(searchQuery))
        .catch(error => ({ results: [], error: { source: 'eBay', message: error.message } }))
    );
  }
  
  if (validSources.includes('130point')) {
    fetchPromises.push(
      rateLimitedFetch(() => fetch130PointComps(searchQuery))
        .catch(error => ({ results: [], error: { source: '130Point', message: error.message } }))
    );
  }

  const results = await Promise.allSettled(fetchPromises);
  
  let ebayResult = { results: [], error: undefined };
  let point130Result = { results: [], error: undefined };
  
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (validSources.includes('ebay') && index === 0) {
        ebayResult = result.value;
      } else if (validSources.includes('130point')) {
        const point130Index = validSources.includes('ebay') ? 1 : 0;
        if (index === point130Index) {
          point130Result = result.value;
        }
      }
    }
  });

  const normalizationResult = combineAndNormalizeResults(ebayResult, point130Result);
  
  return {
    comps: normalizationResult.comps,
    errors: normalizationResult.errors,
    rawResultCounts: {
      [`eBay_${searchQuery}`]: ebayResult.results.length,
      [`130Point_${searchQuery}`]: point130Result.results.length
    }
  };
}

function deduplicateComps(comps: NormalizedComp[], logger: Logger): NormalizedComp[] {
  const seen = new Map<string, NormalizedComp>();
  
  for (const comp of comps) {
    const signature = createCompSignature(comp);
    const existing = seen.get(signature);
    
    if (!existing || new Date(comp.date) > new Date(existing.date)) {
      seen.set(signature, comp);
    }
  }
  
  const dedupedResults = Array.from(seen.values())
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  logger.info('Deduplication complete', {
    operation: 'deduplicateComps',
    originalCount: comps.length,
    dedupedCount: dedupedResults.length
  });
  
  return dedupedResults;
}

function createCompSignature(comp: NormalizedComp): string {
  const normalizedTitle = comp.title.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const titleWords = normalizedTitle.split(' ')
    .filter(word => word.length > 2)
    .sort()
    .slice(0, 6);
  
  const priceGroup = Math.floor(comp.price / 10) * 10;
  return `${titleWords.join('')}_${priceGroup}_${comp.source}`;
}

async function processScrapingResults(
  scrapingResult: ScrapingResult,
  query: SearchQuery,
  compLogic: string,
  logger: Logger
): Promise<Omit<ProductionScraperResponse, 'debug'>> {
  if (scrapingResult.comps.length === 0) {
    logger.warn('No comparable sales found', { operation: 'processScrapingResults' });
    
    return {
      estimatedValue: '$0.00',
      logicUsed: compLogic,
      exactMatchFound: false,
      confidence: 0,
      methodology: 'No data available',
      matchMessage: 'No comparable sales found for this card',
      comps: [],
      errors: scrapingResult.errors.length > 0 ? scrapingResult.errors : [{
        source: 'System',
        message: 'No sales data found for this card across all search variations'
      }]
    };
  }

  // Find relevant matches
  const matchResult = findRelevantMatches(scrapingResult.comps, query, 0.3);
  
  // Calculate estimated value
  const compingResult = calculateCompValue(matchResult.relevantComps, compLogic);
  
  logger.info('Results processed successfully', {
    operation: 'processScrapingResults',
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
      title: comp.title,
      price: comp.price,
      date: comp.date,
      source: comp.source,
      image: comp.image,
      url: comp.url
    })),
    errors: scrapingResult.errors
  };
}

function createErrorResponse(
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
    methodology: 'Error occurred',
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

// Legacy function for backward compatibility
export async function fetchRealSalesData(query: SearchQuery, sources: string[]): Promise<SalesResult[]> {
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
}
