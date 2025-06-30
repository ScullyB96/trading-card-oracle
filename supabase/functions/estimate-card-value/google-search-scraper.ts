
import { config } from './config.ts';
import { Logger } from './logger.ts';
import { withTimeout } from './utils.ts';
import { generateSiteSpecificQueries } from './query-generator.ts';

export interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

export interface DiscoveredListing {
  url: string;
  title: string;
  snippet: string;
  source: 'ebay' | '130point' | 'pwcc' | 'other';
  confidence: number;
}

export interface GoogleDiscoveryResult {
  discoveredListings: DiscoveredListing[];
  totalResults: number;
  queriesExecuted: string[];
  errors: Array<{ source: string; message: string }>;
}

export async function discoverListingsViaGoogle(
  searchQueries: string[],
  logger: Logger,
  maxResults: number = 20
): Promise<GoogleDiscoveryResult> {
  logger.info('Starting optimized Google Search discovery', {
    operation: 'discoverListingsViaGoogle',
    queryCount: searchQueries.length,
    maxResults
  });

  if (!config.googleSearchApiKey || !config.googleSearchEngineId) {
    logger.warn('Google Search API not configured, skipping discovery');
    return {
      discoveredListings: [],
      totalResults: 0,
      queriesExecuted: [],
      errors: [{ source: 'Google Search API', message: 'Google Search API not configured' }]
    };
  }

  const discoveredListings: DiscoveredListing[] = [];
  const queriesExecuted: string[] = [];
  const errors: Array<{ source: string; message: string }> = [];

  // Limit to first 6 queries to avoid timeouts
  const limitedQueries = searchQueries.slice(0, 6);

  for (const baseQuery of limitedQueries) {
    if (discoveredListings.length >= maxResults) {
      logger.info('Maximum results reached, stopping search');
      break;
    }

    try {
      // Try general search first (more likely to find results)
      logger.info(`Executing general search: ${baseQuery}`);
      
      const generalResults = await executeGoogleSearch(baseQuery, logger);
      queriesExecuted.push(baseQuery);
      
      if (generalResults.length > 0) {
        const categorizedResults = categorizeAndScoreResults(generalResults, baseQuery, logger);
        discoveredListings.push(...categorizedResults);
        
        // If we found good results, try one site-specific query
        if (categorizedResults.length > 0 && discoveredListings.length < maxResults) {
          const siteQueries = generateSiteSpecificQueries(baseQuery);
          if (siteQueries.length > 0) {
            try {
              const siteResults = await executeGoogleSearch(siteQueries[0], logger);
              queriesExecuted.push(siteQueries[0]);
              const moreCategorized = categorizeAndScoreResults(siteResults, baseQuery, logger);
              discoveredListings.push(...moreCategorized);
            } catch (siteError) {
              logger.warn('Site-specific search failed', { error: siteError.message });
            }
          }
        }
      }
      
      // Rate limiting between searches
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      logger.error('Search query failed', error, { query: baseQuery });
      errors.push({
        source: 'Google Search',
        message: `Search failed for "${baseQuery}": ${error.message}`
      });
    }
  }

  // Remove duplicates and sort
  const uniqueListings = deduplicateListings(discoveredListings, logger);
  const sortedListings = sortListingsByRelevance(uniqueListings);

  logger.info('Optimized Google Search discovery completed', {
    operation: 'discoverListingsViaGoogle',
    totalDiscovered: sortedListings.length,
    queriesExecuted: queriesExecuted.length,
    errors: errors.length
  });

  return {
    discoveredListings: sortedListings.slice(0, maxResults),
    totalResults: sortedListings.length,
    queriesExecuted,
    errors
  };
}

async function executeGoogleSearch(
  searchQuery: string,
  logger: Logger
): Promise<GoogleSearchResult[]> {
  const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
  searchUrl.searchParams.set('key', config.googleSearchApiKey);
  searchUrl.searchParams.set('cx', config.googleSearchEngineId);
  searchUrl.searchParams.set('q', searchQuery);
  searchUrl.searchParams.set('num', '10');
  searchUrl.searchParams.set('safe', 'active');

  try {
    const response = await withTimeout(
      fetch(searchUrl.toString()),
      10000, // 10 second timeout
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
    const results: GoogleSearchResult[] = items.map((item: any) => ({
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

function categorizeAndScoreResults(
  searchResults: GoogleSearchResult[],
  originalQuery: string,
  logger: Logger
): DiscoveredListing[] {
  const listings: DiscoveredListing[] = [];

  for (const result of searchResults) {
    try {
      let source: 'ebay' | '130point' | 'pwcc' | 'other' = 'other';
      
      if (result.link.includes('ebay.com')) {
        source = 'ebay';
      } else if (result.link.includes('130point.com')) {
        source = '130point';
      } else if (result.link.includes('pwcc.market')) {
        source = 'pwcc';
      }

      // Skip if not from our target sources
      if (source === 'other') {
        continue;
      }

      const confidence = calculateListingConfidence(result, originalQuery);
      
      // Lower threshold for acceptance
      if (confidence >= 0.2) {
        listings.push({
          url: result.link,
          title: result.title,
          snippet: result.snippet,
          source,
          confidence
        });
      }

    } catch (error) {
      logger.warn('Failed to categorize search result', { error: error.message, result: result.link });
    }
  }

  return listings;
}

function calculateListingConfidence(result: GoogleSearchResult, originalQuery: string): number {
  let confidence = 0.3; // Base confidence

  const title = result.title.toLowerCase();
  const snippet = result.snippet.toLowerCase();
  const queryTerms = originalQuery.toLowerCase().split(' ').filter(term => term.length > 2);

  // Check for query terms in title (higher weight)
  const titleMatches = queryTerms.filter(term => title.includes(term));
  confidence += (titleMatches.length / queryTerms.length) * 0.4;

  // Check for query terms in snippet
  const snippetMatches = queryTerms.filter(term => snippet.includes(term));
  confidence += (snippetMatches.length / queryTerms.length) * 0.2;

  // Bonus for sold indicators
  if (title.includes('sold') || snippet.includes('sold')) {
    confidence += 0.15;
  }

  // Bonus for price indicators
  if (title.includes('$') || snippet.includes('$')) {
    confidence += 0.1;
  }

  // Bonus for rookie/RC indicators
  if (title.includes('rookie') || title.includes(' rc ') || snippet.includes('rookie')) {
    confidence += 0.1;
  }

  return Math.min(1.0, confidence);
}

function deduplicateListings(listings: DiscoveredListing[], logger: Logger): DiscoveredListing[] {
  const seen = new Map<string, DiscoveredListing>();
  
  for (const listing of listings) {
    const existing = seen.get(listing.url);
    if (!existing || listing.confidence > existing.confidence) {
      seen.set(listing.url, listing);
    }
  }
  
  const uniqueListings = Array.from(seen.values());
  
  logger.info('Listing deduplication complete', {
    operation: 'deduplicateListings',
    originalCount: listings.length,
    uniqueCount: uniqueListings.length
  });

  return uniqueListings;
}

function sortListingsByRelevance(listings: DiscoveredListing[]): DiscoveredListing[] {
  return listings.sort((a, b) => {
    // First by confidence
    if (Math.abs(a.confidence - b.confidence) > 0.1) {
      return b.confidence - a.confidence;
    }
    
    // Then by source preference
    const sourcePreference: { [key: string]: number } = {
      ebay: 3,
      '130point': 2,
      pwcc: 1,
      other: 0
    };
    
    return sourcePreference[b.source] - sourcePreference[a.source];
  });
}
