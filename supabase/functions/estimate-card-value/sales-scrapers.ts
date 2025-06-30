
import { fetchEbayComps } from './scrapers/ebay-scraper.ts';
import { fetch130PointComps } from './scrapers/130point-scraper.ts';
import { combineAndNormalizeResults, NormalizedComp, ScrapingError } from './scrapers/normalizer.ts';
import { findRelevantMatches, calculateCompValue, MatchResult, CompingResult } from './scrapers/matching-logic.ts';

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
}

export async function fetchRealSalesData(query: SearchQuery, sources: string[]): Promise<SalesResult[]> {
  console.log('=== FETCHING REAL SALES DATA (PRODUCTION) ===');
  console.log('Query:', query);
  console.log('Sources:', sources);
  
  try {
    // Build search query string
    const searchQuery = buildSearchQuery(query);
    console.log('Built search query:', searchQuery);
    
    if (!searchQuery.trim()) {
      throw new Error('Invalid search query - no searchable terms found');
    }
    
    // Fetch from real sources in parallel
    const fetchPromises: Promise<any>[] = [];
    
    if (sources.includes('ebay')) {
      fetchPromises.push(fetchEbayComps(searchQuery));
    }
    
    if (sources.includes('130point')) {
      fetchPromises.push(fetch130PointComps(searchQuery));
    }
    
    if (fetchPromises.length === 0) {
      throw new Error('No valid sources selected');
    }
    
    // Wait for all scrapers to complete
    const results = await Promise.allSettled(fetchPromises);
    
    let ebayResult = { results: [], error: undefined };
    let point130Result = { results: [], error: undefined };
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (sources.includes('ebay') && (index === 0 || (index === 1 && !sources.includes('ebay')))) {
          ebayResult = result.value;
        }
        if (sources.includes('130point')) {
          const point130Index = sources.includes('ebay') ? 1 : 0;
          if (index === point130Index) {
            point130Result = result.value;
          }
        }
      } else {
        console.error(`Source ${sources[index]} failed:`, result.reason);
        const error = {
          source: sources[index],
          message: result.reason?.message || 'Unknown error'
        };
        
        if (sources[index] === 'ebay') {
          ebayResult.error = error;
        } else if (sources[index] === '130point') {
          point130Result.error = error;
        }
      }
    });
    
    // Combine and normalize results
    const normalizationResult = combineAndNormalizeResults(ebayResult, point130Result);
    
    if (normalizationResult.comps.length === 0 && normalizationResult.errors.length > 0) {
      // All sources failed
      const errorMessages = normalizationResult.errors.map(e => `${e.source}: ${e.message}`).join('; ');
      throw new Error(`All data sources failed: ${errorMessages}`);
    }
    
    // Find relevant matches
    const matchResult = findRelevantMatches(normalizationResult.comps, query, 0.6);
    
    // Convert to SalesResult format for compatibility
    const salesResults = matchResult.relevantComps.map((comp, index) => ({
      id: `${comp.source.toLowerCase()}_${Date.now()}_${index}`,
      title: comp.title,
      price: comp.price,
      date: comp.date,
      source: comp.source,
      url: comp.url,
      thumbnail: comp.image,
      matchScore: comp.matchScore || 0.5,
      selected: true
    }));
    
    console.log(`Found ${salesResults.length} relevant sales across all sources`);
    
    if (salesResults.length === 0) {
      throw new Error('No relevant sales data found for this card');
    }
    
    return salesResults;
    
  } catch (error) {
    console.error('Production scraper error:', error);
    throw new Error(`Real data fetching failed: ${error.message}`);
  }
}

export async function fetchProductionComps(
  query: SearchQuery,
  sources: string[],
  compLogic: string
): Promise<ProductionScraperResponse> {
  console.log('=== FETCHING PRODUCTION COMPS ===');
  
  try {
    // Build search query string
    const searchQuery = buildSearchQuery(query);
    console.log('Search query:', searchQuery);
    
    if (!searchQuery.trim()) {
      throw new Error('Invalid search query - no searchable terms found');
    }
    
    // Validate sources
    const validSources = sources.filter(s => ['ebay', '130point'].includes(s));
    if (validSources.length === 0) {
      throw new Error('No valid sources selected');
    }
    
    // Fetch from real sources
    const fetchPromises: Promise<any>[] = [];
    
    if (validSources.includes('ebay')) {
      fetchPromises.push(fetchEbayComps(searchQuery));
    }
    
    if (validSources.includes('130point')) {
      fetchPromises.push(fetch130PointComps(searchQuery));
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
      } else {
        console.error(`Source failed:`, result.reason);
        const error = {
          source: validSources[index] || 'unknown',
          message: result.reason?.message || 'Unknown error'
        };
        
        if (index === 0 && validSources.includes('ebay')) {
          ebayResult.error = error;
        } else if (validSources.includes('130point')) {
          point130Result.error = error;
        }
      }
    });
    
    // Combine and normalize results
    const normalizationResult = combineAndNormalizeResults(ebayResult, point130Result);
    
    // Check if we have any data at all
    if (normalizationResult.comps.length === 0) {
      if (normalizationResult.errors.length > 0) {
        // All sources failed
        return {
          estimatedValue: '$0.00',
          logicUsed: compLogic,
          exactMatchFound: false,
          confidence: 0,
          methodology: 'No data available',
          matchMessage: 'All data sources failed to return results',
          comps: [],
          errors: normalizationResult.errors
        };
      } else {
        // No results found
        return {
          estimatedValue: '$0.00',
          logicUsed: compLogic,
          exactMatchFound: false,
          confidence: 0,
          methodology: 'No data available',
          matchMessage: 'No sales data found for this card',
          comps: [],
          errors: []
        };
      }
    }
    
    // Find relevant matches
    const matchResult = findRelevantMatches(normalizationResult.comps, query);
    
    // Calculate estimated value
    const compingResult = calculateCompValue(matchResult.relevantComps, compLogic);
    
    // Format response
    const response: ProductionScraperResponse = {
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
      errors: normalizationResult.errors
    };
    
    console.log('Production scraper response:', {
      estimatedValue: response.estimatedValue,
      exactMatchFound: response.exactMatchFound,
      compsCount: response.comps.length,
      errorsCount: response.errors.length
    });
    
    return response;
    
  } catch (error) {
    console.error('Production comps error:', error);
    
    return {
      estimatedValue: '$0.00',
      logicUsed: compLogic,
      exactMatchFound: false,
      confidence: 0,
      methodology: 'Error occurred',
      matchMessage: `Error: ${error.message}`,
      comps: [],
      errors: [{
        source: 'System',
        message: error.message
      }]
    };
  }
}

function buildSearchQuery(query: SearchQuery): string {
  const parts = [
    query.player,
    query.year,
    query.set,
    query.cardNumber,
    query.grade,
    query.sport
  ].filter(part => part && part !== 'unknown' && part.trim() !== '');
  
  const searchQuery = parts.join(' ').trim();
  
  if (!searchQuery) {
    throw new Error('No valid search terms found in query');
  }
  
  return searchQuery;
}
