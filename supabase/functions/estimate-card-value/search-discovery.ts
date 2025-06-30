
import { config } from './config.ts';
import { Logger } from './logger.ts';
import { withTimeout } from './utils.ts';

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

export interface SearchDiscoveryResult {
  ebayUrls: string[];
  pointUrls: string[];
  searchQueries: string[];
  totalResults: number;
  errors: Array<{ source: string; message: string }>;
}

export interface SearchQuery {
  player: string;
  year: string;
  set: string;
  cardNumber: string;
  grade?: string;
  sport: string;
}

export async function discoverCardListings(
  query: SearchQuery,
  logger: Logger
): Promise<SearchDiscoveryResult> {
  logger.info('Starting search-driven card discovery', { 
    operation: 'discoverCardListings',
    player: query.player,
    year: query.year,
    set: query.set
  });

  if (!config.googleSearchApiKey || !config.googleSearchEngineId) {
    logger.warn('Google Search API not configured, skipping search discovery');
    return {
      ebayUrls: [],
      pointUrls: [],
      searchQueries: [],
      totalResults: 0,
      errors: [{ source: 'Search API', message: 'Google Search API not configured' }]
    };
  }

  const searchQueries = buildSearchQueries(query, logger);
  const discoveredUrls: SearchResult[] = [];
  const errors: Array<{ source: string; message: string }> = [];

  // Execute search queries
  for (const searchQuery of searchQueries) {
    try {
      logger.info(`Executing search query: ${searchQuery}`);
      const results = await executeGoogleSearch(searchQuery, logger);
      discoveredUrls.push(...results);
      
      // Rate limiting between searches
      if (searchQueries.indexOf(searchQuery) < searchQueries.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      logger.error('Search query failed', error, { query: searchQuery });
      errors.push({
        source: 'Google Search',
        message: `Search failed for "${searchQuery}": ${error.message}`
      });
    }
  }

  // Categorize discovered URLs
  const ebayUrls = discoveredUrls
    .filter(result => result.displayLink.includes('ebay.com'))
    .map(result => result.link)
    .filter((url, index, self) => self.indexOf(url) === index) // Deduplicate
    .slice(0, 10); // Limit results

  const pointUrls = discoveredUrls
    .filter(result => result.displayLink.includes('130point.com'))
    .map(result => result.link)
    .filter((url, index, self) => self.indexOf(url) === index) // Deduplicate
    .slice(0, 5); // Limit results

  logger.info('Search discovery completed', {
    operation: 'discoverCardListings',
    totalSearchResults: discoveredUrls.length,
    ebayUrls: ebayUrls.length,
    pointUrls: pointUrls.length,
    queriesExecuted: searchQueries.length
  });

  return {
    ebayUrls,
    pointUrls,
    searchQueries,
    totalResults: discoveredUrls.length,
    errors
  };
}

function buildSearchQueries(query: SearchQuery, logger: Logger): string[] {
  const queries: string[] = [];
  
  // Build comprehensive search terms
  const player = query.player && query.player !== 'unknown' ? query.player.trim() : '';
  const year = query.year && query.year !== 'unknown' ? query.year.trim() : '';
  const set = query.set && query.set !== 'unknown' ? query.set.trim() : '';
  const cardNumber = query.cardNumber && query.cardNumber !== 'unknown' ? query.cardNumber.trim() : '';

  if (!player) {
    logger.warn('No player name available for search queries');
    return [];
  }

  // Strategy 1: Direct eBay sold listings search
  if (year && set) {
    queries.push(`site:ebay.com "${player}" "${year}" "${set}" "sold" card`);
    if (cardNumber) {
      queries.push(`site:ebay.com "${player}" "${year}" "${set}" "#${cardNumber}" "sold"`);
    }
  }

  // Strategy 2: 130Point specific searches
  if (year) {
    queries.push(`site:130point.com "${player}" "${year}" card sales`);
  }

  // Strategy 3: Broader sports card searches
  queries.push(`"${player}" "${year || 'rookie'}" card "sold" OR "sale" site:ebay.com OR site:130point.com`);

  // Strategy 4: Graded card searches if grade specified
  if (query.grade && query.grade !== 'unknown') {
    queries.push(`"${player}" "${query.grade}" card "sold" site:ebay.com`);
  }

  const finalQueries = queries
    .filter(q => q.length > 20) // Ensure meaningful queries
    .slice(0, config.search.maxSearchQueries);

  logger.info('Built search queries', {
    operation: 'buildSearchQueries',
    queryCount: finalQueries.length,
    queries: finalQueries
  });

  return finalQueries;
}

async function executeGoogleSearch(
  searchQuery: string,
  logger: Logger
): Promise<SearchResult[]> {
  const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
  searchUrl.searchParams.set('key', config.googleSearchApiKey);
  searchUrl.searchParams.set('cx', config.googleSearchEngineId);
  searchUrl.searchParams.set('q', searchQuery);
  searchUrl.searchParams.set('num', '10'); // Get up to 10 results per query
  searchUrl.searchParams.set('safe', 'active');

  logger.info('Executing Google Custom Search', {
    operation: 'executeGoogleSearch',
    query: searchQuery,
    url: searchUrl.toString()
  });

  try {
    const response = await withTimeout(
      fetch(searchUrl.toString()),
      config.timeout.search,
      'Google Search API'
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Search API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(`Google Search API error: ${data.error.message}`);
    }

    const items = data.items || [];
    const results: SearchResult[] = items.map((item: any) => ({
      title: item.title || '',
      link: item.link || '',
      snippet: item.snippet || '',
      displayLink: item.displayLink || ''
    }));

    logger.info('Google Search completed', {
      operation: 'executeGoogleSearch',
      resultsFound: results.length,
      query: searchQuery
    });

    return results;

  } catch (error) {
    logger.error('Google Search API call failed', error, { query: searchQuery });
    throw error;
  }
}
