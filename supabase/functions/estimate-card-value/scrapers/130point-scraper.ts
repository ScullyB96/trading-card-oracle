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
}

export async function fetch130PointComps(searchQuery: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  console.log('=== IMPROVED 130POINT SCRAPING ===');
  console.log('Search query:', searchQuery);
  
  try {
    // Try direct web scraping first since API endpoints are uncertain
    const searchUrl = `https://130point.com/sales/?search=${encodeURIComponent(searchQuery)}`;
    console.log('130Point URL:', searchUrl);
    
    const response = await rateLimitedFetchWithTimeout(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CardScraper/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    ScrapingDebugger.logResponse('130Point', response, html);
    
    const results = parse130PointHtml(html, searchUrl);
    
    if (results.length === 0) {
      return {
        results: [],
        error: {
          source: '130Point',
          message: 'No results found in HTML parsing',
          details: {
            htmlLength: html.length,
            hasData: html.includes('sale') || html.includes('auction'),
            queryInHtml: html.toLowerCase().includes(searchQuery.toLowerCase())
          }
        }
      };
    }
    
    console.log(`130Point scraping found ${results.length} valid results`);
    return { results };
    
  } catch (error) {
    console.error('130Point scraping failed:', error);
    return {
      results: [],
      error: {
        source: '130Point',
        message: error.message,
        details: { searchQuery }
      }
    };
  }
}

function parse130PointHtml(html: string, searchUrl: string): Point130Result[] {
  const results: Point130Result[] = [];
  
  // Look for common table or card patterns
  const patterns = [
    /<tr[^>]*>[\s\S]*?<\/tr>/g,
    /<div[^>]*class="[^"]*sale[^"]*"[^>]*>[\s\S]*?<\/div>/g,
    /<div[^>]*class="[^"]*auction[^"]*"[^>]*>[\s\S]*?<\/div>/g,
    /<div[^>]*class="[^"]*listing[^"]*"[^>]*>[\s\S]*?<\/div>/g
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < 30) {
      const itemHtml = match[0];
      
      // Extract title and price with multiple patterns
      const titlePatterns = [
        />([^<]*(?:Prizm|Rookie|Daniels|Card|RC)[^<]*)</i,
        /title="([^"]*(?:Prizm|Rookie|Daniels|Card|RC)[^"]*)"/i,
        /<h[^>]*>([^<]*(?:Prizm|Rookie|Daniels|Card|RC)[^<]*)</i
      ];
      
      const pricePatterns = [
        /\$([0-9,]+\.?[0-9]*)/,
        /Price[^$]*\$([0-9,]+\.?[0-9]*)/i,
        /Sold[^$]*\$([0-9,]+\.?[0-9]*)/i
      ];
      
      let title = '';
      let price = 0;
      
      // Find title
      for (const titlePattern of titlePatterns) {
        const titleMatch = itemHtml.match(titlePattern);
        if (titleMatch && titleMatch[1] && titleMatch[1].trim().length > 5) {
          title = titleMatch[1].trim();
          break;
        }
      }
      
      // Find price
      for (const pricePattern of pricePatterns) {
        const priceMatch = itemHtml.match(pricePattern);
        if (priceMatch && priceMatch[1]) {
          price = parseFloat(priceMatch[1].replace(/,/g, ''));
          if (price > 0) break;
        }
      }
      
      if (title && price > 0 && isValidCard(title, price)) {
        // Extract date if available
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
        
        results.push({
          title,
          price,
          date,
          url: searchUrl,
          source: '130Point'
        });
      }
    }
    
    if (results.length > 0) {
      console.log(`130Point pattern found ${results.length} results`);
      break; // Found results with this pattern
    }
  }
  
  // If no structured results, try simple extraction
  if (results.length === 0) {
    console.log('Trying simple 130Point extraction');
    const simpleResults = parse130PointSimple(html, searchUrl);
    results.push(...simpleResults);
  }
  
  console.log(`130Point parsing found ${results.length} total results`);
  return results;
}

function parse130PointSimple(html: string, searchUrl: string): Point130Result[] {
  const results: Point130Result[] = [];
  
  // Simple approach: find prices and look for nearby titles
  const priceMatches = html.match(/\$[0-9,]+\.?[0-9]*/g) || [];
  const uniquePrices = [...new Set(priceMatches)];
  
  console.log(`Found ${uniquePrices.length} unique prices in 130Point HTML`);
  
  uniquePrices.slice(0, 15).forEach((priceStr, index) => {
    const price = parseFloat(priceStr.replace(/[$,]/g, ''));
    if (price > 5 && price < 5000) {
      // Find the price in HTML and look for context
      const priceIndex = html.indexOf(priceStr);
      if (priceIndex > 0) {
        const contextBefore = html.substring(Math.max(0, priceIndex - 800), priceIndex);
        const contextAfter = html.substring(priceIndex, Math.min(html.length, priceIndex + 400));
        
        // Look for card-related terms in context
        const titlePatterns = [
          /(?:Card|Rookie|Prizm|Daniels|RC|PSA|BGS)[^<>]*(?=<|$)/gi,
          />([^<]*(?:Card|Rookie|Prizm|Daniels|RC)[^<]*)</gi
        ];
        
        let title = '';
        const combinedContext = contextBefore + contextAfter;
        
        for (const pattern of titlePatterns) {
          const matches = combinedContext.match(pattern);
          if (matches && matches.length > 0) {
            // Find the longest meaningful match
            const bestMatch = matches
              .map(m => m.replace(/^>/, '').trim())
              .filter(m => m.length > 10)
              .sort((a, b) => b.length - a.length)[0];
            
            if (bestMatch) {
              title = bestMatch;
              break;
            }
          }
        }
        
        if (!title) {
          title = `130Point Card Listing ${index + 1} - ${priceStr}`;
        }
        
        if (isValidCard(title, price)) {
          results.push({
            title,
            price,
            date: new Date().toISOString().split('T')[0],
            url: searchUrl,
            source: '130Point'
          });
        }
      }
    }
  });
  
  console.log(`Simple 130Point parsing: ${results.length} items`);
  return results;
}

// STRICT VALIDATION FUNCTION
function isValidCard(title: string, price: number): boolean {
  if (!title || title.length < 8) {
    return false;
  }
  
  if (!price || price <= 0 || price > 10000) {
    return false;
  }
  
  // Reject non-card terms
  const titleLower = title.toLowerCase();
  const invalidTerms = [
    'break', 'lot of', 'lots', 'collection', 'bundle', 'mixed',
    'random', 'mystery', 'pack', 'box', 'case', 'supplies'
  ];
  
  for (const term of invalidTerms) {
    if (titleLower.includes(term)) {
      console.log(`Rejecting card with invalid term "${term}": ${title}`);
      return false;
    }
  }
  
  return true;
}

// Rate limiting with timeout
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1200; // 1.2 seconds between requests
const REQUEST_TIMEOUT = 8000; // 8 seconds timeout

async function rateLimitedFetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`130Point rate limiting: waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRequestTime = Date.now();
  
  // Wrap fetch with timeout using Promise.race
  return Promise.race([
    fetch(url, options),
    new Promise<Response>((_, reject) => 
      setTimeout(() => reject(new Error(`130Point request timeout after ${REQUEST_TIMEOUT}ms`)), REQUEST_TIMEOUT)
    )
  ]);
}
