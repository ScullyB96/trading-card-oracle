
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
  details?: any;
}

// Global timeout constants
const REQUEST_TIMEOUT = 15000; // Increased timeout
const MIN_REQUEST_INTERVAL = 1500; // More conservative interval

// Enhanced URL validation
function isValidEbayUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  
  const ebayPatterns = [
    /ebay\.com\/itm\//i,
    /ebay\.com\/.*\/\d+/i,
    /ebay\..*\/.*\d{10,}/i,
    /ebay\.com\/sch\//i
  ];
  
  return ebayPatterns.some(pattern => pattern.test(url));
}

// Enhanced URL extraction with multiple strategies
function extractEbayUrls(html: string): string[] {
  const urls = new Set<string>();
  
  // Multiple URL extraction patterns with priorities
  const patterns = [
    // Highest priority: Direct item links
    /href="([^"]*ebay\.com[^"]*\/itm\/[^"]*\d{10,}[^"]*)"/gi,
    // Second priority: Standard item links
    /href="([^"]*ebay\.com[^"]*itm[^"]*\d{10,}[^"]*)"/gi,
    // Third priority: Any eBay URL with long numbers
    /href="([^"]*ebay\.com[^"]*\d{10,}[^"]*)"/gi,
    // Fourth priority: Generic eBay URLs in search results
    /(https?:\/\/[^"\s]*ebay\.com[^"\s]*itm[^"\s]*)/gi,
    // Fallback: Relative URLs
    /href="(\/itm\/[^"]*\d{10,}[^"]*)"/gi
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && urls.size < 30) {
      let url = match[1];
      
      // Clean and normalize URL
      if (url.startsWith('/')) {
        url = 'https://www.ebay.com' + url;
      }
      
      // Remove common URL artifacts
      url = url
        .replace(/&amp;/g, '&')
        .replace(/\?hash=.*$/, '')
        .replace(/\?_trkparms=.*$/, '')
        .split('?')[0]; // Keep only base URL
      
      if (isValidEbayUrl(url) && url.length < 200) {
        urls.add(url);
      }
    }
  }
  
  return Array.from(urls).slice(0, 25);
}

export async function fetchEbayComps(searchQuery: string): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('=== ENHANCED EBAY SCRAPING v2.0 ===');
  console.log('Search query:', searchQuery);
  
  try {
    const searchUrl = buildEbayUrl(searchQuery);
    console.log('eBay search URL:', searchUrl);
    
    const response = await rateLimitedFetchWithTimeout(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    console.log(`eBay HTML received: ${html.length} characters`);
    
    // Extract URLs and parse results
    const itemUrls = extractEbayUrls(html);
    console.log(`Found ${itemUrls.length} potential eBay item URLs`);
    
    if (itemUrls.length === 0) {
      console.log('No eBay URLs found, trying direct HTML parsing');
      const directResults = parseEbaySearchResults(html, searchQuery);
      console.log(`Direct parsing found ${directResults.length} results`);
      return { results: directResults.slice(0, 20) };
    }
    
    // Parse results with multiple strategies
    const results = await parseEbayResults(html, itemUrls, searchQuery);
    
    console.log(`Enhanced eBay scraping completed: ${results.length} results`);
    return { results: results.slice(0, 25) };
    
  } catch (error) {
    console.error('Enhanced eBay scraping failed:', error);
    return {
      results: [],
      error: {
        source: 'eBay Enhanced',
        message: error.message,
        details: { searchQuery, timestamp: new Date().toISOString() }
      }
    };
  }
}

function buildEbayUrl(searchQuery: string): string {
  const params = new URLSearchParams({
    '_nkw': searchQuery,
    'LH_Sold': '1',
    'LH_Complete': '1',
    '_sop': '13', // Sort by newest
    '_ipg': '60', // Items per page
    'rt': 'nc' // No cache
  });
  
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

// Enhanced parsing with multiple strategies
async function parseEbayResults(html: string, itemUrls: string[], originalQuery: string): Promise<EbayResult[]> {
  const results: EbayResult[] = [];
  
  // Strategy 1: Parse from search results page directly
  const searchResults = parseEbaySearchResults(html, originalQuery);
  results.push(...searchResults);
  
  // Strategy 2: Extract data from item contexts
  const contextResults = parseItemContexts(html, itemUrls.slice(0, 15), originalQuery);
  results.push(...contextResults);
  
  // Strategy 3: Pattern-based extraction
  const patternResults = parseWithPatterns(html, originalQuery);
  results.push(...patternResults);
  
  // Deduplicate and validate
  const uniqueResults = deduplicateResults(results);
  
  return uniqueResults.filter(result => 
    result.price > 0 && 
    result.title.length > 10 &&
    result.price < 50000
  );
}

function parseEbaySearchResults(html: string, query: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  // Multiple section patterns for different eBay layouts
  const sectionPatterns = [
    /<div[^>]*class="[^"]*s-item[^"]*"[^>]*>(.*?)<\/div>/gis,
    /<li[^>]*class="[^"]*s-item[^"]*"[^>]*>(.*?)<\/li>/gis,
    /<article[^>]*class="[^"]*item[^"]*"[^>]*>(.*?)<\/article>/gis
  ];
  
  for (const pattern of sectionPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < 15) {
      const section = match[1];
      
      try {
        const result = extractDataFromSection(section, query);
        if (result) {
          results.push(result);
          console.log(`✅ Found result: "${result.title}" - $${result.price}`);
        }
      } catch (error) {
        // Continue to next section
      }
    }
  }
  
  return results;
}

function extractDataFromSection(section: string, query: string): EbayResult | null {
  try {
    // Enhanced price extraction
    const pricePatterns = [
      /\$([0-9,]+\.?\d*)/g,
      /USD\s*([0-9,]+\.?\d*)/g,
      /price[^>]*>.*?\$([0-9,]+\.?\d*)/gi,
      /"currentPrice"[^}]*"value":\s*"?([0-9,]+\.?\d*)"?/g
    ];
    
    let price = 0;
    for (const pattern of pricePatterns) {
      const matches = [...section.matchAll(pattern)];
      for (const match of matches) {
        const p = parseFloat(match[1].replace(/[,$]/g, ''));
        if (p > 1 && p < 25000) {
          price = p;
          break;
        }
      }
      if (price > 0) break;
    }
    
    if (price === 0) return null;
    
    // Enhanced title extraction
    const titlePatterns = [
      /<h3[^>]*class="[^"]*s-item__title[^"]*"[^>]*>([^<]+)</i,
      /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*>([^<]{15,200})</i,
      /title="([^"]{15,200})"/i,
      />([^<]{20,150}card[^<]{5,50})</gi,
      />([^<]{15,200})</g
    ];
    
    let title = '';
    for (const pattern of titlePatterns) {
      const match = section.match(pattern);
      if (match && match[1] && match[1].trim().length >= 15) {
        title = match[1].trim();
        // Clean up title
        title = title.replace(/\s+/g, ' ').replace(/[^\w\s\-#.()]/g, '');
        if (title.length >= 15) break;
      }
    }
    
    if (!title) return null;
    
    // Extract URL
    const urlMatch = section.match(/href="([^"]*(?:itm|item)[^"]*)"/i);
    const url = urlMatch ? urlMatch[1].replace(/&amp;/g, '&') : `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
    
    // Extract image
    const imagePatterns = [
      /src="([^"]*i\.ebayimg\.com[^"]*)"/i,
      /data-src="([^"]*i\.ebayimg\.com[^"]*)"/i,
      /"originalImg":\s*"([^"]+)"/i
    ];
    
    let image;
    for (const pattern of imagePatterns) {
      const match = section.match(pattern);
      if (match && match[1]) {
        image = match[1];
        break;
      }
    }
    
    return {
      title,
      price: Math.round(price * 100) / 100,
      date: new Date().toISOString().split('T')[0],
      url: url.startsWith('http') ? url : `https://www.ebay.com${url}`,
      source: 'eBay',
      image
    };
    
  } catch (error) {
    return null;
  }
}

function parseItemContexts(html: string, itemUrls: string[], query: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  for (const url of itemUrls.slice(0, 10)) {
    const urlPos = html.indexOf(url);
    if (urlPos === -1) continue;
    
    // Get larger context around the URL
    const start = Math.max(0, urlPos - 2000);
    const end = Math.min(html.length, urlPos + 2000);
    const context = html.substring(start, end);
    
    try {
      const result = extractDataFromSection(context, query);
      if (result) {
        result.url = url;
        results.push(result);
      }
    } catch (error) {
      // Continue to next URL
    }
  }
  
  return results;
}

function parseWithPatterns(html: string, query: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  // Look for price-title pairs using broader patterns
  const priceMatches = [...html.matchAll(/\$([0-9,]+\.?\d*)/g)];
  const titleMatches = [...html.matchAll(/>([^<]{20,150})<\/[^>]*>/g)];
  
  // Try to correlate prices with nearby titles
  for (const priceMatch of priceMatches.slice(0, 20)) {
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (price <= 1 || price >= 25000) continue;
    
    const pricePos = priceMatch.index;
    
    // Look for titles near this price
    for (const titleMatch of titleMatches) {
      const titlePos = titleMatch.index;
      const distance = Math.abs(titlePos - pricePos);
      
      if (distance < 1000) { // Within 1000 characters
        const title = titleMatch[1].trim();
        
        // Validate title quality
        if (title.length >= 20 && 
            !title.includes('<') && 
            !title.includes('>') &&
            (title.toLowerCase().includes('card') || 
             title.toLowerCase().includes(query.toLowerCase().split(' ')[0]))) {
          
          results.push({
            title: title.substring(0, 150),
            price: Math.round(price * 100) / 100,
            date: new Date().toISOString().split('T')[0],
            url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`,
            source: 'eBay'
          });
          
          break; // One title per price
        }
      }
    }
  }
  
  return results.slice(0, 8);
}

function deduplicateResults(results: EbayResult[]): EbayResult[] {
  const seen = new Map<string, EbayResult>();
  
  for (const result of results) {
    const key = `${result.title.toLowerCase().replace(/\s+/g, '')}_${Math.floor(result.price / 5) * 5}`;
    
    if (!seen.has(key)) {
      seen.set(key, result);
    }
  }
  
  return Array.from(seen.values());
}

// Rate limiting with enhanced timeout
let lastRequestTime = 0;

async function rateLimitedFetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRequestTime = Date.now();
  
  return Promise.race([
    fetch(url, options),
    new Promise<Response>((_, reject) => 
      setTimeout(() => reject(new Error(`eBay request timeout after ${REQUEST_TIMEOUT}ms`)), REQUEST_TIMEOUT)
    )
  ]);
}
