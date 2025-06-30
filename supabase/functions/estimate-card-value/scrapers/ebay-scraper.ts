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
}

// Global timeout constants
const REQUEST_TIMEOUT = 10000; // 10 seconds per request
const MIN_REQUEST_INTERVAL = 1500; // 1.5 seconds between requests

// URL validation utility
function isValidEbayItemUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  
  // Must be an eBay item URL
  const ebayItemPattern = /^https?:\/\/(?:www\.)?ebay\.com\/itm\/[\w\-\/]+/i;
  return ebayItemPattern.test(url);
}

// Enhanced URL extraction utility
function extractEbayItemUrl(html: string): string | null {
  // Multiple URL extraction patterns in order of preference
  const urlPatterns = [
    // Primary s-item link pattern
    /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*href="([^"]+)"/i,
    // Alternative s-item link pattern
    /<a[^>]*href="([^"]+)"[^>]*class="[^"]*s-item__link[^"]*"/i,
    // Direct item link with itm
    /<a[^>]*href="(https?:\/\/(?:www\.)?ebay\.com\/itm\/[^"]+)"/i,
    // Anchor with item ID pattern
    /<a[^>]*href="([^"]*\/itm\/[^"]*)"[^>]*>/i,
    // Generic ebay.com/itm link
    /href="(https?:\/\/[^"]*ebay\.com[^"]*\/itm\/[^"]+)"/i,
    // Any ebay item URL in the HTML block
    /(https?:\/\/(?:www\.)?ebay\.com\/itm\/[\w\-\/?&=%.]+)/i
  ];

  for (const pattern of urlPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      let url = match[1];
      
      // Clean up the URL
      url = url.replace(/&amp;/g, '&');
      url = url.split('?')[0]; // Remove query parameters to get clean item URL
      
      // Validate the extracted URL
      if (isValidEbayItemUrl(url)) {
        return url;
      }
    }
  }
  
  return null;
}

export async function fetchEbayComps(searchQuery: string): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('=== IMPROVED EBAY SCRAPING ===');
  console.log('Search query:', searchQuery);
  
  try {
    // Build a single, focused search URL
    const searchUrl = buildEbayUrl(searchQuery);
    console.log('eBay URL:', searchUrl);
    
    const response = await rateLimitedFetchWithTimeout(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    ScrapingDebugger.logResponse('eBay', response, html);
    
    // Try multiple parsing strategies
    const results = await parseEbayHtmlImproved(html, searchUrl, searchQuery);
    
    if (results.length === 0) {
      return {
        results: [],
        error: {
          source: 'eBay',
          message: 'No results found with valid item URLs',
          details: {
            htmlLength: html.length,
            hasItems: html.includes('s-item'),
            hasPrice: html.includes('$'),
            queryInHtml: html.toLowerCase().includes(searchQuery.toLowerCase())
          }
        }
      };
    }
    
    console.log(`eBay scraping found ${results.length} valid results with permalinks`);
    return { results: results.slice(0, 25) };
    
  } catch (error) {
    console.error('eBay scraping failed:', error);
    return {
      results: [],
      error: {
        source: 'eBay',
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
    '_ipg': '60',
    'rt': 'nc'
  });
  
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

async function parseEbayHtmlImproved(html: string, searchUrl: string, originalQuery: string): Promise<EbayResult[]> {
  const results: EbayResult[] = [];
  
  // Strategy 1: Modern s-item structure
  const modernResults = parseEbayModern(html, searchUrl);
  results.push(...modernResults);
  
  // Strategy 2: Fallback regex patterns
  if (results.length < 3) {
    const fallbackResults = parseEbayFallback(html, searchUrl);
    results.push(...fallbackResults);
  }
  
  // Strategy 3: Simple price/title extraction
  if (results.length < 3) {
    const simpleResults = parseEbaySimple(html, searchUrl);
    results.push(...simpleResults);
  }
  
  console.log(`eBay parsing found ${results.length} total results with valid URLs`);
  
  // Enhanced validation - ensure all results have valid URLs
  return results.filter(r => 
    r.title && 
    r.title.length > 5 && 
    r.price > 0 && 
    r.price < 50000 && 
    isValidEbayItemUrl(r.url) // Critical: only return results with valid item URLs
  );
}

function parseEbayModern(html: string, searchUrl: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  // Look for s-item containers
  const itemRegex = /<div[^>]*class="[^"]*s-item[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*s-item[^"]*"|<\/div>\s*<\/div>\s*$)/g;
  
  let match;
  while ((match = itemRegex.exec(html)) !== null && results.length < 50) {
    const itemHtml = match[0];
    
    try {
      // Extract URL first - if no valid URL, skip this item entirely
      const itemUrl = extractEbayItemUrl(itemHtml);
      if (!itemUrl) {
        console.log('Skipping item - no valid URL found');
        continue;
      }
      
      // Extract title - try multiple patterns
      const titlePatterns = [
        /<h3[^>]*class="[^"]*s-item__title[^"]*"[^>]*>(?:<[^>]*>)*([^<]+)/,
        /<span[^>]*role="heading"[^>]*>([^<]+)/,
        /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*title="([^"]+)"/
      ];
      
      let title = '';
      for (const pattern of titlePatterns) {
        const titleMatch = itemHtml.match(pattern);
        if (titleMatch && titleMatch[1] && titleMatch[1].trim().length > 5) {
          title = titleMatch[1].trim();
          break;
        }
      }
      
      if (!title) {
        console.log('Skipping item - no valid title found');
        continue;
      }
      
      // Extract price
      const priceMatch = itemHtml.match(/<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>(?:<[^>]*>)*\$([0-9,]+\.?[0-9]*)/);
      if (!priceMatch) {
        console.log('Skipping item - no valid price found');
        continue;
      }
      
      const price = parseFloat(priceMatch[1].replace(/,/g, ''));
      if (price <= 0) {
        console.log('Skipping item - invalid price value');
        continue;
      }
      
      // Extract date
      const dateMatch = itemHtml.match(/Sold\s+([^<]+)/);
      let date = new Date().toISOString().split('T')[0];
      if (dateMatch) {
        try {
          const parsedDate = new Date(dateMatch[1]);
          if (!isNaN(parsedDate.getTime())) {
            date = parsedDate.toISOString().split('T')[0];
          }
        } catch (e) {
          // Keep default date
        }
      }
      
      // Extract image
      const imageMatch = itemHtml.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*s-item__image/);
      
      results.push({
        title,
        price,
        date,
        url: itemUrl, // Always use the extracted valid URL
        image: imageMatch ? imageMatch[1] : undefined,
        source: 'eBay'
      });
      
    } catch (error) {
      console.error('Error parsing eBay item:', error);
      continue;
    }
  }
  
  console.log(`Modern eBay parsing: ${results.length} items with valid URLs`);
  return results;
}

function parseEbayFallback(html: string, searchUrl: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  // Enhanced fallback approach - look for item blocks with URLs
  const itemBlockRegex = /<div[^>]*class="[^"]*s-item[^"]*"[^>]*>[\s\S]{1,2000}?<\/div>/g;
  
  let match;
  while ((match = itemBlockRegex.exec(html)) !== null && results.length < 20) {
    const itemBlock = match[0];
    
    // Extract URL first
    const itemUrl = extractEbayItemUrl(itemBlock);
    if (!itemUrl) continue;
    
    // Look for title and price within this block
    const titleMatch = itemBlock.match(/>([^<]*(?:Prizm|Rookie|RC|Daniels|PSA|BGS|Card)[^<]*)</i);
    const priceMatch = itemBlock.match(/\$([0-9,]+\.?[0-9]*)/);
    
    if (titleMatch && priceMatch) {
      const title = titleMatch[1].trim();
      const price = parseFloat(priceMatch[1].replace(/,/g, ''));
      
      if (title.length > 10 && price > 0 && price < 10000) {
        results.push({
          title,
          price,
          date: new Date().toISOString().split('T')[0],
          url: itemUrl,
          source: 'eBay'
        });
      }
    }
  }
  
  console.log(`Fallback eBay parsing: ${results.length} items with valid URLs`);
  return results;
}

function parseEbaySimple(html: string, searchUrl: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  // Find all eBay item URLs in the HTML
  const itemUrlPattern = /https?:\/\/(?:www\.)?ebay\.com\/itm\/[\w\-\/?&=%.]+/g;
  const itemUrls = [...new Set(html.match(itemUrlPattern) || [])];
  
  console.log(`Found ${itemUrls.length} potential item URLs in HTML`);
  
  // For each URL, try to find associated price and title nearby
  itemUrls.slice(0, 10).forEach((url, index) => {
    const urlIndex = html.indexOf(url);
    if (urlIndex > 0) {
      // Look for context around this URL (before and after)
      const contextStart = Math.max(0, urlIndex - 800);
      const contextEnd = Math.min(html.length, urlIndex + 800);
      const context = html.substring(contextStart, contextEnd);
      
      const priceMatch = context.match(/\$([0-9,]+\.?[0-9]*)/);
      const titleMatch = context.match(/>([^<]*(?:Card|Rookie|Prizm|Daniels)[^<]*)</i);
      
      if (priceMatch && titleMatch) {
        const price = parseFloat(priceMatch[1].replace(/[$,]/g, ''));
        const title = titleMatch[1].trim();
        
        if (price > 5 && price < 5000 && title.length > 5) {
          results.push({
            title,
            price,
            date: new Date().toISOString().split('T')[0],
            url: url.split('?')[0], // Clean URL
            source: 'eBay'
          });
        }
      }
    }
  });
  
  console.log(`Simple eBay parsing: ${results.length} items with valid URLs`);
  return results;
}

// Enhanced rate limiting with timeout
let lastRequestTime = 0;

async function rateLimitedFetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`eBay rate limiting: waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRequestTime = Date.now();
  
  // Wrap fetch with timeout using Promise.race
  return Promise.race([
    fetch(url, options),
    new Promise<Response>((_, reject) => 
      setTimeout(() => reject(new Error(`eBay request timeout after ${REQUEST_TIMEOUT}ms`)), REQUEST_TIMEOUT)
    )
  ]);
}
