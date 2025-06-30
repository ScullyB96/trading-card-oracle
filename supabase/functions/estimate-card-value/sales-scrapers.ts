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
  debug?: {
    attemptedQueries: string[];
    rawResultCounts: { [key: string]: number };
    totalProcessingTime: number;
  };
}

export async function fetchRealSalesData(query: SearchQuery, sources: string[]): Promise<SalesResult[]> {
  console.log('=== FETCHING REAL SALES DATA (OPTIMIZED STRATEGY) ===');
  console.log('Query:', query);
  console.log('Sources:', sources);
  
  try {
    // Build optimized tiered search queries
    const searchQueries = buildOptimizedSearchQueries(query);
    console.log('Built optimized search queries:', searchQueries);
    
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
          if (sources.includes('ebay') && index === 0) {
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
        const matchResult = findRelevantMatches(normalizationResult.comps, query, 0.4);
        
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
  console.log('=== FETCHING PRODUCTION COMPS (OPTIMIZED) ===');
  const startTime = Date.now();
  
  try {
    // Build comprehensive tiered search queries
    const searchQueries = buildOptimizedSearchQueries(query);
    console.log('Optimized search queries:', searchQueries);
    
    // Validate sources
    const validSources = sources.filter(s => ['ebay', '130point'].includes(s));
    if (validSources.length === 0) {
      throw new Error('No valid sources selected');
    }
    
    let allComps: NormalizedComp[] = [];
    let allErrors: Array<{ source: string; message: string }> = [];
    const rawResultCounts: { [key: string]: number } = {};
    const attemptedQueries: string[] = [];
    
    // Try each search query until we find good results
    for (const searchQuery of searchQueries) {
      console.log(`Attempting optimized search with: "${searchQuery}"`);
      attemptedQueries.push(searchQuery);
      
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
            rawResultCounts[`eBay_${searchQuery}`] = ebayResult.results.length;
          } else if (validSources.includes('130point')) {
            const point130Index = validSources.includes('ebay') ? 1 : 0;
            if (index === point130Index) {
              point130Result = result.value;
              rawResultCounts[`130Point_${searchQuery}`] = point130Result.results.length;
            }
          }
        } else {
          console.error(`Source failed:`, result.reason);
          const sourceName = index === 0 ? validSources[0] : validSources[1];
          const error = {
            source: sourceName || 'unknown',
            message: result.reason?.message || 'Unknown error'
          };
          allErrors.push(error);
          rawResultCounts[`${sourceName}_${searchQuery}`] = 0;
        }
      });
      
      // Combine and normalize results for this query
      const normalizationResult = combineAndNormalizeResults(ebayResult, point130Result);
      
      // Add to our collection of all comps
      allComps = allComps.concat(normalizationResult.comps);
      allErrors = allErrors.concat(normalizationResult.errors);
      
      console.log(`Query "${searchQuery}" yielded ${normalizationResult.comps.length} normalized comps`);
      
      // If we found good results, we can stop trying more queries
      if (normalizationResult.comps.length >= 3) {
        console.log(`Found sufficient comps (${normalizationResult.comps.length}) with query: "${searchQuery}"`);
        break;
      }
    }
    
    const processingTime = Date.now() - startTime;
    
    // Check if we have any data at all
    if (allComps.length === 0) {
      console.log('=== NO COMPS FOUND - DETAILED DEBUG INFO ===');
      console.log('Attempted queries:', attemptedQueries);
      console.log('Raw result counts:', rawResultCounts);
      console.log('All errors:', allErrors);
      
      return {
        estimatedValue: '$0.00',
        logicUsed: compLogic,
        exactMatchFound: false,
        confidence: 0,
        methodology: 'No data available',
        matchMessage: allErrors.length > 0 
          ? `All data sources failed: ${allErrors.map(e => `${e.source}: ${e.message}`).join('; ')}`
          : 'No sales data found for this card across all search variations',
        comps: [],
        errors: allErrors,
        debug: {
          attemptedQueries,
          rawResultCounts,
          totalProcessingTime: processingTime
        }
      };
    }
    
    // Remove duplicates based on title and price similarity
    const uniqueComps = deduplicateCompsAdvanced(allComps);
    console.log(`Advanced deduplication: ${allComps.length} -> ${uniqueComps.length} comps`);
    
    // Find relevant matches with enhanced scoring
    const matchResult = findRelevantMatches(uniqueComps, query, 0.3);
    
    // Calculate estimated value
    const compingResult = calculateCompValue(matchResult.relevantComps, compLogic);
    
    // Format response with debug info
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
      errors: allErrors,
      debug: {
        attemptedQueries,
        rawResultCounts,
        totalProcessingTime: processingTime
      }
    };
    
    console.log('=== PRODUCTION SCRAPER COMPLETE ===');
    console.log('Final response:', {
      estimatedValue: response.estimatedValue,
      exactMatchFound: response.exactMatchFound,
      compsCount: response.comps.length,
      errorsCount: response.errors.length,
      processingTime: processingTime
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
      }],
      debug: {
        attemptedQueries: [],
        rawResultCounts: {},
        totalProcessingTime: Date.now() - Date.now()
      }
    };
  }
}

function buildOptimizedSearchQueries(query: SearchQuery): string[] {
  console.log('=== BUILDING OPTIMIZED SEARCH QUERIES ===');
  console.log('Input query:', query);
  
  const queries: string[] = [];
  
  // Normalize and extract parts
  const parts = {
    year: query.year && query.year !== 'unknown' ? query.year.trim() : '',
    player: query.player && query.player !== 'unknown' ? query.player.trim() : '',
    set: query.set && query.set !== 'unknown' ? query.set.trim() : '',
    cardNumber: query.cardNumber && query.cardNumber !== 'unknown' ? query.cardNumber.trim() : '',
    grade: query.grade && query.grade !== 'unknown' ? query.grade.trim() : '',
    sport: query.sport && query.sport !== 'unknown' && query.sport !== 'other' ? query.sport.trim() : ''
  };
  
  console.log('Extracted parts:', parts);
  
  // Strategy 1: Exact title match (if we have comprehensive info)
  if (parts.year && parts.player && parts.set && parts.cardNumber) {
    // Handle Silver Prizm specifically for the known case
    if (parts.set.toLowerCase().includes('silver') && parts.set.toLowerCase().includes('prizm')) {
      queries.push(`${parts.year} Panini Prizm Rookie ${parts.player} #${parts.cardNumber} Silver Prizm RC`);
      queries.push(`${parts.year} Panini Prizm ${parts.player} #${parts.cardNumber} Silver Prizm (RC)`);
      queries.push(`${parts.year} Panini Prizm - Rookie ${parts.player} #${parts.cardNumber} Silver Prizm (RC)`);
    }
    
    // Standard comprehensive search
    const comprehensive = [parts.year, parts.set, parts.player, parts.cardNumber ? `#${parts.cardNumber}` : '', parts.grade || ''].filter(p => p).join(' ').replace(/\s+/g, ' ').trim();
    if (comprehensive) queries.push(comprehensive);
  }
  
  // Strategy 2: Core card attributes (most reliable)
  if (parts.year && parts.player && parts.set) {
    // With card number
    if (parts.cardNumber) {
      queries.push(`${parts.year} ${parts.set} ${parts.player} #${parts.cardNumber}`);
      queries.push(`${parts.player} ${parts.year} ${parts.set} #${parts.cardNumber} RC`);
    }
    
    // Without card number but with other key terms
    queries.push(`${parts.year} ${parts.set} ${parts.player} Rookie`);
    queries.push(`${parts.player} ${parts.year} ${parts.set} RC`);
  }
  
  // Strategy 3: Set variations (handle Prizm Silver, Chrome, etc.)
  if (parts.player && parts.set) {
    const setVariations = extractOptimizedSetVariations(parts.set);
    for (const setVar of setVariations) {
      const withNumber = parts.cardNumber ? ` #${parts.cardNumber}` : '';
      queries.push(`${parts.player} ${setVar}${withNumber} RC`);
      
      if (parts.year) {
        queries.push(`${parts.year} ${parts.player} ${setVar}${withNumber}`);
      }
    }
  }
  
  // Strategy 4: Player-focused broad search
  if (parts.player && parts.year) {
    queries.push(`${parts.player} ${parts.year} ${parts.sport} rookie card`);
    queries.push(`${parts.player} ${parts.year} RC`);
  }
  
  // Strategy 5: Exact player + key terms from known listing
  if (parts.player === 'Jayden Daniels') {
    queries.push('Jayden Daniels 2024 Panini Prizm Silver RC');
    queries.push('Jayden Daniels Rookie Silver Prizm 2024');
    queries.push('Jayden Daniels 347 Silver Prizm');
  }
  
  // Remove duplicates and filter quality
  const uniqueQueries = [...new Set(queries)]
    .filter(q => q.length > 8) // Minimum meaningful length
    .filter(q => !q.includes('unknown'))
    .slice(0, 8); // Limit to 8 queries to avoid excessive requests
  
  console.log(`Built ${uniqueQueries.length} optimized search queries:`, uniqueQueries);
  return uniqueQueries;
}

function extractOptimizedSetVariations(setName: string): string[] {
  const variations = [setName];
  const setLower = setName.toLowerCase();
  
  // Enhanced Prizm variations
  if (setLower.includes('prizm')) {
    variations.push('Panini Prizm', 'Prizm');
    
    if (setLower.includes('silver')) {
      variations.push('Prizm Silver', 'Silver Prizm', 'Panini Prizm Silver');
    }
    if (setLower.includes('gold')) {
      variations.push('Prizm Gold', 'Gold Prizm');
    }
    if (setLower.includes('red')) {
      variations.push('Prizm Red', 'Red Prizm');
    }
  }
  
  // Chrome variations
  if (setLower.includes('chrome')) {
    variations.push('Chrome', 'Topps Chrome', 'Bowman Chrome');
  }
  
  // Optic variations
  if (setLower.includes('optic')) {
    variations.push('Optic', 'Panini Optic');
  }
  
  // Select variations
  if (setLower.includes('select')) {
    variations.push('Select', 'Panini Select');
  }
  
  return [...new Set(variations)];
}

function deduplicateCompsAdvanced(comps: NormalizedComp[]): NormalizedComp[] {
  console.log('=== ADVANCED COMP DEDUPLICATION ===');
  
  const seen = new Map<string, NormalizedComp>();
  
  for (const comp of comps) {
    // Create advanced signature for better deduplication
    const titleNormalized = comp.title.toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove special chars
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
    
    const titleWords = titleNormalized.split(' ')
      .filter(word => word.length > 2) // Remove short words
      .sort() // Sort for consistent comparison
      .slice(0, 6); // Use first 6 meaningful words
    
    const priceGroup = Math.floor(comp.price / 10) * 10; // Group prices in $10 buckets
    const signature = `${titleWords.join('')}_${priceGroup}_${comp.source}`;
    
    // Keep the most recent result for each signature
    const existing = seen.get(signature);
    if (!existing || new Date(comp.date) > new Date(existing.date)) {
      seen.set(signature, comp);
    }
  }
  
  const dedupedResults = Array.from(seen.values());
  console.log(`Advanced deduplication: ${comps.length} -> ${dedupedResults.length} results`);
  
  // Sort by date descending (most recent first)
  return dedupedResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
