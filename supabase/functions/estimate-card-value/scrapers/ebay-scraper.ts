
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
const REQUEST_TIMEOUT = 12000; // Increased timeout
const MIN_REQUEST_INTERVAL = 1000; // Reduced interval

// More flexible URL validation
function isValidEbayUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  
  // Accept any eBay URL that looks reasonable
  const ebayPatterns = [
    /ebay\.com\/itm\//i,
    /ebay\.com\/.*\/\d+/i,
    /ebay\..*\/.*\d+/i
  ];
  
  return ebayPatterns.some(pattern => pattern.test(url));
}

// Simplified URL extraction with multiple fallbacks
function extractEbayUrls(html: string): string[] {
  const urls = new Set<string>();
  
  // Multiple URL extraction patterns
  const patterns = [
    // Standard item links
    /href="([^"]*ebay\.com[^"]*itm[^"]*)/gi,
    // Any eBay link with numbers (likely item IDs)
    /href="([^"]*ebay\.com[^"]*\d{10,}[^"]*)/gi,
    // Generic eBay URLs
    /(https?:\/\/[^"\s]*ebay\.com[^"\s]*)/gi,
    // Relative URLs that might be eBay items
    /href="(\/itm\/[^"]+)"/gi
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let url = match[1];
      
      // Clean and normalize URL
      if (url.startsWith('/')) {
        url = 'https://www.ebay.com' + url;
      }
      url = url.replace(/&amp;/g, '&').split('?')[0];
      
      if (isValidEbayUrl(url)) {
        urls.add(url);
      }
    }
  }
  
  return Array.from(urls).slice(0, 20); // Limit results
}

export async function fetchEbayComps(searchQuery: string): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('=== REVISED EBAY SCRAPING ===');
  console.log('Search query:', searchQuery);
  
  try {
    const searchUrl = buildEbayUrl(searchQuery);
    console.log('eBay URL:', searchUrl);
    
    const response = await rateLimitedFetchWithTimeout(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    console.log(`eBay HTML length: ${html.length}`);
    
    // Extract all potential URLs first
    const itemUrls = extractEbayUrls(html);
    console.log(`Found ${itemUrls.length} potential eBay URLs`);
    
    if (itemUrls.length === 0) {
      console.log('No eBay URLs found in HTML');
      return {
        results: [],
        error: {
          source: 'eBay',
          message: 'No eBay item URLs found in search results',
          details: { htmlLength: html.length, searchUrl }
        }
      };
    }
    
    // Parse results using flexible approach
    const results = await parseEbayFlexible(html, itemUrls, searchQuery);
    
    console.log(`eBay scraping completed: ${results.length} results`);
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
    '_sop': '13',
    '_ipg': '60'
  });
  
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

async function parseEbayFlexible(html: string, itemUrls: string[], originalQuery: string): Promise<EbayResult[]> {
  const results: EbayResult[] = [];
  
  // Strategy 1: Try to find price/title pairs near URLs
  for (const url of itemUrls.slice(0, 10)) {
    const urlPos = html.indexOf(url);
    if (urlPos === -1) continue;
    
    // Look in a large window around the URL
    const start = Math.max(0, urlPos - 1000);
    const end = Math.min(html.length, urlPos + 1000);
    const context = html.substring(start, end);
    
    // Find price in context (very flexible)
    const pricePatterns = [
      /\$([0-9,]+\.?\d*)/g,
      /USD\s*([0-9,]+\.?\d*)/g,
      /price[^>]*>.*?\$([0-9,]+\.?\d*)/gi
    ];
    
    let price = 0;
    for (const pattern of pricePatterns) {
      const matches = [...context.matchAll(pattern)];
      for (const match of matches) {
        const p = parseFloat(match[1].replace(/,/g, ''));
        if (p > 1 && p < 10000) {
          price = p;
          break;
        }
      }
      if (price > 0) break;
    }
    
    // Find title in context (very flexible)
    const titlePatterns = [
      />([^<]{15,200})</g,
      /title="([^"]{15,200})"/gi,
      /alt="([^"]{15,200})"/gi
    ];
    
    let title = '';
    for (const pattern of titlePatterns) {
      const matches = [...context.matchAll(pattern)];
      for (const match of matches) {
        const t = match[1].trim();
        // Accept any title that seems card-related or has reasonable length
        if (t.length >= 15 && (
          t.toLowerCase().includes('card') ||
          t.toLowerCase().includes('rookie') ||
          t.toLowerCase().includes('rc') ||
          t.toLowerCase().includes(originalQuery.toLowerCase().split(' ')[0]) ||
          t.length >= 20
        )) {
          title = t;
          break;
        }
      }
      if (title) break;
    }
    
    if (price > 0 && title) {
      results.push({
        title: title.substring(0, 150), // Limit title length
        price,
        date: new Date().toISOString().split('T')[0],
        url,
        source: 'eBay'
      });
      
      console.log(`✅ eBay result: "${title}" - $${price}`);
    }
  }
  
  // Strategy 2: If we have few results, try broader pattern matching
  if (results.length < 3) {
    const broadResults = parseBroadPatterns(html, originalQuery);
    results.push(...broadResults);
  }
  
  return results;
}

function parseBroadPatterns(html: string, query: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  // Look for any price/title combinations
  const sections = html.split(/<div[^>]*class="[^"]*s-item/i);
  
  for (const section of sections.slice(1, 15)) { // Process up to 15 sections
    const priceMatch = section.match(/\$([0-9,]+\.?\d*)/);
    const titleMatches = [
      ...section.matchAll(/>([^<]{20,150})</g)
    ];
    
    if (priceMatch) {
      const price = parseFloat(priceMatch[1].replace(/,/g, ''));
      
      if (price > 1 && price < 5000) {
        // Find the best title candidate
        for (const titleMatch of titleMatches) {
          const title = titleMatch[1].trim();
          
          if (title.length >= 20 && !title.includes('<') && !title.includes('>')) {
            results.push({
              title: title.substring(0, 150),
              price,
              date: new Date().toISOString().split('T')[0],
              url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`,
              source: 'eBay'
            });
            
            console.log(`✅ eBay broad result: "${title}" - $${price}`);
            break;
          }
        }
      }
    }
  }
  
  return results.slice(0, 10);
}

// Rate limiting with timeout
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
