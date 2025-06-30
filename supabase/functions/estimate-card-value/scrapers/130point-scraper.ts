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
}

export async function fetch130PointComps(searchQuery: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  console.log('=== FETCHING 130POINT COMPS (HARDENED WITH TIMEOUTS) ===');
  console.log('Search query:', searchQuery);
  
  try {
    // Try multiple API strategies with strict timeouts
    const strategies = [
      () => fetch130PointAPIv2(searchQuery),
      () => fetch130PointAPIv1(searchQuery),
      () => fetch130PointWebScrape(searchQuery)
    ];
    
    let allResults: Point130Result[] = [];
    const strategyResults: number[] = [];
    
    for (const [index, strategy] of strategies.entries()) {
      try {
        console.log(`Trying 130Point strategy ${index + 1}`);
        const result = await strategy();
        
        strategyResults.push(result.results.length);
        console.log(`130Point strategy ${index + 1} returned ${result.results.length} results`);
        
        if (result.results.length > 0) {
          allResults = allResults.concat(result.results);
          
          // If we have enough results, break early
          if (allResults.length >= 5) {
            console.log(`130Point strategy ${index + 1} provided sufficient results, stopping`);
            break;
          }
        }
        
      } catch (error) {
        console.error(`130Point strategy ${index + 1} failed:`, error);
        strategyResults.push(0);
        continue;
      }
    }
    
    // Log all strategy results
    console.log('130Point strategy results:', {
      'API v2': strategyResults[0] || 0,
      'API v1': strategyResults[1] || 0,
      'Web Scrape': strategyResults[2] || 0,
      'Total Before Dedup': allResults.length
    });
    
    // Deduplicate and sort results
    const deduplicatedResults = deduplicateResults(allResults);
    console.log(`130Point deduplication: ${allResults.length} -> ${deduplicatedResults.length} results`);
    
    // If no results after all strategies, return structured error
    if (deduplicatedResults.length === 0) {
      return {
        results: [],
        error: {
          source: '130Point',
          message: 'No results found for this card'
        }
      };
    }
    
    return { results: deduplicatedResults };
    
  } catch (error) {
    console.error('130Point fetching failed:', error);
    return {
      results: [],
      error: {
        source: '130Point',
        message: 'No results found for this card'
      }
    };
  }
}

async function fetch130PointAPIv2(searchQuery: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  console.log('Attempting 130Point API v2 with 7s timeout');
  
  // Try the soldlistings endpoint with various possible URLs
  const endpoints = [
    'https://130point.com/wp-json/soldlistings/search',
    'https://130point.com/wp-json/wp/v2/soldlistings',
    'https://api.130point.com/soldlistings/search'
  ];
  
  for (const apiUrl of endpoints) {
    try {
      console.log(`Trying 130Point endpoint: ${apiUrl}`);
      
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://130point.com',
        'Referer': 'https://130point.com/sales/',
        'Cache-Control': 'no-cache',
        'X-Requested-With': 'XMLHttpRequest'
      };
      
      const payload = {
        search: searchQuery,
        limit: 100,
        offset: 0,
        sortBy: 'date_desc',
        dateRange: 'all'
      };
      
      console.log('130Point payload:', payload);
      
      const response = await rateLimitedFetchWithTimeout(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });
      
      console.log(`130Point response status: ${response.status}`);
      
      if (response.status === 404) {
        console.log('130Point endpoint not found, trying next endpoint');
        continue;
      }
      
      if (response.status === 429) {
        throw new Error('Rate limited by 130Point API');
      }
      
      if (!response.ok) {
        console.warn(`130Point API error: ${response.status} ${response.statusText}`);
        continue;
      }
      
      let data;
      try {
        const responseText = await response.text();
        console.log(`130Point raw response: ${responseText.substring(0, 200)}...`);
        data = JSON.parse(responseText);
      } catch (error) {
        console.error('Failed to parse 130Point JSON:', error);
        continue;
      }
      
      // Parse the response with strict validation
      const results = parse130PointResponseStrict(data, searchQuery);
      
      if (results.length > 0) {
        console.log(`130Point API v2 found ${results.length} valid results`);
        return { results };
      }
      
    } catch (error) {
      console.error(`130Point endpoint ${apiUrl} failed:`, error);
      continue;
    }
  }
  
  throw new Error('All 130Point API v2 endpoints failed');
}

async function fetch130PointAPIv1(searchQuery: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  console.log('Attempting 130Point API v1 (legacy) with 7s timeout');
  
  // Try legacy API format
  const apiUrl = 'https://130point.com/api/search';
  
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://130point.com/'
  };
  
  const params = new URLSearchParams({
    'q': searchQuery,
    'type': 'sold',
    'limit': '50'
  });
  
  const response = await rateLimitedFetchWithTimeout(apiUrl, {
    method: 'POST',
    headers: headers,
    body: params
  });
  
  if (!response.ok) {
    throw new Error(`130Point API v1 error: ${response.status}`);
  }
  
  const data = await response.json();
  const results = parse130PointResponseStrict(data, searchQuery);
  
  console.log(`130Point API v1 found ${results.length} valid results`);
  return { results };
}

async function fetch130PointWebScrape(searchQuery: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  console.log('Attempting 130Point web scraping fallback with 7s timeout');
  
  const encodedQuery = encodeURIComponent(searchQuery);
  const searchUrl = `https://130point.com/sales/?search=${encodedQuery}`;
  
  console.log('130Point scraping URL:', searchUrl);
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache'
  };
  
  const response = await rateLimitedFetchWithTimeout(searchUrl, { headers });
  
  if (!response.ok) {
    throw new Error(`130Point scraping failed: ${response.status}`);
  }
  
  const html = await response.text();
  const results = parse130PointHTMLStrict(html, searchUrl);
  
  console.log(`130Point web scraping found ${results.length} valid results`);
  return { results };
}

function parse130PointResponseStrict(data: any, searchQuery: string): Point130Result[] {
  console.log('Parsing 130Point API response with strict validation');
  
  let items: any[] = [];
  
  // Handle different response formats
  if (data.success && data.results) {
    items = data.results;
  } else if (data.data) {
    items = Array.isArray(data.data) ? data.data : [data.data];
  } else if (Array.isArray(data)) {
    items = data;
  } else if (data.listings) {
    items = data.listings;
  } else if (data.sales) {
    items = data.sales;
  } else if (data.auctions) {
    items = data.auctions;
  }
  
  console.log(`Found ${items.length} items in 130Point response`);
  
  const results = items
    .map((item: any) => {
      try {
        // Handle multiple possible field names
        const title = item.title || item.card_title || item.name || item.description || item.card_name || '';
        const price = parseFloat(item.price || item.sale_price || item.final_price || item.winning_bid || item.hammer_price || '0');
        const date = item.date || item.sale_date || item.end_date || item.auction_date || item.sold_date;
        const image = item.image_url || item.thumbnail || item.image || item.photo_url || item.img;
        const url = item.url || item.sale_url || item.auction_url || item.link;
        
        // STRICT VALIDATION
        if (!isValidCard(title, price)) {
          return null;
        }
        
        // Normalize date
        let normalizedDate = new Date().toISOString().split('T')[0];
        if (date) {
          try {
            const parsedDate = new Date(date);
            if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > 2020) {
              normalizedDate = parsedDate.toISOString().split('T')[0];
            }
          } catch (e) {
            // Use current date if parsing fails
          }
        }
        
        // Use real 130Point search URL if no specific URL provided
        const finalUrl = url && url.toString().trim() 
          ? url.toString() 
          : `https://130point.com/sales/?search=${encodeURIComponent(searchQuery)}`;
        
        return {
          title: title.toString().trim(),
          price: Math.round(price * 100) / 100,
          date: normalizedDate,
          image: image ? image.toString() : undefined,
          url: finalUrl,
          source: '130Point'
        };
      } catch (error) {
        console.error('Error parsing 130Point item:', error, item);
        return null;
      }
    })
    .filter((item: Point130Result | null): item is Point130Result => item !== null);
  
  console.log(`Parsed ${results.length} valid 130Point results after strict validation`);
  return results;
}

function parse130PointHTMLStrict(html: string, searchUrl: string): Point130Result[] {
  const results: Point130Result[] = [];
  
  try {
    console.log('Parsing 130Point HTML with strict validation');
    
    // Look for common patterns in 130Point HTML
    const itemPatterns = [
      /<div[^>]*class="[^"]*sale-item[^"]*"[^>]*>[\s\S]*?<\/div>/g,
      /<tr[^>]*class="[^"]*sale-row[^"]*"[^>]*>[\s\S]*?<\/tr>/g,
      /<div[^>]*class="[^"]*auction[^"]*"[^>]*>[\s\S]*?<\/div>/g
    ];
    
    for (const pattern of itemPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null && results.length < 50) {
        const itemHtml = match[0];
        
        // Extract basic information
        const titleMatch = itemHtml.match(/<h[^>]*>([^<]+)</i) || 
                          itemHtml.match(/title="([^"]+)"/i) ||
                          itemHtml.match(/>([^<]*(?:rookie|prizm|daniels)[^<]*)</i);
        
        const priceMatch = itemHtml.match(/\$([0-9,]+\.?[0-9]*)/);
        
        if (titleMatch && priceMatch) {
          const title = titleMatch[1].trim();
          const price = parseFloat(priceMatch[1].replace(',', ''));
          
          // STRICT VALIDATION for HTML parsing too
          if (isValidCard(title, price)) {
            results.push({
              title: title,
              price: price,
              date: new Date().toISOString().split('T')[0],
              url: searchUrl,
              source: '130Point'
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('130Point HTML parsing error:', error);
  }
  
  console.log(`130Point HTML parsing found ${results.length} valid results after strict validation`);
  return results;
}

// STRICT VALIDATION FUNCTION
function isValidCard(title: string, price: number): boolean {
  if (!title || title.length < 10) {
    return false;
  }
  
  if (!price || price <= 0) {
    return false;
  }
  
  // Reject non-card terms
  const titleLower = title.toLowerCase();
  const invalidTerms = [
    'break', 'lot', 'lots', 'collection', 'bundle', 'mixed',
    'random', 'mystery', 'pack', 'box', 'case', 'supplies',
    'equipment', 'holder', 'sleeve', 'binder', 'album'
  ];
  
  for (const term of invalidTerms) {
    if (titleLower.includes(term)) {
      console.log(`Rejecting card with invalid term "${term}": ${title}`);
      return false;
    }
  }
  
  return true;
}

// DEDUPLICATION FUNCTION
function deduplicateResults(results: Point130Result[]): Point130Result[] {
  const seen = new Map<string, Point130Result>();
  
  for (const result of results) {
    // Create deduplication key based on normalized title + price
    const normalizedTitle = result.title.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const key = `${normalizedTitle}_${result.price}`;
    
    // Keep the most recent result for duplicates
    const existing = seen.get(key);
    if (!existing || new Date(result.date) > new Date(existing.date)) {
      seen.set(key, result);
    }
  }
  
  // Convert back to array and sort by date DESC (most recent first)
  return Array.from(seen.values())
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// Rate limiting with 7-second timeout
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1200; // 1.2 seconds between requests
const REQUEST_TIMEOUT = 7000; // 7 seconds timeout

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

// Legacy function for backward compatibility (without timeout)
async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  return rateLimitedFetchWithTimeout(url, options);
}
