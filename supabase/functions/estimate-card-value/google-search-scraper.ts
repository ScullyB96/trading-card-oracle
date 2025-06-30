
import { config } from './config.ts';
import { Logger } from './logger.ts';
import { generateSearchQueries, QueryGenerationOptions, GeneratedQuery } from './query-generator.ts';
import { withTimeout } from './utils.ts';
import { CardEstimationError } from './errors.ts';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface GoogleSearchResponse {
  results: SearchResult[];
  totalResults: number;
  searchTime: number;
  query: string;
  success: boolean;
  error?: string;
}

export async function performGoogleSearch(
  cardInfo: QueryGenerationOptions,
  logger: Logger
): Promise<GoogleSearchResponse> {
  const startTime = Date.now();
  
  try {
    // Check if Google Search API is configured
    if (!config.googleSearchApiKey || !config.googleSearchEngineId) {
      logger.warn('Google Search API not configured', { 
        operation: 'performGoogleSearch',
        hasApiKey: !!config.googleSearchApiKey,
        hasEngineId: !!config.googleSearchEngineId
      });
      
      return {
        results: [],
        totalResults: 0,
        searchTime: Date.now() - startTime,
        query: '',
        success: false,
        error: 'Google Search API not configured'
      };
    }

    const queries = generateSearchQueries(cardInfo);
    logger.info('Generated search queries', { 
      operation: 'performGoogleSearch',
      queryCount: queries.length,
      topQuery: queries[0]?.query
    });

    if (queries.length === 0) {
      return {
        results: [],
        totalResults: 0,
        searchTime: Date.now() - startTime,
        query: '',
        success: false,
        error: 'No search queries generated'
      };
    }

    // Try the top priority queries first
    const priorityQueries = queries.slice(0, 3);
    const allResults: SearchResult[] = [];
    let lastError: string | undefined;

    for (const queryObj of priorityQueries) {
      try {
        logger.info('Executing Google search', { 
          operation: 'performGoogleSearch',
          query: queryObj.query,
          priority: queryObj.priority
        });

        const searchResults = await executeGoogleSearch(queryObj, logger);
        
        if (searchResults.results.length > 0) {
          allResults.push(...searchResults.results);
          logger.info('Google search successful', { 
            operation: 'performGoogleSearch',
            query: queryObj.query,
            resultCount: searchResults.results.length
          });
        }

        // If we have enough results, break early
        if (allResults.length >= config.limits.maxSearchResults) {
          break;
        }

      } catch (error: any) {
        lastError = error.message;
        logger.warn('Google search query failed', { 
          operation: 'performGoogleSearch',
          query: queryObj.query,
          error: error.message
        });
        continue;
      }
    }

    // Remove duplicates and limit results
    const uniqueResults = removeDuplicateResults(allResults);
    const limitedResults = uniqueResults.slice(0, config.limits.maxSearchResults);

    const response: GoogleSearchResponse = {
      results: limitedResults,
      totalResults: limitedResults.length,
      searchTime: Date.now() - startTime,
      query: priorityQueries[0]?.query || '',
      success: limitedResults.length > 0,
      error: limitedResults.length === 0 ? lastError : undefined
    };

    logger.info('Google search completed', { 
      operation: 'performGoogleSearch',
      totalResults: response.totalResults,
      searchTime: response.searchTime,
      success: response.success
    });

    return response;

  } catch (error: any) {
    logger.error('Google search failed', { 
      operation: 'performGoogleSearch',
      error: error.message,
      searchTime: Date.now() - startTime
    });

    return {
      results: [],
      totalResults: 0,
      searchTime: Date.now() - startTime,
      query: '',
      success: false,
      error: error.message
    };
  }
}

async function executeGoogleSearch(
  queryObj: GeneratedQuery,
  logger: Logger
): Promise<GoogleSearchResponse> {
  const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
  searchUrl.searchParams.set('key', config.googleSearchApiKey);
  searchUrl.searchParams.set('cx', config.googleSearchEngineId);
  searchUrl.searchParams.set('q', queryObj.query);
  searchUrl.searchParams.set('num', '10');
  searchUrl.searchParams.set('safe', 'active');

  try {
    const response = await withTimeout(
      fetch(searchUrl.toString()),
      config.timeout.search,
      'Google Search API'
    );

    if (!response.ok) {
      throw new CardEstimationError(
        `Google Search API error: ${response.status} ${response.statusText}`,
        'GOOGLE_SEARCH_ERROR'
      );
    }

    const data = await response.json();
    
    if (data.error) {
      throw new CardEstimationError(
        `Google Search API error: ${data.error.message}`,
        'GOOGLE_SEARCH_ERROR'
      );
    }

    const results: SearchResult[] = (data.items || []).map((item: any) => ({
      title: item.title || '',
      url: item.link || '',
      snippet: item.snippet || '',
      source: extractDomain(item.link || '')
    }));

    return {
      results,
      totalResults: results.length,
      searchTime: 0,
      query: queryObj.query,
      success: true
    };

  } catch (error: any) {
    logger.error('Google Search API request failed', {
      operation: 'executeGoogleSearch',
      query: queryObj.query,
      error: error.message
    });
    throw error;
  }
}

function extractDomain(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return domain.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function removeDuplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter(result => {
    const key = `${result.url}|${result.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function filterSearchResultsBySource(
  results: SearchResult[],
  allowedSources: string[]
): SearchResult[] {
  const sourcePatterns = allowedSources.map(source => {
    switch (source.toLowerCase()) {
      case 'ebay':
        return /ebay\.com/i;
      case '130point':
        return /130point\.com/i;
      case 'comc':
        return /comc\.com/i;
      case 'beckett':
        return /beckett\.com/i;
      default:
        return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
  });

  return results.filter(result => {
    return sourcePatterns.some(pattern => pattern.test(result.url));
  });
}
