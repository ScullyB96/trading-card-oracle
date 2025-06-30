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

// Rate limiting constants
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 800; // Reduced for faster processing
const REQUEST_TIMEOUT = 8000;

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
      setTimeout(() => reject(new Error(`130Point request timeout after ${REQUEST_TIMEOUT}ms`)), REQUEST_TIMEOUT)
    )
  ]);
}

export async function fetch130PointComps(searchQuery: string): Promise<{ results: Point130Result[], error?: Point130Error }> {
  console.log('=== REVISED 130POINT SCRAPING ===');
  console.log('Search query:', searchQuery);
  
  // Try HTML scraping with multiple URL formats
  const searchUrls = [
    `https://130point.com/sales/?search=${encodeURIComponent(searchQuery)}`,
    `https://130point.com/db/list.php?search=${encodeURIComponent(searchQuery)}`,
    `https://www.130point.com/sales/?q=${encodeURIComponent(searchQuery)}`
  ];
  
  for (const searchUrl of searchUrls) {
    console.log(`Trying 130Point URL: ${searchUrl}`);
    
    try {
      const response = await rateLimitedFetchWithTimeout(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Referer': 'https://130point.com'
        }
      });
      
      if (!response.ok) {
        console.log(`130Point URL failed: ${response.status}`);
        continue;
      }
      
      const html = await response.text();
      console.log(`130Point HTML length: ${html.length}`);
      
      // Check if we got actual content (not just error page)
      if (html.includes('captcha') || html.includes('blocked') || html.length < 5000) {
        console.log('130Point: Got blocked or minimal content');
        continue;
      }
      
      const results = parse130PointFlexible(html, searchUrl, searchQuery);
      
      if (results.length > 0) {
        console.log(`✅ 130Point success: ${results.length} results from ${searchUrl}`);
        return { results };
      }
      
    } catch (error) {
      console.log(`130Point URL error: ${error.message}`);
      continue;
    }
  }
  
  // If all URLs failed, return structured error
  return {
    results: [],
    error: {
      source: '130Point',
      message: 'Unable to access 130Point search results',
      details: {
        searchQuery,
        urlsTried: searchUrls.length,
        possibleCause: 'Site blocking or structure change'
      }
    }
  };
}

function parse130PointFlexible(html: string, searchUrl: string, originalQuery: string): Point130Result[] {
  console.log('🔍 Parsing 130Point HTML with flexible approach...');
  
  const results: Point130Result[] = [];
  
  // Strategy 1: Look for table rows (common 130Point structure)
  const tableRowPattern = /<tr[^>]*>(.*?)<\/tr>/gsi;
  let match;
  
  while ((match = tableRowPattern.exec(html)) !== null && results.length < 20) {
    const rowHtml = match[1];
    const parsed = parseTableRow(rowHtml, searchUrl);
    if (parsed && isValidCard(parsed.title, parsed.price, originalQuery)) {
      results.push(parsed);
      console.log(`✅ Table row result: "${parsed.title}" - $${parsed.price}`);
    }
  }
  
  // Strategy 2: Look for div-based listings
  if (results.length < 5) {
    const divPatterns = [
      /<div[^>]*class="[^"]*(?:result|sale|card|listing)[^"]*"[^>]*>(.*?)<\/div>/gsi,
      /<div[^>]*>(.*?\$[0-9,]+\.?\d*.*?)<\/div>/gsi
    ];
    
    for (const pattern of divPatterns) {
      let divMatch;
      while ((divMatch = pattern.exec(html)) !== null && results.length < 20) {
        const divHtml = divMatch[1];
        const parsed = parseGenericListing(divHtml, searchUrl);
        if (parsed && isValidCard(parsed.title, parsed.price, originalQuery)) {
          results.push(parsed);
          console.log(`✅ Div result: "${parsed.title}" - $${parsed.price}`);
        }
      }
    }
  }
  
  // Strategy 3: Broad price/title extraction
  if (results.length < 3) {
    const broadResults = parseBroadContent(html, searchUrl, originalQuery);
    results.push(...broadResults);
  }
  
  // Deduplicate and sort
  const deduped = deduplicateBySignature(results);
  console.log(`✅ 130Point parsing: ${results.length} raw → ${deduped.length} final`);
  
  return deduped.slice(0, 15);
}

function parseTableRow(rowHtml: string, fallbackUrl: string): Point130Result | null {
  // Extract price - try multiple patterns
  const pricePatterns = [
    /\$([0-9,]+\.?\d*)/,
    /price[^>]*>.*?([0-9,]+\.?\d*)/i,
    /([0-9,]+\.?\d*)\s*USD/i
  ];
  
  let price = 0;
  for (const pattern of pricePatterns) {
    const match = rowHtml.match(pattern);
    if (match) {
      price = parseFloat(match[1].replace(/[$,]/g, ''));
      if (price > 0) break;
    }
  }
  
  if (price <= 0 || price > 10000) return null;
  
  // Extract title - try multiple patterns
  const titlePatterns = [
    /<td[^>]*>([^<]{15,200})</gi,
    />([^<]*(?:card|rookie|rc|prizm|panini|topps|upper deck)[^<]*)</gi,
    /title="([^"]{15,200})"/gi,
    /<a[^>]*>([^<]{15,200})</gi
  ];
  
  let title = '';
  for (const pattern of titlePatterns) {
    const matches = [...rowHtml.matchAll(pattern)];
    for (const match of matches) {
      const t = match[1].trim();
      if (t.length >= 15 && !t.includes('http') && !t.includes('www')) {
        title = t;
        break;
      }
    }
    if (title) break;
  }
  
  if (!title) return null;
  
  // Extract date
  const dateMatch = rowHtml.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})|(\d{4}-\d{2}-\d{2})/);
  let date = new Date().toISOString().split('T')[0];
  
  if (dateMatch) {
    try {
      const parsedDate = new Date(dateMatch[0]);
      if (!isNaN(parsedDate.getTime())) {
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
    url: fallbackUrl,
    source: '130Point'
  };
}

function parseGenericListing(listingHtml: string, fallbackUrl: string): Point130Result | null {
  const priceMatch = listingHtml.match(/\$([0-9,]+\.?\d*)/);
  if (!priceMatch) return null;
  
  const price = parseFloat(priceMatch[1].replace(/[$,]/g, ''));
  if (price <= 0 || price > 10000) return null;
  
  // Find any text that looks like a title
  const textMatches = [...listingHtml.matchAll(/>([^<]{15,150})</g)];
  
  for (const match of textMatches) {
    const text = match[1].trim();
    if (text.length >= 15 && !text.includes('$') && !text.includes('http')) {
      return {
        title: text,
        price,
        date: new Date().toISOString().split('T')[0],
        url: fallbackUrl,
        source: '130Point'
      };
    }
  }
  
  return null;
}

function parseBroadContent(html: string, searchUrl: string, query: string): Point130Result[] {
  const results: Point130Result[] = [];
  
  // Find all prices in the document
  const priceMatches = [...html.matchAll(/\$([0-9,]+\.?\d*)/g)];
  
  for (const priceMatch of priceMatches.slice(0, 20)) {
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    
    if (price > 5 && price < 2000) {
      const pricePos = priceMatch.index!;
      
      // Look for text around the price
      const start = Math.max(0, pricePos - 500);
      const end = Math.min(html.length, pricePos + 500);
      const context = html.substring(start, end);
      
      // Find potential titles in the context
      const titleCandidates = [...context.matchAll(/>([^<]{20,100})</g)];
      
      for (const candidate of titleCandidates) {
        const title = candidate[1].trim();
        
        if (title.length >= 20 && 
            !title.includes('$') && 
            !title.includes('http') &&
            !title.includes('©') &&
            (title.toLowerCase().includes('card') || 
             title.toLowerCase().includes('rookie') ||
             title.toLowerCase().includes(query.toLowerCase().split(' ')[0]))) {
          
          results.push({
            title,
            price,
            date: new Date().toISOString().split('T')[0],
            url: searchUrl,
            source: '130Point'
          });
          
          console.log(`✅ Broad 130Point: "${title}" - $${price}`);
          break;
        }
      }
    }
  }
  
  return results.slice(0, 8);
}

function isValidCard(title: string, price: number, originalQuery: string): boolean {
  if (!title || title.length < 10 || price <= 0 || price > 8000) {
    return false;
  }
  
  // Less restrictive validation
  const titleLower = title.toLowerCase();
  
  // Skip obvious non-cards
  const invalidTerms = ['break', 'lot of', 'collection', 'box', 'pack'];
  for (const term of invalidTerms) {
    if (titleLower.includes(term)) {
      return false;
    }
  }
  
  // Accept if it looks card-related or matches query
  const cardTerms = ['card', 'rookie', 'rc', 'prizm', 'panini', 'topps'];
  const hasCardTerm = cardTerms.some(term => titleLower.includes(term));
  
  const queryWords = originalQuery.toLowerCase().split(' ');
  const hasQueryMatch = queryWords.some(word => 
    word.length > 3 && titleLower.includes(word)
  );
  
  return hasCardTerm || hasQueryMatch || title.length >= 25;
}

function deduplicateBySignature(results: Point130Result[]): Point130Result[] {
  const seen = new Map<string, Point130Result>();
  
  for (const result of results) {
    const signature = `${result.title.toLowerCase().replace(/[^\w]/g, '')}_${result.price}`;
    
    const existing = seen.get(signature);
    if (!existing || new Date(result.date) > new Date(existing.date)) {
      seen.set(signature, result);
    }
  }
  
  return Array.from(seen.values())
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
