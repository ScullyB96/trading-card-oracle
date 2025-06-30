
export interface EbayResult {
  title: string;
  price: number;
  date: string;
  image?: string;
  url: string;
  source: string;
}

export interface EbayError {
  source: string;
  message: string;
}

// Global timeout constants
const REQUEST_TIMEOUT = 8000; // 8 seconds per request
const TOTAL_TIMEOUT = 25000; // 25 seconds total for all variations
const MIN_REQUEST_INTERVAL = 1500; // Reduced from 2500ms to speed up processing

export async function fetchEbayComps(searchQuery: string): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('=== FETCHING EBAY COMPS WITH TIMEOUT PROTECTION ===');
  console.log('Search query:', searchQuery);
  
  const startTime = Date.now();
  
  try {
    // First attempt: eBay Browse API if key is available
    const ebayApiKey = Deno.env.get('EBAY_API_KEY');
    
    if (ebayApiKey) {
      console.log('Attempting eBay Browse API with timeout');
      try {
        const apiResult = await Promise.race([
          fetchEbayAPI(searchQuery, ebayApiKey),
          timeoutPromise(REQUEST_TIMEOUT, 'eBay API timeout')
        ]);
        
        if (apiResult.results.length > 0) {
          console.log(`eBay API returned ${apiResult.results.length} results`);
          return apiResult;
        }
        console.log('eBay API returned no results, trying scraping fallback');
      } catch (error) {
        console.error('eBay API failed:', error.message);
      }
    }
    
    // Fallback: Enhanced HTML scraping with timeouts
    return await scrapeEbaySoldListingsWithTimeout(searchQuery, startTime);
    
  } catch (error) {
    console.error('eBay fetching completely failed:', error);
    return {
      results: [],
      error: {
        source: 'eBay',
        message: `eBay scraping failed: ${error.message}`
      }
    };
  }
}

async function scrapeEbaySoldListingsWithTimeout(searchQuery: string, startTime: number): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('=== ENHANCED EBAY SCRAPING WITH TIMEOUT PROTECTION ===');
  
  // Build focused search variations (limited to 3 for speed)
  const searchVariations = buildFocusedSearchVariations(searchQuery);
  console.log('eBay search variations (limited):', searchVariations);
  
  let allResults: EbayResult[] = [];
  let lastError: Error | null = null;
  let successfulVariations = 0;
  const MAX_SUCCESSFUL_VARIATIONS = 2; // Stop after 2 successful variations
  
  // Try each search variation with timeout protection
  for (const variation of searchVariations) {
    // Check global timeout
    if (Date.now() - startTime > TOTAL_TIMEOUT) {
      console.warn('Global timeout reached, stopping eBay scraping');
      break;
    }
    
    try {
      console.log(`Trying eBay variation: "${variation}" (attempt ${successfulVariations + 1})`);
      
      // Construct eBay sold listings URL
      const encodedQuery = encodeURIComponent(variation);
      const searchUrl = buildOptimalEbayUrl(encodedQuery);
      
      console.log('eBay scraping URL:', searchUrl);
      
      // Fetch with timeout protection
      const response = await Promise.race([
        rateLimitedFetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        }),
        timeoutPromise(REQUEST_TIMEOUT, `eBay request timeout for variation: ${variation}`)
      ]);
      
      if (!response.ok) {
        console.warn(`eBay HTTP ${response.status} for variation: "${variation}"`);
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        continue;
      }
      
      // Check content type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        console.warn(`eBay returned unexpected content-type: ${contentType}`);
        lastError = new Error(`Unexpected content type: ${contentType}`);
        continue;
      }
      
      const html = await response.text();
      console.log(`eBay HTML received: ${html.length} characters`);
      
      if (html.length < 1000) {
        console.warn(`eBay returned unusually short response: ${html.length} chars`);
        lastError = new Error('Response too short, likely blocked or rate limited');
        continue;
      }
      
      // Enhanced parsing with timeout
      const results = await Promise.race([
        parseEbayHTMLRobust(html, searchUrl, variation),
        timeoutPromise(3000, 'HTML parsing timeout')
      ]);
      
      console.log(`eBay variation "${variation}" found ${results.length} results`);
      
      if (results.length > 0) {
        allResults = allResults.concat(results);
        successfulVariations++;
        
        // Stop after getting results from 2 variations to speed up processing
        if (successfulVariations >= MAX_SUCCESSFUL_VARIATIONS) {
          console.log(`Stopping after ${successfulVariations} successful variations for speed`);
          break;
        }
      }
      
    } catch (error) {
      console.error(`eBay scraping error for variation "${variation}":`, error.message);
      lastError = error;
      
      // If it's a timeout, don't continue with more variations
      if (error.message.includes('timeout')) {
        console.warn('Timeout detected, stopping further variations');
        break;
      }
      continue;
    }
  }
  
  // Remove duplicates and sort by relevance
  const uniqueResults = deduplicateEbayResults(allResults, searchQuery);
  
  if (uniqueResults.length === 0) {
    const lastTriedQuery = searchVariations[searchVariations.length - 1] || searchQuery;
    return {
      results: [],
      error: {
        source: 'eBay',
        message: lastError ? 
          `No sold listings found. Last tried query: "${lastTriedQuery}". Error: ${lastError.message}` : 
          `No sold listings found for any search variation. Last tried: "${lastTriedQuery}"`
      }
    };
  }
  
  console.log(`eBay scraping final results: ${uniqueResults.length} unique listings`);
  return { results: uniqueResults.slice(0, 25) }; // Return top 25 for speed
}

function buildFocusedSearchVariations(originalQuery: string): string[] {
  const variations: string[] = [];
  
  // Start with the original query
  variations.push(originalQuery);
  
  // Parse out key components for focused variations
  const queryLower = originalQuery.toLowerCase();
  
  // Extract components from common patterns
  const yearMatch = originalQuery.match(/\b(20\d{2})\b/);
  const playerMatch = originalQuery.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/);
  const cardNumberMatch = originalQuery.match(/#?(\d+)/);
  
  const year = yearMatch?.[1];
  const player = playerMatch?.[1];
  const cardNumber = cardNumberMatch?.[1];
  
  console.log('Extracted components for focused search:', { year, player, cardNumber });
  
  // Build only the most relevant variations (limit to 4 total for speed)
  if (year && player) {
    if (cardNumber) {
      variations.push(`${year} ${player} #${cardNumber} Prizm Silver RC`);
    }
    variations.push(`${player} ${year} Prizm Rookie`);
  }
  
  // Remove duplicates and limit to 4 variations maximum
  const uniqueVariations = [...new Set(variations)]
    .filter(v => v.trim().length > 5)
    .slice(0, 4);
  
  console.log(`Built ${uniqueVariations.length} focused eBay search variations`);
  return uniqueVariations;
}

function buildOptimalEbayUrl(encodedQuery: string): string {
  // Simplified eBay URL for sold listings
  const baseUrl = 'https://www.ebay.com/sch/i.html';
  const params = new URLSearchParams({
    '_nkw': decodeURIComponent(encodedQuery),
    'LH_Sold': '1', // Sold listings only
    'LH_Complete': '1', // Completed listings only
    '_sop': '13', // Sort by newest first
    '_ipg': '100', // Reduced from 200 for faster loading
    'rt': 'nc' // No cache
  });
  
  return `${baseUrl}?${params.toString()}`;
}

async function parseEbayHTMLRobust(html: string, searchUrl: string, originalQuery: string): Promise<EbayResult[]> {
  const results: EbayResult[] = [];
  
  try {
    console.log('Parsing eBay HTML with robust strategy');
    
    // Strategy 1: Modern eBay layout (s-item classes) - most reliable
    const modernResults = parseModernEbayLayoutRobust(html, searchUrl);
    results.push(...modernResults);
    
    // If we didn't get enough results, try alternative parsing
    if (results.length < 3) {
      const alternativeResults = parseEbayAlternativeStrategy(html, searchUrl);
      results.push(...alternativeResults);
    }
    
    console.log(`HTML parsing found ${results.length} total items`);
    
    // Filter and validate results more strictly
    const validResults = results
      .filter(r => {
        if (!r.title || r.title.length < 10) return false;
        if (!r.price || r.price <= 0 || r.price > 10000) return false;
        if (!r.title.toLowerCase().includes('prizm') && !r.title.toLowerCase().includes('daniels')) return false;
        return true;
      })
      .map(r => ({
        ...r,
        title: r.title.replace(/\s+/g, ' ').trim()
      }));
    
    console.log(`Filtered to ${validResults.length} valid eBay results`);
    return validResults;
    
  } catch (error) {
    console.error('HTML parsing error:', error.message);
    return [];
  }
}

function parseModernEbayLayoutRobust(html: string, searchUrl: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  // Modern eBay uses s-item classes - enhanced pattern matching
  const itemPatterns = [
    /<div[^>]*class="[^"]*s-item[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*s-item[^"]*"|$)/g,
    /<div[^>]*data-view="mi:[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*data-view="mi:|$)/g
  ];
  
  for (const pattern of itemPatterns) {
    let itemMatch;
    let itemCount = 0;
    
    while ((itemMatch = pattern.exec(html)) !== null && itemCount < 50) {
      const itemHtml = itemMatch[0];
      itemCount++;
      
      try {
        // Extract title with multiple fallback patterns
        const titlePatterns = [
          /<h3[^>]*class="[^"]*s-item__title[^"]*"[^>]*>(?:<[^>]*>)*([^<]+)/,
          /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*[^>]*>(?:<[^>]*>)*([^<]+)/,
          /<span[^>]*role="heading"[^>]*>([^<]+)/,
          /title="([^"]+)"/
        ];
        
        let title = '';
        for (const titlePattern of titlePatterns) {
          const match = titlePattern.exec(itemHtml);
          if (match && match[1] && match[1].trim() !== 'New Listing' && match[1].length > 5) {
            title = match[1].trim();
            break;
          }
        }
        
        if (!title) continue;
        
        // Extract price with enhanced patterns
        const pricePatterns = [
          /<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>(?:<[^>]*>)*\$([0-9,]+\.?[0-9]*)/,
          /<span[^>]*class="[^"]*notranslate[^"]*"[^>]*>\$([0-9,]+\.?[0-9]*)/,
          /\$([0-9,]+\.?[0-9]*)/
        ];
        
        let price = 0;
        for (const pricePattern of pricePatterns) {
          const match = pricePattern.exec(itemHtml);
          if (match) {
            price = parseFloat(match[1].replace(/,/g, ''));
            if (price > 0) break;
          }
        }
        
        if (price <= 0) continue;
        
        // Extract sold date
        const datePatterns = [
          /<span[^>]*class="[^"]*s-item__endedDate[^"]*"[^>]*>(?:<[^>]*>)*Sold\s+([^<]+)/,
          /<div[^>]*class="[^"]*s-item__subtitle[^"]*"[^>]*>(?:<[^>]*>)*Sold\s+([^<]+)/
        ];
        
        let dateStr = '';
        for (const datePattern of datePatterns) {
          const match = datePattern.exec(itemHtml);
          if (match) {
            dateStr = match[1].trim();
            break;
          }
        }
        
        // Extract URL
        const linkPattern = /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*href="([^"]+)"/;
        const linkMatch = linkPattern.exec(itemHtml);
        const url = linkMatch ? linkMatch[1] : searchUrl;
        
        // Extract image
        const imagePattern = /<img[^>]*src="([^"]*)"[^>]*class="[^"]*s-item__image[^"]*"/;
        const imageMatch = imagePattern.exec(itemHtml);
        const image = imageMatch ? imageMatch[1] : undefined;
        
        // Parse date
        let parsedDate = new Date().toISOString().split('T')[0];
        if (dateStr) {
          try {
            const cleanDate = dateStr.replace(/^(Sold\s+)/, '');
            const parsed = new Date(cleanDate);
            if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2020) {
              parsedDate = parsed.toISOString().split('T')[0];
            }
          } catch (e) {
            // Use current date if parsing fails
          }
        }
        
        results.push({
          title: title,
          price: price,
          date: parsedDate,
          url: url,
          image: image,
          source: 'eBay'
        });
        
      } catch (error) {
        console.error('Error parsing individual eBay item:', error.message);
        continue;
      }
    }
    
    // If we found results with this pattern, don't try others
    if (results.length > 0) {
      break;
    }
  }
  
  console.log(`Modern eBay layout parser found ${results.length} items`);
  return results;
}

function parseEbayAlternativeStrategy(html: string, searchUrl: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  // Alternative parsing for different eBay layouts
  const alternativePatterns = [
    // Look for any div with price and title patterns
    /<div[^>]*>[\s\S]*?\$([0-9,]+\.?[0-9]*)[\s\S]*?<\/div>/g
  ];
  
  // Simple title and price extraction from the entire HTML
  const titlePricePattern = /<[^>]*>([^<]*(?:Jayden\s+Daniels|Prizm)[^<]*)<\/[^>]*>[\s\S]*?\$([0-9,]+\.?[0-9]*)/gi;
  
  let match;
  while ((match = titlePricePattern.exec(html)) !== null && results.length < 10) {
    const title = match[1].trim();
    const priceStr = match[2];
    
    if (title.length > 10 && priceStr) {
      const price = parseFloat(priceStr.replace(/,/g, ''));
      if (price > 0 && price < 10000) {
        results.push({
          title: title,
          price: price,
          date: new Date().toISOString().split('T')[0],
          url: searchUrl,
          source: 'eBay'
        });
      }
    }
  }
  
  console.log(`Alternative eBay parsing found ${results.length} items`);
  return results;
}

function deduplicateEbayResults(results: EbayResult[], originalQuery: string): EbayResult[] {
  const seen = new Map<string, EbayResult>();
  
  for (const result of results) {
    // Create a signature for deduplication
    const titleWords = result.title.toLowerCase().split(/\s+/).sort();
    const signature = `${titleWords.slice(0, 4).join('')}_${Math.round(result.price / 5) * 5}`;
    
    const existing = seen.get(signature);
    if (!existing || new Date(result.date) > new Date(existing.date)) {
      seen.set(signature, result);
    }
  }
  
  const uniqueResults = Array.from(seen.values());
  
  // Sort by relevance to the original query
  return uniqueResults.sort((a, b) => {
    const aScore = calculateEbayRelevanceScore(a.title, originalQuery);
    const bScore = calculateEbayRelevanceScore(b.title, originalQuery);
    
    if (Math.abs(aScore - bScore) > 0.1) {
      return bScore - aScore; // Higher score first
    }
    
    // If relevance is similar, prefer more recent
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}

function calculateEbayRelevanceScore(title: string, originalQuery: string): number {
  const titleLower = title.toLowerCase();
  const queryLower = originalQuery.toLowerCase();
  
  let score = 0;
  
  // Exact substring match bonus
  if (titleLower.includes(queryLower)) {
    score += 2.0;
  }
  
  // Extract key terms from both
  const titleTerms = titleLower.split(/\s+/).filter(t => t.length > 2);
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
  
  // Calculate term overlap
  const matchedTerms = queryTerms.filter(term => titleTerms.includes(term));
  const termScore = matchedTerms.length / queryTerms.length;
  score += termScore * 1.5;
  
  // Specific bonuses for card terms
  const cardTerms = ['prizm', 'silver', 'rookie', 'rc', 'daniels', 'jayden', '347', '2024'];
  const termBonuses = cardTerms.filter(term => 
    titleLower.includes(term) && queryLower.includes(term)
  );
  score += termBonuses.length * 0.2;
  
  // Penalty for obvious non-matches
  if (titleLower.includes('lot of') || titleLower.includes('break')) {
    score -= 1.0;
  }
  
  return Math.max(0, score);
}

async function fetchEbayAPI(searchQuery: string, apiKey: string): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('Using eBay Browse API with enhanced validation');
  
  const endpoint = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
  };
  
  const params = new URLSearchParams({
    q: searchQuery,
    filter: 'conditionIds:{3000|3001|3002|3003|3004|3005},buyingOptions:{AUCTION|FIXED_PRICE},deliveryCountry:US,itemLocationCountry:US,itemEndDate:[2024-01-01T00:00:00.000Z..],soldItemsOnly:true',
    sort: 'endTimeNewest',
    limit: '50', // Reduced for speed
    offset: '0'
  });
  
  const response = await fetch(`${endpoint}?${params}`, { headers });
  
  if (!response.ok) {
    throw new Error(`eBay API error: ${response.status} ${response.statusText}`);
  }
  
  // Check content type before parsing
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`eBay API returned unexpected content-type: ${contentType}`);
  }
  
  const data = await response.json();
  
  // Validate API response structure
  if (!data || typeof data !== 'object') {
    throw new Error('eBay API returned invalid response structure');
  }
  
  if (!data.itemSummaries || data.itemSummaries.length === 0) {
    return { results: [] };
  }
  
  const results = data.itemSummaries.map((item: any) => ({
    title: item.title || 'Unknown Title',
    price: parseFloat(item.price?.value || '0'),
    date: item.itemEndDate ? new Date(item.itemEndDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    image: item.image?.imageUrl,
    url: item.itemWebUrl || '',
    source: 'eBay'
  })).filter((item: EbayResult) => item.price > 0 && item.title.length > 5);
  
  console.log(`eBay API found ${results.length} results`);
  return { results };
}

// Enhanced rate limiting with faster intervals
let lastRequestTime = 0;

async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`eBay rate limiting: waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRequestTime = Date.now();
  return fetch(url, options);
}

// Utility function for timeout promises
function timeoutPromise<T>(ms: number, errorMessage: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), ms);
  });
}
