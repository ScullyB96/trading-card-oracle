
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
  
  // Construct eBay sold listings search URL
  const encodedQuery = encodeURIComponent(searchQuery);
  const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&_sacat=0&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=50`;
  
  console.log('Scraping URL:', searchUrl);
  
  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      throw new Error(`eBay scraping failed: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Parse HTML to extract sold listings
    const results = parseEbayHTML(html, searchUrl);
    
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
    return { results: results.slice(0, 30) }; // Limit to top 30
    
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

function parseEbayHTML(html: string, searchUrl: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  try {
    // Look for sold listing patterns in eBay HTML
    // This is a simplified parser - in production you'd want more robust parsing
    const itemRegex = /<div[^>]*class="[^"]*s-item[^"]*"[^>]*>[\s\S]*?<\/div>/g;
    const titleRegex = /<h3[^>]*class="[^"]*s-item__title[^"]*"[^>]*>(?:<[^>]*>)*([^<]+)/;
    const priceRegex = /<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>(?:<[^>]*>)*\$([0-9,]+\.?[0-9]*)/;
    const dateRegex = /<span[^>]*class="[^"]*s-item__endedDate[^"]*"[^>]*>(?:<[^>]*>)*([^<]+)/;
    const linkRegex = /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*href="([^"]+)"/;
    const imageRegex = /<img[^>]*src="([^"]*)"[^>]*class="[^"]*s-item__image[^"]*"/;
    
    let itemMatch;
    while ((itemMatch = itemRegex.exec(html)) !== null && results.length < 50) {
      const itemHtml = itemMatch[0];
      
      const titleMatch = titleRegex.exec(itemHtml);
      const priceMatch = priceRegex.exec(itemHtml);
      const dateMatch = dateRegex.exec(itemHtml);
      const linkMatch = linkRegex.exec(itemHtml);
      const imageMatch = imageRegex.exec(itemHtml);
      
      if (titleMatch && priceMatch) {
        const price = parseFloat(priceMatch[1].replace(',', ''));
        const dateStr = dateMatch ? dateMatch[1].trim() : '';
        
        // Parse date - eBay uses formats like "Sold Jun 15, 2024"
        let parsedDate = new Date().toISOString().split('T')[0];
        if (dateStr && dateStr.includes('Sold')) {
          try {
            const dateOnly = dateStr.replace('Sold ', '').trim();
            const parsed = new Date(dateOnly);
            if (!isNaN(parsed.getTime())) {
              parsedDate = parsed.toISOString().split('T')[0];
            }
          } catch (e) {
            // Use current date if parsing fails
          }
        }
        
        results.push({
          title: titleMatch[1].trim(),
          price: price,
          date: parsedDate,
          url: linkMatch ? linkMatch[1] : searchUrl,
          image: imageMatch ? imageMatch[1] : undefined,
          source: 'eBay'
        });
      }
    }
    
  } catch (error) {
    console.error('HTML parsing error:', error);
  }
  
  return results.filter(r => r.price > 0); // Only return items with valid prices
}

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests

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
