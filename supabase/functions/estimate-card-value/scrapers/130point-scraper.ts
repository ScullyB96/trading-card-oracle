export interface Point130Result {
  title: string;
  price: number;
  date: string;
  image?: string;
  url: string;
  source: string;
}

export interface Point130Error {
  source: string;
  message: string;
  details?: any;
}

// Enhanced debugging utilities
class ScrapingDebugger {
  static logResponse(source: string, response: Response, html?: string) {
    console.log(`=== ${source} RESPONSE DEBUG ===`);
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Headers:`, Object.fromEntries(response.headers.entries()));
    console.log(`Content-Type: ${response.headers.get('content-type')}`);
    if (html) {
      console.log(`HTML Length: ${html.length}`);
      console.log(`HTML Preview: ${html.substring(0, 500)}...`);
      
      // Check for common blocking indicators
      if (html.includes('captcha') || html.includes('robot')) {
        console.warn('⚠️ Possible bot detection/captcha');
      }
      if (html.includes('blocked') || html.includes('access denied')) {
        console.warn('⚠️ Access blocked');
      }
    }
    console.log('========================');
  }

  static logEndpointResult(endpoint: string, resultCount: number, error?: string) {
    console.log(`📊 ${endpoint} Results: ${resultCount}${error ? ` (Error: ${error})` : ''}`);
  }
}

// Rate limiting with enhanced timeout protection
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1200; // 1.2 seconds between requests
const REQUEST_TIMEOUT = 7000; // 7 seconds timeout as requested

async function rateLimitedFetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`130Point rate limiting: waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRequestTime = Date.now();
  
  // Enhanced timeout protection with Promise.race
  return Promise.race([
    fetch(url, options),
    new Promise<Response>((_, reject) => 
      setTimeout(() => reject(new Error(`130Point request timeout after ${REQUEST_TIMEOUT}ms`)), REQUEST_TIMEOUT)
    )
  ]);
}

export async function fetch130PointComps(searchQuery: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  console.log('=== HARDENED 130POINT SCRAPING ===');
  console.log('Search query:', searchQuery);
  
  const searchUrl = `https://130point.com/sales/?search=${encodeURIComponent(searchQuery)}`;
  console.log('130Point URL:', searchUrl);
  
  // Strategy 1: Try V2 API endpoint
  const v2Results = await try130PointV2API(searchQuery, searchUrl);
  ScrapingDebugger.logEndpointResult('V2 API', v2Results.results.length, v2Results.error?.message);
  
  if (v2Results.results.length > 0) {
    return v2Results;
  }
  
  // Strategy 2: Try V1 API fallback
  const v1Results = await try130PointV1API(searchQuery, searchUrl);
  ScrapingDebugger.logEndpointResult('V1 API', v1Results.results.length, v1Results.error?.message);
  
  if (v1Results.results.length > 0) {
    return v1Results;
  }
  
  // Strategy 3: HTML scraping as last resort
  const htmlResults = await try130PointHTMLScraping(searchQuery, searchUrl);
  ScrapingDebugger.logEndpointResult('HTML Scraping', htmlResults.results.length, htmlResults.error?.message);
  
  if (htmlResults.results.length > 0) {
    return htmlResults;
  }
  
  // All strategies failed - return structured error
  console.log('❌ All 130Point strategies failed');
  return {
    results: [],
    error: {
      source: '130Point',
      message: 'No results found for this card',
      details: {
        searchQuery,
        strategiesTried: ['V2 API', 'V1 API', 'HTML Scraping'],
        searchUrl
      }
    }
  };
}

async function try130PointV2API(searchQuery: string, fallbackUrl: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  try {
    console.log('🔄 Trying 130Point V2 API...');
    const apiUrl = `https://130point.com/api/v2/search?q=${encodeURIComponent(searchQuery)}&limit=30`;
    
    const response = await rateLimitedFetchWithTimeout(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; CardScraper/1.0)',
      }
    });
    
    if (!response.ok) {
      throw new Error(`V2 API HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const results = parse130PointResponse(data, fallbackUrl);
    
    console.log(`✅ V2 API returned ${results.length} results`);
    return { results };
    
  } catch (error) {
    console.log(`❌ V2 API failed: ${error.message}`);
    return {
      results: [],
      error: {
        source: '130Point V2 API',
        message: error.message
      }
    };
  }
}

async function try130PointV1API(searchQuery: string, fallbackUrl: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  try {
    console.log('🔄 Trying 130Point V1 API...');
    const apiUrl = `https://130point.com/api/search?query=${encodeURIComponent(searchQuery)}`;
    
    const response = await rateLimitedFetchWithTimeout(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; CardScraper/1.0)',
      }
    });
    
    if (!response.ok) {
      throw new Error(`V1 API HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const results = parse130PointResponse(data, fallbackUrl);
    
    console.log(`✅ V1 API returned ${results.length} results`);
    return { results };
    
  } catch (error) {
    console.log(`❌ V1 API failed: ${error.message}`);
    return {
      results: [],
      error: {
        source: '130Point V1 API',
        message: error.message
      }
    };
  }
}

async function try130PointHTMLScraping(searchQuery: string, searchUrl: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  try {
    console.log('🔄 Trying 130Point HTML scraping...');
    
    const response = await rateLimitedFetchWithTimeout(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CardScraper/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTML scraping HTTP ${response.status}`);
    }
    
    const html = await response.text();
    ScrapingDebugger.logResponse('130Point HTML', response, html);
    
    const results = parse130PointHtml(html, searchUrl);
    
    console.log(`✅ HTML scraping returned ${results.length} results`);
    return { results };
    
  } catch (error) {
    console.log(`❌ HTML scraping failed: ${error.message}`);
    return {
      results: [],
      error: {
        source: '130Point HTML',
        message: error.message
      }
    };
  }
}

function parse130PointResponse(data: any, fallbackUrl: string): Point130Result[] {
  console.log('🔍 Parsing 130Point API response...');
  
  let items: any[] = [];
  
  // Handle different API response structures
  if (Array.isArray(data)) {
    items = data;
  } else if (data.results && Array.isArray(data.results)) {
    items = data.results;
  } else if (data.data && Array.isArray(data.data)) {
    items = data.data;
  } else if (data.sales && Array.isArray(data.sales)) {
    items = data.sales;
  }
  
  console.log(`📋 Found ${items.length} raw items to validate`);
  
  const validResults: Point130Result[] = [];
  
  for (const item of items) {
    if (!item) continue;
    
    const title = extractTitle(item);
    const price = extractPrice(item);
    const date = extractDate(item);
    const url = extractUrl(item, fallbackUrl);
    
    // Apply strict validation
    if (isStrictlyValidCard(title, price)) {
      validResults.push({
        title,
        price,
        date,
        url,
        source: '130Point',
        image: item.image || item.thumbnail
      });
    }
  }
  
  // Deduplicate and sort
  const dedupedResults = deduplicateResults(validResults);
  const sortedResults = sortResultsByDate(dedupedResults);
  
  console.log(`✅ Validation complete: ${items.length} raw → ${validResults.length} valid → ${sortedResults.length} final`);
  return sortedResults;
}

function parse130PointHtml(html: string, searchUrl: string): Point130Result[] {
  console.log('🔍 Parsing 130Point HTML...');
  
  const results: Point130Result[] = [];
  
  // Enhanced HTML parsing patterns
  const patterns = [
    // Table rows
    /<tr[^>]*>[\s\S]*?<\/tr>/g,
    // Card/sale divs
    /<div[^>]*class="[^"]*(?:sale|card|listing|auction)[^"]*"[^>]*>[\s\S]*?<\/div>/g,
    // Generic containers with price indicators
    /<div[^>]*>[\s\S]*?\$[0-9,]+\.?[0-9]*[\s\S]*?<\/div>/g
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < 50) {
      const itemHtml = match[0];
      const parsedItem = parseHtmlItem(itemHtml, searchUrl);
      
      if (parsedItem && isStrictlyValidCard(parsedItem.title, parsedItem.price)) {
        results.push(parsedItem);
      }
    }
    
    if (results.length > 0) {
      console.log(`🎯 HTML pattern found ${results.length} valid results`);
      break;
    }
  }
  
  // Deduplicate and sort
  const dedupedResults = deduplicateResults(results);
  const sortedResults = sortResultsByDate(dedupedResults);
  
  console.log(`✅ HTML parsing: ${results.length} raw → ${sortedResults.length} final`);
  return sortedResults;
}

function parseHtmlItem(itemHtml: string, fallbackUrl: string): Point130Result | null {
  // Extract title
  const titlePatterns = [
    />([^<]*(?:Rookie|RC|Prizm|Daniels|Card)[^<]*)</i,
    /title="([^"]*(?:Rookie|RC|Prizm|Daniels|Card)[^"]*)"/i,
    /<h[1-6][^>]*>([^<]*(?:Rookie|RC|Prizm|Daniels|Card)[^<]*)</i
  ];
  
  let title = '';
  for (const pattern of titlePatterns) {
    const match = itemHtml.match(pattern);
    if (match && match[1] && match[1].trim().length >= 10) {
      title = match[1].trim();
      break;
    }
  }
  
  // Extract price
  const pricePatterns = [
    /\$([0-9,]+\.?[0-9]*)/,
    /(?:Price|Sold)[^$]*\$([0-9,]+\.?[0-9]*)/i
  ];
  
  let price = 0;
  for (const pattern of pricePatterns) {
    const match = itemHtml.match(pattern);
    if (match && match[1]) {
      price = parseFloat(match[1].replace(/[$,]/g, ''));
      if (price > 0) break;
    }
  }
  
  if (!title || price <= 0) {
    return null;
  }
  
  // Extract date
  const dateMatch = itemHtml.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})|(\d{4}-\d{2}-\d{2})/);
  let date = new Date().toISOString().split('T')[0];
  
  if (dateMatch) {
    try {
      const parsedDate = new Date(dateMatch[0]);
      if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > 2020) {
        date = parsedDate.toISOString().split('T')[0];
      }
    } catch (e) {
      // Keep default date
    }
  }
  
  return {
    title,
    price,
    date,
    url: fallbackUrl, // Always use real 130Point search URL
    source: '130Point'
  };
}

// STRICT VALIDATION - Enhanced as requested
function isStrictlyValidCard(title: string, price: number): boolean {
  // Check title length (minimum 10 characters as requested)
  if (!title || title.length < 10) {
    console.log(`❌ Rejecting: title too short (${title?.length || 0} chars): "${title}"`);
    return false;
  }
  
  // Check price validity
  if (!price || price <= 0 || price > 10000) {
    console.log(`❌ Rejecting: invalid price (${price}): "${title}"`);
    return false;
  }
  
  // Reject non-card terms (expanded list)
  const titleLower = title.toLowerCase();
  const invalidTerms = [
    'break', 'breaks', 'lot of', 'lots', 'collection', 'bundle', 'mixed',
    'random', 'mystery', 'pack', 'packs', 'box', 'boxes', 'case', 'cases', 
    'supplies', 'hobby box', 'blaster', 'retail', 'factory set'
  ];
  
  for (const term of invalidTerms) {
    if (titleLower.includes(term)) {
      console.log(`❌ Rejecting: contains invalid term "${term}": "${title}"`);
      return false;
    }
  }
  
  console.log(`✅ Validated card: "${title}" - $${price}`);
  return true;
}

// DEDUPLICATION - Enhanced as requested
function deduplicateResults(results: Point130Result[]): Point130Result[] {
  console.log(`🔄 Deduplicating ${results.length} results...`);
  
  const seen = new Map<string, Point130Result>();
  
  for (const result of results) {
    // Create signature from normalized title + price
    const normalizedTitle = result.title.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const signature = `${normalizedTitle}_${result.price}`;
    
    // Keep the most recent result for each signature
    const existing = seen.get(signature);
    if (!existing || new Date(result.date) > new Date(existing.date)) {
      seen.set(signature, result);
    }
  }
  
  const dedupedResults = Array.from(seen.values());
  console.log(`✅ Deduplication: ${results.length} → ${dedupedResults.length}`);
  
  return dedupedResults;
}

// SORTING - Sort by date DESC as requested
function sortResultsByDate(results: Point130Result[]): Point130Result[] {
  return results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// Utility functions for extracting data from API responses
function extractTitle(item: any): string {
  return item.title || item.name || item.description || item.card_name || '';
}

function extractPrice(item: any): number {
  const price = item.price || item.sale_price || item.final_price || item.amount || 0;
  return typeof price === 'string' ? parseFloat(price.replace(/[$,]/g, '')) : Number(price) || 0;
}

function extractDate(item: any): string {
  const dateStr = item.date || item.sale_date || item.sold_date || item.created_at;
  
  if (dateStr) {
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime()) && date.getFullYear() > 2020) {
        return date.toISOString().split('T')[0];
      }
    } catch (e) {
      // Fall through to default
    }
  }
  
  return new Date().toISOString().split('T')[0];
}

function extractUrl(item: any, fallbackUrl: string): string {
  // NEVER fake URLs - always use real 130Point search URL as requested
  const itemUrl = item.url || item.link || item.permalink;
  
  if (itemUrl && itemUrl.startsWith('http')) {
    return itemUrl;
  }
  
  // Always return the real 130Point search URL, never fake eBay URLs
  return fallbackUrl;
}
