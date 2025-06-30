
import { EbayResult, EbayError } from './ebay-scraper.ts';
import { Point130Result, Point130Error } from './130point-scraper.ts';

export interface NormalizedComp {
  title: string;
  price: number;
  date: string;
  source: string;
  image?: string;
  url: string;
  matchScore?: number;
}

export interface ScrapingError {
  source: string;
  message: string;
}

export interface NormalizationResult {
  comps: NormalizedComp[];
  errors: ScrapingError[];
}

export function combineAndNormalizeResults(
  ebayResult: { results: EbayResult[], error?: EbayError },
  point130Result: { results: Point130Result[], error?: Point130Error }
): NormalizationResult {
  console.log('=== COMBINING AND NORMALIZING REAL RESULTS ===');
  console.log(`eBay: ${ebayResult.results.length} results${ebayResult.error ? ' (with error)' : ''}`);
  console.log(`130Point: ${point130Result.results.length} results${point130Result.error ? ' (with error)' : ''}`);
  
  const allResults = [...ebayResult.results, ...point130Result.results];
  const errors: ScrapingError[] = [];
  
  // Collect errors from sources
  if (ebayResult.error) {
    errors.push(ebayResult.error);
    console.log('eBay error:', ebayResult.error.message);
  }
  
  if (point130Result.error) {
    errors.push(point130Result.error);
    console.log('130Point error:', point130Result.error.message);
  }
  
  // Normalize and validate results
  const normalizedResults = normalizeComps(allResults);
  
  // Remove duplicates based on title and price similarity
  const dedupedResults = deduplicateResults(normalizedResults);
  
  console.log(`Final normalized results: ${dedupedResults.length} comps, ${errors.length} errors`);
  
  return {
    comps: dedupedResults,
    errors
  };
}

function normalizeComps(resultsArray: (EbayResult | Point130Result)[]): NormalizedComp[] {
  console.log('=== NORMALIZING COMPS ===');
  console.log(`Normalizing ${resultsArray.length} results`);
  
  return resultsArray
    .map(comp => {
      try {
        // Strict validation - reject invalid data
        if (!comp.title || typeof comp.title !== 'string' || comp.title.trim().length === 0) {
          console.warn('Rejecting comp with invalid title:', comp);
          return null;
        }
        
        const price = parseFloat(comp.price?.toString() || '0');
        if (price <= 0 || isNaN(price)) {
          console.warn('Rejecting comp with invalid price:', comp);
          return null;
        }
        
        const normalizedDate = normalizeDate(comp.date);
        if (!normalizedDate) {
          console.warn('Rejecting comp with invalid date:', comp);
          return null;
        }
        
        if (!comp.url || typeof comp.url !== 'string' || !isValidUrl(comp.url)) {
          console.warn('Rejecting comp with invalid URL:', comp);
          return null;
        }
        
        const normalized: NormalizedComp = {
          title: sanitizeTitle(comp.title),
          price: Math.round(price * 100) / 100, // Round to 2 decimal places
          date: normalizedDate,
          source: comp.source,
          image: comp.image && isValidUrl(comp.image) ? comp.image : undefined,
          url: comp.url
        };
        
        return normalized;
      } catch (error) {
        console.error('Error normalizing comp:', error, comp);
        return null;
      }
    })
    .filter((comp): comp is NormalizedComp => comp !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Sort by date desc
}

function sanitizeTitle(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/[^\w\s\-#.()]/g, '') // Remove special characters except basic ones
    .slice(0, 200); // Limit length
}

function normalizeDate(date: string | Date): string | null {
  if (!date) return null;
  
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    if (isNaN(dateObj.getTime())) {
      return null;
    }
    
    // Reject dates that are too far in the future or past
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const oneWeekFuture = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    if (dateObj < oneYearAgo || dateObj > oneWeekFuture) {
      console.warn('Date outside reasonable range:', dateObj);
      return null;
    }
    
    return dateObj.toISOString().split('T')[0];
  } catch (error) {
    console.error('Date normalization error:', error);
    return null;
  }
}

function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

function deduplicateResults(results: NormalizedComp[]): NormalizedComp[] {
  const seen = new Map<string, NormalizedComp>();
  
  for (const result of results) {
    // Create a deduplication key based on title similarity and price
    const normalizedTitle = result.title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const priceRange = Math.floor(result.price / 5) * 5; // Group by $5 ranges
    const key = `${normalizedTitle}_${priceRange}`;
    
    // Keep the most recent result for each key
    const existing = seen.get(key);
    if (!existing || new Date(result.date) > new Date(existing.date)) {
      seen.set(key, result);
    }
  }
  
  const dedupedResults = Array.from(seen.values());
  console.log(`Deduplication: ${results.length} -> ${dedupedResults.length} results`);
  
  return dedupedResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
