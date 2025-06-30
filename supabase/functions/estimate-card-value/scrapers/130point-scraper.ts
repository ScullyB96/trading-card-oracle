
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
  console.log('=== FETCHING 130POINT COMPS (REAL DATA ONLY) ===');
  console.log('Search query:', searchQuery);
  
  try {
    return await fetch130PointAPI(searchQuery);
  } catch (error) {
    console.error('130Point fetching failed:', error);
    return {
      results: [],
      error: {
        source: '130Point',
        message: `130Point integration failed: ${error.message}`
      }
    };
  }
}

async function fetch130PointAPI(searchQuery: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  console.log('Calling 130Point API');
  
  const apiUrl = 'https://130point.com/wp-json/soldlistings/search';
  
  // Mimic browser request with proper headers
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://130point.com',
    'Referer': 'https://130point.com/sales/',
    'Cache-Control': 'no-cache'
  };
  
  const payload = {
    search: searchQuery,
    limit: 50,
    offset: 0,
    sortBy: 'date_desc',
    dateRange: 'all' // Get all available data
  };
  
  console.log('130Point payload:', payload);
  
  const response = await rateLimitedFetch(apiUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limited by 130Point API - please try again later');
    }
    if (response.status === 404) {
      throw new Error('130Point API endpoint not found - service may be unavailable');
    }
    throw new Error(`130Point API error: ${response.status} ${response.statusText}`);
  }
  
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Invalid JSON response from 130Point API');
  }
  
  // Parse 130Point response format
  if (!data || (!data.success && !data.results && !Array.isArray(data))) {
    console.log('130Point response format:', Object.keys(data || {}));
    
    // Try different response formats
    let items = null;
    if (data.success && data.results) {
      items = data.results;
    } else if (data.data) {
      items = data.data;
    } else if (Array.isArray(data)) {
      items = data;
    } else if (data.listings) {
      items = data.listings;
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return {
        results: [],
        error: {
          source: '130Point',
          message: 'No auction results found for this search query'
        }
      };
    }
    
    data.results = items;
  }
  
  const results = (data.results || [])
    .map((item: any) => {
      // Handle different possible field names from 130Point API
      const title = item.title || item.card_title || item.name || item.description || 'Unknown Card';
      const price = parseFloat(item.price || item.sale_price || item.final_price || item.winning_bid || '0');
      const date = item.date || item.sale_date || item.end_date || item.auction_date;
      const image = item.image_url || item.thumbnail || item.image || item.photo_url;
      const url = item.url || item.sale_url || item.auction_url || `https://130point.com/sales/?search=${encodeURIComponent(searchQuery)}`;
      
      // Only include items with valid data
      if (!title || price <= 0) {
        return null;
      }
      
      // Normalize date format
      let normalizedDate = new Date().toISOString().split('T')[0];
      if (date) {
        try {
          const parsedDate = new Date(date);
          if (!isNaN(parsedDate.getTime())) {
            normalizedDate = parsedDate.toISOString().split('T')[0];
          }
        } catch (e) {
          console.warn('Date parsing failed for:', date);
        }
      }
      
      return {
        title: title.toString().trim(),
        price: price,
        date: normalizedDate,
        image: image ? image.toString() : undefined,
        url: url.toString(),
        source: '130Point'
      };
    })
    .filter((item: Point130Result | null): item is Point130Result => item !== null);
  
  console.log(`130Point API found ${results.length} real results`);
  
  if (results.length === 0) {
    return {
      results: [],
      error: {
        source: '130Point',
        message: 'No valid auction results found for this search query'
      }
    };
  }
  
  return { results };
}

// Rate limiting for 130Point API
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500; // 1.5 seconds between requests

async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`Rate limiting: waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRequestTime = Date.now();
  return fetch(url, options);
}
