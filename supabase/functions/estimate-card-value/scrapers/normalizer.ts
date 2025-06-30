
import { EbayResult, EbayError } from './ebay-scraper.ts';
import { Point130Result, Point130Error } from './130point-scraper.ts';
import { EbayFindingResult, EbayFindingError } from './ebay-finding-scraper.ts';
import { safeParseFloat, safeParseDateString, normalizeText, isValidUrl } from '../utils.ts';

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
  point130Result: { results: Point130Result[], error?: Point130Error },
  ebayFindingResult?: { results: EbayFindingResult[], error?: EbayFindingError }
): NormalizationResult {
  console.log('=== ENHANCED NORMALIZATION WITH EBAY FINDING API ===');
  console.log(`eBay: ${ebayResult.results?.length || 0} results${ebayResult.error ? ' (with error)' : ''}`);
  console.log(`130Point: ${point130Result.results?.length || 0} results${point130Result.error ? ' (with error)' : ''}`);
  console.log(`eBay Finding: ${ebayFindingResult?.results?.length || 0} results${ebayFindingResult?.error ? ' (with error)' : ''}`);
  
  const errors: ScrapingError[] = [];
  
  // Safely combine results with comprehensive error handling
  const allResults = safelyCombineResults(ebayResult, point130Result, ebayFindingResult, errors);
  
  // Normalize and validate results
  const normalizedResults = safelyNormalizeComps(allResults, errors);
  
  // Remove duplicates
  const dedupedResults = safelyDeduplicateResults(normalizedResults, errors);
  
  console.log(`✅ Enhanced normalization complete: ${dedupedResults.length} final comps, ${errors.length} errors collected`);
  
  return {
    comps: dedupedResults,
    errors
  };
}

function safelyCombineResults(
  ebayResult: { results: EbayResult[], error?: EbayError },
  point130Result: { results: Point130Result[], error?: Point130Error },
  ebayFindingResult: { results: EbayFindingResult[], error?: EbayFindingError } | undefined,
  errors: ScrapingError[]
): (EbayResult | Point130Result | EbayFindingResult)[] {
  
  const allResults: (EbayResult | Point130Result | EbayFindingResult)[] = [];
  
  // Safely add eBay results
  try {
    if (ebayResult.results && Array.isArray(ebayResult.results)) {
      allResults.push(...ebayResult.results);
    }
    
    if (ebayResult.error) {
      errors.push(ebayResult.error);
      console.log('eBay error collected:', ebayResult.error.message);
    }
  } catch (error) {
    console.error('Error processing eBay results:', error);
    errors.push({
      source: 'eBay',
      message: `Failed to process eBay results: ${error.message}`
    });
  }
  
  // Safely add 130Point results
  try {
    if (point130Result.results && Array.isArray(point130Result.results)) {
      allResults.push(...point130Result.results);
    }
    
    if (point130Result.error) {
      errors.push(point130Result.error);
      console.log('130Point error collected:', point130Result.error.message);
    }
  } catch (error) {
    console.error('Error processing 130Point results:', error);
    errors.push({
      source: '130Point',
      message: `Failed to process 130Point results: ${error.message}`
    });
  }
  
  // Safely add eBay Finding results
  try {
    if (ebayFindingResult?.results && Array.isArray(ebayFindingResult.results)) {
      allResults.push(...ebayFindingResult.results);
      console.log(`Added ${ebayFindingResult.results.length} eBay Finding API results`);
    }
    
    if (ebayFindingResult?.error) {
      errors.push(ebayFindingResult.error);
      console.log('eBay Finding error collected:', ebayFindingResult.error.message);
    }
  } catch (error) {
    console.error('Error processing eBay Finding results:', error);
    errors.push({
      source: 'eBay Finding API',
      message: `Failed to process eBay Finding results: ${error.message}`
    });
  }
  
  return allResults;
}

function safelyNormalizeComps(resultsArray: (EbayResult | Point130Result | EbayFindingResult)[], errors: ScrapingError[]): NormalizedComp[] {
  console.log(`🔄 Safely normalizing ${resultsArray.length} results`);
  
  const normalizedResults: NormalizedComp[] = [];
  let processedCount = 0;
  let skippedCount = 0;
  
  for (const comp of resultsArray) {
    try {
      const normalized = safelyNormalizeResult(comp);
      if (normalized) {
        normalizedResults.push(normalized);
        processedCount++;
      } else {
        skippedCount++;
      }
    } catch (error) {
      console.error('Failed to normalize individual result:', error, comp);
      skippedCount++;
    }
  }
  
  console.log(`✅ Normalization stats: ${processedCount} processed, ${skippedCount} skipped`);
  
  // Sort by date (most recent first) with error handling
  try {
    return normalizedResults.sort((a, b) => {
      try {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      } catch (error) {
        console.warn('Date sorting failed for items:', a.title, b.title);
        return 0;
      }
    });
  } catch (error) {
    console.error('Failed to sort normalized results:', error);
    errors.push({
      source: 'Normalizer',
      message: 'Failed to sort results by date'
    });
    return normalizedResults;
  }
}

function safelyNormalizeResult(comp: EbayResult | Point130Result | EbayFindingResult): NormalizedComp | null {
  try {
    // Validate and sanitize title
    const title = sanitizeTitle(comp.title);
    if (!title) {
      return null;
    }
    
    // Validate and sanitize price - reject $0 prices
    const price = sanitizePrice(comp.price);
    if (price <= 0) {
      return null;
    }
    
    // Validate and sanitize date
    const date = sanitizeDate(comp.date);
    if (!date) {
      return null;
    }
    
    // Validate URL
    const url = sanitizeUrl(comp.url);
    if (!url) {
      return null;
    }
    
    // Validate source
    const source = sanitizeSource(comp.source);
    if (!source) {
      return null;
    }
    
    const normalized: NormalizedComp = {
      title,
      price: Math.round(price * 100) / 100, // Round to 2 decimal places
      date,
      source,
      image: sanitizeImageUrl(comp.image),
      url
    };
    
    return normalized;
    
  } catch (error) {
    console.error('Individual result normalization failed:', error);
    return null;
  }
}

function sanitizeTitle(title: any): string | null {
  try {
    if (!title || typeof title !== 'string') {
      return null;
    }
    
    const cleaned = normalizeText(title);
    
    // Must have meaningful content (reject titles that are too short)
    if (cleaned.length < 10) {
      return null;
    }
    
    return cleaned;
  } catch (error) {
    console.error('Title sanitization failed:', error);
    return null;
  }
}

function sanitizePrice(price: any): number {
  try {
    const numPrice = safeParseFloat(price);
    
    // Validate price range - reject $0 and unreasonably high prices
    if (numPrice <= 0 || numPrice > 50000) {
      return 0;
    }
    
    return numPrice;
  } catch (error) {
    console.error('Price sanitization failed:', error);
    return 0;
  }
}

function sanitizeDate(date: any): string | null {
  try {
    if (!date) return null;
    
    if (typeof date === 'string') {
      return safeParseDateString(date);
    }
    
    if (date instanceof Date) {
      return safeParseDateString(date.toISOString());
    }
    
    return null;
  } catch (error) {
    console.error('Date sanitization failed:', error);
    return null;
  }
}

function sanitizeUrl(url: any): string | null {
  try {
    if (!url || typeof url !== 'string') {
      return null;
    }
    
    if (!isValidUrl(url)) {
      return null;
    }
    
    return url;
  } catch (error) {
    console.error('URL sanitization failed:', error);
    return null;
  }
}

function sanitizeSource(source: any): string | null {
  try {
    if (!source || typeof source !== 'string') {
      return null;
    }
    
    // Accept various source types including eBay Finding API
    const validSources = ['eBay', '130Point', 'eBay Finding API', 'Direct Link'];
    const normalizedSource = source.trim();
    
    // Allow flexible source matching
    if (normalizedSource.toLowerCase().includes('ebay')) {
      return source.toLowerCase().includes('finding') ? 'eBay Finding API' : 'eBay';
    }
    
    if (normalizedSource.toLowerCase().includes('130point') || normalizedSource.toLowerCase().includes('130 point')) {
      return '130Point';
    }
    
    return validSources.includes(normalizedSource) ? normalizedSource : 'Unknown';
  } catch (error) {
    console.error('Source sanitization failed:', error);
    return null;
  }
}

function sanitizeImageUrl(image: any): string | undefined {
  try {
    if (!image || typeof image !== 'string') {
      return undefined;
    }
    
    return isValidUrl(image) ? image : undefined;
  } catch (error) {
    console.error('Image URL sanitization failed:', error);
    return undefined;
  }
}

function safelyDeduplicateResults(results: NormalizedComp[], errors: ScrapingError[]): NormalizedComp[] {
  try {
    const seen = new Map<string, NormalizedComp>();
    let processedCount = 0;
    let duplicateCount = 0;
    
    for (const result of results) {
      try {
        const key = createDuplicationKey(result);
        
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, result);
          processedCount++;
        } else {
          try {
            if (new Date(result.date) > new Date(existing.date)) {
              seen.set(key, result);
            }
            duplicateCount++;
          } catch (dateError) {
            duplicateCount++;
          }
        }
      } catch (error) {
        console.error('Failed to process result for deduplication:', error);
      }
    }
    
    const dedupedResults = Array.from(seen.values());
    console.log(`✅ Deduplication stats: ${results.length} -> ${dedupedResults.length} (${duplicateCount} duplicates removed)`);
    
    try {
      return dedupedResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch (sortError) {
      console.error('Final sort failed:', sortError);
      errors.push({
        source: 'Normalizer',
        message: 'Failed final sort - results may not be in chronological order'
      });
      return dedupedResults;
    }
    
  } catch (error) {
    console.error('Deduplication process failed completely:', error);
    errors.push({
      source: 'Normalizer',
      message: `Deduplication failed: ${error.message}`
    });
    
    return results;
  }
}

function createDuplicationKey(result: NormalizedComp): string {
  try {
    const normalizedTitle = (result.title || '').toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    const priceRange = Math.floor((result.price || 0) / 5) * 5; // Group by $5 ranges
    const source = result.source || 'unknown';
    
    return `${normalizedTitle}_${priceRange}_${source}`;
  } catch (error) {
    console.error('Failed to create deduplication key:', error);
    return `${result.title || 'unknown'}_${result.price || 0}_${result.source || 'unknown'}_${Math.random()}`;
  }
}
