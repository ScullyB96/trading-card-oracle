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

export async function fetchEbayComps(searchQuery: string): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('=== FETCHING EBAY COMPS (REAL DATA ONLY) ===');
  console.log('Search query:', searchQuery);
  
  try {
    // First attempt: eBay Browse API if key is available
    const ebayApiKey = Deno.env.get('EBAY_API_KEY');
    
    if (ebayApiKey) {
      const apiResult = await fetchEbayAPI(searchQuery, ebayApiKey);
      if (apiResult.results.length > 0) {
        return apiResult;
      }
      console.log('eBay API returned no results, trying scraping fallback');
    }
    
    // Fallback: HTML scraping of sold listings
    return await scrapeEbaySoldListings(searchQuery);
    
  } catch (error) {
    console.error('eBay fetching failed:', error);
    return {
      results: [],
      error: {
        source: 'eBay',
        message: `eBay integration failed: ${error.message}`
      }
    };
  }
}

async function fetchEbayAPI(searchQuery: string, apiKey: string): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('Using eBay Browse API');
  
  const endpoint = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
  };
  
  // Search for SOLD listings only
  const params = new URLSearchParams({
    q: searchQuery,
    filter: 'conditionIds:{3000|3001|3002|3003|3004|3005},buyingOptions:{AUCTION|FIXED_PRICE},deliveryCountry:US,itemLocationCountry:US,itemEndDate:[2024-01-01T00:00:00.000Z..],soldItemsOnly:true',
    sort: 'endTimeNewest',
    limit: '50',
    offset: '0'
  });
  
  const response = await fetch(`${endpoint}?${params}`, { headers });
  
  if (!response.ok) {
    throw new Error(`eBay API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  if (!data.itemSummaries || data.itemSummaries.length === 0) {
    return { results: [] };
  }
  
  const results = data.itemSummaries.map((item: any) => ({
    title: item.title,
    price: parseFloat(item.price?.value || '0'),
    date: item.itemEndDate ? new Date(item.itemEndDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    image: item.image?.imageUrl,
    url: item.itemWebUrl,
    source: 'eBay'
  })).filter((item: EbayResult) => item.price > 0);
  
  console.log(`eBay API found ${results.length} real results`);
  return { results };
}

async function scrapeEbaySoldListings(searchQuery: string): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('Scraping eBay sold listings');
  
  // Construct eBay sold listings search URL with enhanced filters
  const encodedQuery = encodeURIComponent(searchQuery);
  const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&_sacat=0&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=100&rt=nc&LH_ItemCondition=3000%7C3001%7C3002%7C3003%7C3004%7C3005`;
  
  console.log('Enhanced scraping URL:', searchUrl);
  
  try {
    const response = await rateLimitedFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    
    if (!response.ok) {
      throw new Error(`eBay scraping failed: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Parse HTML to extract sold listings with enhanced matching
    const results = parseEbayHTMLEnhanced(html, searchUrl, searchQuery);
    
    if (results.length === 0) {
      return {
        results: [],
        error: {
          source: 'eBay',
          message: 'No sold listings found for this search query'
        }
      };
    }
    
    console.log(`eBay scraping found ${results.length} real results`);
    return { results: results.slice(0, 50) }; // Limit to top 50
    
  } catch (error) {
    console.error('eBay scraping error:', error);
    return {
      results: [],
      error: {
        source: 'eBay',
        message: `eBay scraping failed: ${error.message}`
      }
    };
  }
}

function parseEbayHTMLEnhanced(html: string, searchUrl: string, originalQuery: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  try {
    console.log('Parsing eBay HTML with enhanced matching logic');
    
    // Enhanced regex patterns for eBay's current structure
    const itemPatterns = [
      // Main item container patterns
      /<div[^>]*class="[^"]*s-item[^"]*"[^>]*>[\s\S]*?<\/div>/g,
      /<article[^>]*class="[^"]*srgl[^"]*"[^>]*>[\s\S]*?<\/article>/g,
      /<div[^>]*data-view="[^"]*mi[^"]*"[^>]*>[\s\S]*?<\/div>/g
    ];
    
    // Try each pattern to find items
    for (const itemPattern of itemPatterns) {
      let itemMatch;
      while ((itemMatch = itemPattern.exec(html)) !== null && results.length < 100) {
        const itemHtml = itemMatch[0];
        const parsedItem = parseIndividualItem(itemHtml, searchUrl, originalQuery);
        
        if (parsedItem) {
          results.push(parsedItem);
        }
      }
      
      // If we found items with this pattern, don't try others
      if (results.length > 0) {
        break;
      }
    }
    
    // Sort by relevance score and date
    const sortedResults = results
      .filter(r => r.price > 0)
      .sort((a, b) => {
        const aScore = calculateItemRelevance(a.title, originalQuery);
        const bScore = calculateItemRelevance(b.title, originalQuery);
        
        if (Math.abs(aScore - bScore) > 0.1) {
          return bScore - aScore; // Higher score first
        }
        
        // If relevance is similar, sort by date (newer first)
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
    
    console.log(`Parsed and sorted ${sortedResults.length} items by relevance`);
    return sortedResults;
    
  } catch (error) {
    console.error('HTML parsing error:', error);
    return [];
  }
}

function parseIndividualItem(itemHtml: string, searchUrl: string, originalQuery: string): EbayResult | null {
  try {
    // Enhanced regex patterns for different eBay layouts
    const titlePatterns = [
      /<h3[^>]*class="[^"]*s-item__title[^"]*"[^>]*>(?:<[^>]*>)*([^<]+)/,
      /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*>(?:<[^>]*>)*([^<]+)/,
      /<span[^>]*role="heading"[^>]*>([^<]+)/
    ];
    
    const pricePatterns = [
      /<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>(?:<[^>]*>)*\$([0-9,]+\.?[0-9]*)/,
      /<span[^>]*class="[^"]*notranslate[^"]*"[^>]*>\$([0-9,]+\.?[0-9]*)/,
      /<span[^>]*aria-label="[^"]*\$([0-9,]+\.?[0-9]*)[^"]*"/
    ];
    
    const datePatterns = [
      /<span[^>]*class="[^"]*s-item__endedDate[^"]*"[^>]*>(?:<[^>]*>)*Sold\s+([^<]+)/,
      /<span[^>]*class="[^"]*s-item__subtitle[^"]*"[^>]*>(?:<[^>]*>)*Sold\s+([^<]+)/
    ];
    
    const linkPatterns = [
      /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*href="([^"]+)"/,
      /<a[^>]*href="([^"]*ebay\.com[^"]*)"[^>]*class="[^"]*s-item/
    ];
    
    const imagePatterns = [
      /<img[^>]*src="([^"]*)"[^>]*class="[^"]*s-item__image[^"]*"/,
      /<img[^>]*class="[^"]*s-item__image[^"]*"[^>]*src="([^"]*)"/
    ];
    
    // Extract data using patterns
    let title = '', price = 0, dateStr = '', url = '', imageUrl = '';
    
    // Try title patterns
    for (const pattern of titlePatterns) {
      const match = pattern.exec(itemHtml);
      if (match) {
        title = match[1].trim();
        break;
      }
    }
    
    // Try price patterns  
    for (const pattern of pricePatterns) {
      const match = pattern.exec(itemHtml);
      if (match) {
        price = parseFloat(match[1].replace(',', ''));
        break;
      }
    }
    
    // Try date patterns
    for (const pattern of datePatterns) {
      const match = pattern.exec(itemHtml);
      if (match) {
        dateStr = match[1].trim();
        break;
      }
    }
    
    // Try link patterns
    for (const pattern of linkPatterns) {
      const match = pattern.exec(itemHtml);
      if (match) {
        url = match[1];
        break;
      }
    }
    
    // Try image patterns
    for (const pattern of imagePatterns) {
      const match = pattern.exec(itemHtml);
      if (match) {
        imageUrl = match[1];
        break;
      }
    }
    
    // Validate we have minimum required data
    if (!title || price <= 0) {
      return null;
    }
    
    // Parse and validate date
    let parsedDate = new Date().toISOString().split('T')[0];
    if (dateStr) {
      try {
        // Handle various eBay date formats
        const cleanDate = dateStr
          .replace(/^(Sold\s+)/, '')
          .replace(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/, (match, month, day, year) => {
            const fullYear = year.length === 2 ? `20${year}` : year;
            return `${month}/${day}/${fullYear}`;
          });
        
        const parsed = new Date(cleanDate);
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) {
          parsedDate = parsed.toISOString().split('T')[0];
        }
      } catch (e) {
        // Use current date if parsing fails
        console.log('Date parsing failed for:', dateStr);
      }
    }
    
    // Calculate relevance score for this item
    const relevanceScore = calculateItemRelevance(title, originalQuery);
    
    return {
      title: title,
      price: price,
      date: parsedDate,
      url: url || searchUrl,
      image: imageUrl || undefined,
      source: 'eBay'
    };
    
  } catch (error) {
    console.error('Error parsing individual item:', error);
    return null;
  }
}

function calculateItemRelevance(title: string, originalQuery: string): number {
  const titleLower = title.toLowerCase();
  const queryLower = originalQuery.toLowerCase();
  
  let score = 0;
  
  // Extract key terms from query
  const queryTerms = queryLower
    .split(/\s+/)
    .filter(term => term.length > 2)
    .filter(term => !['the', 'and', 'for', 'card', 'trading'].includes(term));
  
  // Check for exact query substring match
  if (titleLower.includes(queryLower)) {
    score += 1.0;
  }
  
  // Check individual term matches
  const matchedTerms = queryTerms.filter(term => titleLower.includes(term));
  const termMatchRatio = matchedTerms.length / queryTerms.length;
  score += termMatchRatio * 0.8;
  
  // Bonus for specific card indicators
  const cardIndicators = ['#', 'rc', 'rookie', 'prizm', 'chrome', 'refractor', 'parallel'];
  const indicatorMatches = cardIndicators.filter(indicator => titleLower.includes(indicator));
  score += indicatorMatches.length * 0.1;
  
  // Bonus for recent cards (2020+)
  const yearMatch = title.match(/20(2[0-9])/);
  if (yearMatch) {
    const year = parseInt(yearMatch[0]);
    if (year >= 2020) {
      score += 0.2;
    }
  }
  
  return Math.min(score, 2.0); // Cap at 2.0
}

// Rate limiting with better timing
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000; // 3 seconds between requests

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
