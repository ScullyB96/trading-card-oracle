import { EbayResult } from './ebay-scraper.ts';
import { Point130Result } from './130point-scraper.ts';

export interface NormalizedComp {
  title: string;
  price: number;
  date: string;
  source: string;
  image?: string;
  url: string;
  matchScore?: number;
}

export function normalizeComps(resultsArray: (EbayResult | Point130Result)[]): NormalizedComp[] {
  console.log('=== NORMALIZING COMPS ===');
  console.log(`Normalizing ${resultsArray.length} results`);
  
  return resultsArray
    .map(comp => {
      try {
        const normalized: NormalizedComp = {
          title: sanitizeTitle(comp.title),
          price: parseFloat(comp.price?.toString() || '0'),
          date: normalizeDate(comp.date),
          source: comp.source,
          image: comp.image,
          url: comp.url
        };
        
        // Validate required fields
        if (!normalized.title || normalized.price <= 0 || !normalized.date) {
          console.warn('Skipping invalid comp:', comp);
          return null;
        }
        
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
  if (!title || typeof title !== 'string') return 'Unknown Card';
  
  return title
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/[^\w\s\-#.]/g, '') // Remove special characters except basic ones
    .slice(0, 200); // Limit length
}

function normalizeDate(date: string | Date): string {
  if (!date) return new Date().toISOString().split('T')[0];
  
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    if (isNaN(dateObj.getTime())) {
      return new Date().toISOString().split('T')[0];
    }
    
    return dateObj.toISOString().split('T')[0];
  } catch (error) {
    console.error('Date normalization error:', error);
    return new Date().toISOString().split('T')[0];
  }
}

export function combineAndNormalizeResults(
  ebayResults: EbayResult[],
  point130Results: Point130Result[]
): NormalizedComp[] {
  console.log('=== COMBINING AND NORMALIZING RESULTS ===');
  console.log(`eBay: ${ebayResults.length} results`);
  console.log(`130Point: ${point130Results.length} results`);
  
  const allResults = [...ebayResults, ...point130Results];
  const normalizedResults = normalizeComps(allResults);
  
  // Remove duplicates based on title and price similarity
  const dedupedResults = deduplicateResults(normalizedResults);
  
  console.log(`Final normalized results: ${dedupedResults.length}`);
  return dedupedResults;
}

function deduplicateResults(results: NormalizedComp[]): NormalizedComp[] {
  const seen = new Map<string, NormalizedComp>();
  
  for (const result of results) {
    // Create a deduplication key based on title similarity and price
    const normalizedTitle = result.title.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const priceRange = Math.floor(result.price / 10) * 10; // Group by $10 ranges
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
