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
    // Build tiered search queries for better matching
    const searchQueries = buildTieredSearchQueries(query);
    console.log('Built tiered search queries:', searchQueries);
    
    // Try queries in order of specificity
    for (const searchQuery of searchQueries) {
      console.log(`Trying search query: "${searchQuery}"`);
      
      // Fetch from real sources in parallel
      const fetchPromises: Promise<any>[] = [];
      
      if (sources.includes('ebay')) {
        fetchPromises.push(fetchEbayComps(searchQuery));
      }
      
      if (sources.includes('130point')) {
        fetchPromises.push(fetch130PointComps(searchQuery));
      }
      
      if (fetchPromises.length === 0) {
        continue;
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
        }
      });
      
      // Combine and normalize results
      const normalizationResult = combineAndNormalizeResults(ebayResult, point130Result);
      
      // If we found results with this query, use them
      if (normalizationResult.comps.length > 0) {
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
        
        console.log(`Found ${salesResults.length} relevant sales with query: "${searchQuery}"`);
        return salesResults;
      }
    }
    
    // If no queries returned results, throw error
    throw new Error('No relevant sales data found for any search variation');
    
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
    // Build tiered search queries for comprehensive matching
    const searchQueries = buildTieredSearchQueries(query);
    console.log('Tiered search queries:', searchQueries);
    
    // Validate sources
    const validSources = sources.filter(s => ['ebay', '130point'].includes(s));
    if (validSources.length === 0) {
      throw new Error('No valid sources selected');
    }
    
    let allComps: NormalizedComp[] = [];
    let allErrors: Array<{ source: string; message: string }> = [];
    
    // Try each search query until we find good results
    for (const searchQuery of searchQueries) {
      console.log(`Attempting search with: "${searchQuery}"`);
      
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
          allErrors.push(error);
        }
      });
      
      // Combine and normalize results for this query
      const normalizationResult = combineAndNormalizeResults(ebayResult, point130Result);
      
      // Add to our collection of all comps
      allComps = allComps.concat(normalizationResult.comps);
      allErrors = allErrors.concat(normalizationResult.errors);
      
      // If we found good results, we can stop trying more queries
      if (normalizationResult.comps.length >= 5) {
        console.log(`Found sufficient comps (${normalizationResult.comps.length}) with query: "${searchQuery}"`);
        break;
      }
    }
    
    // Check if we have any data at all
    if (allComps.length === 0) {
      return {
        estimatedValue: '$0.00',
        logicUsed: compLogic,
        exactMatchFound: false,
        confidence: 0,
        methodology: 'No data available',
        matchMessage: allErrors.length > 0 
          ? 'All data sources failed to return results'
          : 'No sales data found for this card across all search variations',
        comps: [],
        errors: allErrors
      };
    }
    
    // Remove duplicates based on title and price similarity
    const uniqueComps = deduplicateComps(allComps);
    console.log(`Deduplicated ${allComps.length} -> ${uniqueComps.length} comps`);
    
    // Find relevant matches
    const matchResult = findRelevantMatches(uniqueComps, query);
    
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
      errors: allErrors
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

function buildTieredSearchQueries(query: SearchQuery): string[] {
  const queries: string[] = [];
  
  // Extract non-empty, meaningful parts
  const parts = {
    year: query.year && query.year !== 'unknown' ? query.year : '',
    player: query.player && query.player !== 'unknown' ? query.player : '',
    set: query.set && query.set !== 'unknown' ? query.set : '',
    cardNumber: query.cardNumber && query.cardNumber !== 'unknown' ? query.cardNumber : '',
    grade: query.grade && query.grade !== 'unknown' ? query.grade : '',
    sport: query.sport && query.sport !== 'unknown' && query.sport !== 'other' ? query.sport : ''
  };
  
  // Tier 1: Most specific - all available fields
  if (parts.year && parts.player && parts.set) {
    const tier1Parts = [
      parts.year,
      parts.set,
      parts.player,
      parts.cardNumber ? `#${parts.cardNumber}` : '',
      parts.grade || '',
      parts.sport
    ].filter(p => p.trim());
    
    queries.push(tier1Parts.join(' ').replace(/\s+/g, ' ').trim());
  }
  
  // Tier 2: Core card info without grade
  if (parts.year && parts.player && parts.set) {
    const tier2Parts = [
      parts.year,
      parts.set,
      parts.player,
      parts.cardNumber ? `#${parts.cardNumber}` : '',
      parts.sport
    ].filter(p => p.trim());
    
    queries.push(tier2Parts.join(' ').replace(/\s+/g, ' ').trim());
  }
  
  // Tier 3: Player + set + key terms (for variations like Silver Prizm) 
  if (parts.player && parts.set) {
    const setVariations = extractSetVariations(parts.set);
    for (const setVar of setVariations) {
      const tier3Parts = [
        parts.player,
        setVar,
        parts.cardNumber ? `#${parts.cardNumber}` : '',
        'RC' // Add rookie card indicator
      ].filter(p => p.trim());
      
      queries.push(tier3Parts.join(' ').replace(/\s+/g, ' ').trim());
    }
  }
  
  // Tier 4: Broad player + year search
  if (parts.player && parts.year) {
    queries.push(`${parts.player} ${parts.year} ${parts.sport || ''} rookie card`.replace(/\s+/g, ' ').trim());
  }
  
  // Remove duplicates and empty queries
  const uniqueQueries = [...new Set(queries)].filter(q => q.length > 10);
  
  console.log(`Built ${uniqueQueries.length} tiered search queries`);
  return uniqueQueries;
}

function extractSetVariations(setName: string): string[] {
  const variations = [setName];
  
  // Handle common set variations
  if (setName.toLowerCase().includes('prizm')) {
    if (setName.toLowerCase().includes('silver')) {
      variations.push('Prizm Silver', 'Silver Prizm', 'Panini Prizm Silver');
    }
    if (setName.toLowerCase().includes('panini')) {
      variations.push('Panini Prizm', 'Prizm');
    }
  }
  
  if (setName.toLowerCase().includes('chrome')) {
    variations.push('Chrome', 'Topps Chrome', 'Bowman Chrome');
  }
  
  return [...new Set(variations)];
}

function deduplicateComps(comps: NormalizedComp[]): NormalizedComp[] {
  const seen = new Set<string>();
  const unique: NormalizedComp[] = [];
  
  for (const comp of comps) {
    // Create a signature based on title similarity and price
    const titleWords = comp.title.toLowerCase().split(/\s+/).sort();
    const signature = `${titleWords.slice(0, 5).join('')}_${Math.round(comp.price)}`;
    
    if (!seen.has(signature)) {
      seen.add(signature);
      unique.push(comp);
    }
  }
  
  return unique;
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
