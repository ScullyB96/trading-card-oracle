
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
  console.log('=== FETCHING EBAY COMPS (OPTIMIZED FOR KNOWN SALES) ===');
  console.log('Search query:', searchQuery);
  
  try {
    // First attempt: eBay Browse API if key is available
    const ebayApiKey = Deno.env.get('EBAY_API_KEY');
    
    if (ebayApiKey) {
      console.log('Attempting eBay Browse API');
      const apiResult = await fetchEbayAPI(searchQuery, ebayApiKey);
      if (apiResult.results.length > 0) {
        console.log(`eBay API returned ${apiResult.results.length} results`);
        return apiResult;
      }
      console.log('eBay API returned no results, trying scraping fallback');
    }
    
    // Fallback: Enhanced HTML scraping with multiple strategies
    return await scrapeEbaySoldListingsEnhanced(searchQuery);
    
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

async function scrapeEbaySoldListingsEnhanced(searchQuery: string): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('=== ENHANCED EBAY SCRAPING FOR KNOWN SALES ===');
  
  // Build multiple search variations for the same query
  const searchVariations = buildEbaySearchVariations(searchQuery);
  console.log('eBay search variations:', searchVariations);
  
  let allResults: EbayResult[] = [];
  let lastError: Error | null = null;
  
  // Try each search variation until we find results
  for (const variation of searchVariations) {
    try {
      console.log(`Trying eBay search variation: "${variation}"`);
      
      // Construct eBay sold listings URL with optimal filters
      const encodedQuery = encodeURIComponent(variation);
      const searchUrl = buildOptimalEbayUrl(encodedQuery);
      
      console.log('eBay scraping URL:', searchUrl);
      
      const response = await rateLimitedFetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
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
        console.warn(`eBay HTTP ${response.status} for variation: "${variation}"`);
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        continue;
      }
      
      const html = await response.text();
      console.log(`eBay HTML received: ${html.length} characters`);
      
      // Enhanced parsing with multiple strategies
      const results = parseEbayHTMLMultiStrategy(html, searchUrl, variation);
      
      if (results.length > 0) {
        console.log(`eBay variation "${variation}" found ${results.length} results`);
        allResults = allResults.concat(results);
        
        // If we found good results with this variation, we can try more or stop
        if (results.length >= 5) {
          break;
        }
      }
      
    } catch (error) {
      console.error(`eBay scraping error for variation "${variation}":`, error);
      lastError = error;
      continue;
    }
  }
  
  // Remove duplicates and sort by relevance
  const uniqueResults = deduplicateEbayResults(allResults, searchQuery);
  
  if (uniqueResults.length === 0) {
    return {
      results: [],
      error: {
        source: 'eBay',
        message: lastError ? 
          `No sold listings found. Last error: ${lastError.message}` : 
          'No sold listings found for any search variation'
      }
    };
  }
  
  console.log(`eBay scraping final results: ${uniqueResults.length} unique listings`);
  return { results: uniqueResults.slice(0, 50) }; // Return top 50
}

function buildEbaySearchVariations(originalQuery: string): string[] {
  const variations: string[] = [];
  
  // Start with the original query
  variations.push(originalQuery);
  
  // Parse out key components for variations
  const queryLower = originalQuery.toLowerCase();
  
  // Extract components from common patterns
  const yearMatch = originalQuery.match(/\b(20\d{2})\b/);
  const playerMatch = originalQuery.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/);
  const cardNumberMatch = originalQuery.match(/#?(\d+)/);
  
  const year = yearMatch?.[1];
  const player = playerMatch?.[1];
  const cardNumber = cardNumberMatch?.[1];
  
  console.log('Extracted components:', { year, player, cardNumber });
  
  // If we have Prizm Silver, try variations
  if (queryLower.includes('silver prizm') || queryLower.includes('prizm silver')) {
    variations.push(originalQuery.replace(/silver\s*prizm|prizm\s*silver/gi, 'Prizm Silver'));
    variations.push(originalQuery.replace(/silver\s*prizm|prizm\s*silver/gi, 'Silver Prizm'));
    
    // Also try without "Silver" for broader matches
    const withoutSilver = originalQuery.replace(/\bsilver\s*/gi, '').replace(/\s+/g, ' ').trim();
    if (withoutSilver !== originalQuery) {
      variations.push(withoutSilver);
    }
  }
  
  // If we have RC, try "Rookie" variation
  if (queryLower.includes(' rc')) {
    variations.push(originalQuery.replace(/\brc\b/gi, 'Rookie'));
    variations.push(originalQuery.replace(/\brc\b/gi, 'Rookie Card'));
  }
  
  // Try without parentheses
  if (originalQuery.includes('(') && originalQuery.includes(')')) {
    const withoutParens = originalQuery.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    if (withoutParens !== originalQuery) {
      variations.push(withoutParens);
    }
  }
  
  // Build component-based variations if we have the key parts
  if (year && player) {
    if (cardNumber) {
      variations.push(`${year} ${player} #${cardNumber} Prizm`);
      variations.push(`${player} ${year} Prizm #${cardNumber}`);
    }
    variations.push(`${year} ${player} Prizm Rookie`);
    variations.push(`${player} ${year} RC`);
  }
  
  // Remove duplicates and empty variations
  const uniqueVariations = [...new Set(variations)]
    .filter(v => v.trim().length > 5)
    .slice(0, 6); // Limit to 6 variations to avoid too many requests
  
  console.log(`Built ${uniqueVariations.length} eBay search variations`);
  return uniqueVariations;
}

function buildOptimalEbayUrl(encodedQuery: string): string {
  // Optimal eBay URL for sold listings with all necessary filters
  const baseUrl = 'https://www.ebay.com/sch/i.html';
  const params = new URLSearchParams({
    '_nkw': decodeURIComponent(encodedQuery),
    '_sacat': '0', // All categories
    'LH_Sold': '1', // Sold listings only
    'LH_Complete': '1', // Completed listings only
    '_sop': '13', // Sort by newest first
    '_ipg': '200', // Items per page (max)
    'rt': 'nc', // No cache
    'LH_ItemCondition': '3000|3001|3002|3003|3004|3005', // Used conditions
    '_fsrp': '1' // Free shipping
  });
  
  return `${baseUrl}?${params.toString()}`;
}

function parseEbayHTMLMultiStrategy(html: string, searchUrl: string, originalQuery: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  try {
    console.log('Parsing eBay HTML with multiple strategies');
    
    // Strategy 1: Modern eBay layout (s-item classes)
    const modernResults = parseModernEbayLayout(html, searchUrl, originalQuery);
    results.push(...modernResults);
    
    // Strategy 2: Legacy eBay layout patterns
    if (results.length < 5) {
      const legacyResults = parseLegacyEbayLayout(html, searchUrl, originalQuery);
      results.push(...legacyResults);
    }
    
    // Strategy 3: JSON embedded data extraction
    if (results.length < 5) {
      const jsonResults = parseEbayJSONData(html, searchUrl, originalQuery);
      results.push(...jsonResults);
    }
    
    console.log(`HTML parsing strategies found ${results.length} total items`);
    
    // Filter and validate results
    const validResults = results
      .filter(r => r.title && r.price > 0 && r.title.length > 10)
      .map(r => ({
        ...r,
        title: r.title.replace(/\s+/g, ' ').trim()
      }));
    
    console.log(`Filtered to ${validResults.length} valid results`);
    return validResults;
    
  } catch (error) {
    console.error('HTML parsing error:', error);
    return [];
  }
}

function parseModernEbayLayout(html: string, searchUrl: string, originalQuery: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  // Modern eBay uses s-item classes
  const itemPattern = /<div[^>]*class="[^"]*s-item[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*s-item[^"]*"|$)/g;
  
  let itemMatch;
  let itemCount = 0;
  
  while ((itemMatch = itemPattern.exec(html)) !== null && itemCount < 100) {
    const itemHtml = itemMatch[0];
    itemCount++;
    
    try {
      // Extract title
      const titlePatterns = [
        /<h3[^>]*class="[^"]*s-item__title[^"]*"[^>]*>(?:<[^>]*>)*([^<]+)/,
        /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*[^>]*>(?:<[^>]*>)*([^<]+)/,
        /<span[^>]*role="heading"[^>]*>([^<]+)/
      ];
      
      let title = '';
      for (const pattern of titlePatterns) {
        const match = pattern.exec(itemHtml);
        if (match && match[1] && match[1].trim() !== 'New Listing') {
          title = match[1].trim();
          break;
        }
      }
      
      if (!title) continue;
      
      // Extract price
      const pricePatterns = [
        /<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>(?:<[^>]*>)*\$([0-9,]+\.?[0-9]*)/,
        /<span[^>]*class="[^"]*notranslate[^"]*"[^>]*>\$([0-9,]+\.?[0-9]*)/,
        /\$([0-9,]+\.?[0-9]*)/
      ];
      
      let price = 0;
      for (const pattern of pricePatterns) {
        const match = pattern.exec(itemHtml);
        if (match) {
          price = parseFloat(match[1].replace(',', ''));
          if (price > 0) break;
        }
      }
      
      if (price <= 0) continue;
      
      // Extract date (sold date)
      const datePatterns = [
        /<span[^>]*class="[^"]*s-item__endedDate[^"]*"[^>]*>(?:<[^>]*>)*Sold\s+([^<]+)/,
        /<div[^>]*class="[^"]*s-item__subtitle[^"]*"[^>]*>(?:<[^>]*>)*Sold\s+([^<]+)/
      ];
      
      let dateStr = '';
      for (const pattern of datePatterns) {
        const match = pattern.exec(itemHtml);
        if (match) {
          dateStr = match[1].trim();
          break;
        }
      }
      
      // Extract URL
      const linkPattern = /<a[^>]*class="[^"]*s-item__link[^"]*"[^>]*href="([^"]+)"/;
      const linkMatch = linkPattern.exec(itemHtml);
      const url = linkMatch ? linkMatch[1] : searchUrl;
      
      // Extract image
      const imagePattern = /<img[^>]*src="([^"]*)"[^>]*class="[^"]*s-item__image[^"]*"/;
      const imageMatch = imagePattern.exec(itemHtml);
      const image = imageMatch ? imageMatch[1] : undefined;
      
      // Parse date
      let parsedDate = new Date().toISOString().split('T')[0];
      if (dateStr) {
        try {
          const cleanDate = dateStr.replace(/^(Sold\s+)/, '');
          const parsed = new Date(cleanDate);
          if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2020) {
            parsedDate = parsed.toISOString().split('T')[0];
          }
        } catch (e) {
          // Use current date if parsing fails
        }
      }
      
      results.push({
        title: title,
        price: price,
        date: parsedDate,
        url: url,
        image: image,
        source: 'eBay'
      });
      
    } catch (error) {
      console.error('Error parsing modern eBay item:', error);
      continue;
    }
  }
  
  console.log(`Modern eBay layout parser found ${results.length} items`);
  return results;
}

function parseLegacyEbayLayout(html: string, searchUrl: string, originalQuery: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  // Legacy patterns for older eBay layouts
  const legacyPatterns = [
    /<div[^>]*class="[^"]*srgl[^"]*"[^>]*>[\s\S]*?<\/div>/g,
    /<div[^>]*data-view="[^"]*mi[^"]*"[^>]*>[\s\S]*?<\/div>/g,
    /<div[^>]*id="[^"]*item[^"]*"[^>]*>[\s\S]*?<\/div>/g
  ];
  
  for (const pattern of legacyPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < 50) {
      const itemHtml = match[0];
      
      // Basic extraction for legacy format
      const titleMatch = itemHtml.match(/<h3[^>]*>([^<]+)</);
      const priceMatch = itemHtml.match(/\$([0-9,]+\.?[0-9]*)/);
      
      if (titleMatch && priceMatch) {
        const title = titleMatch[1].trim();
        const price = parseFloat(priceMatch[1].replace(',', ''));
        
        if (title && price > 0) {
          results.push({
            title: title,
            price: price,
            date: new Date().toISOString().split('T')[0],
            url: searchUrl,
            source: 'eBay'
          });
        }
      }
    }
  }
  
  console.log(`Legacy eBay layout parser found ${results.length} items`);
  return results;
}

function parseEbayJSONData(html: string, searchUrl: string, originalQuery: string): EbayResult[] {
  const results: EbayResult[] = [];
  
  try {
    // Look for JSON data embedded in the page
    const jsonPatterns = [
      /"itemSummaries":\s*\[([^\]]+)\]/g,
      /"items":\s*\[([^\]]+)\]/g,
      /window\.__INITIAL_STATE__\s*=\s*({[^;]+});/g
    ];
    
    for (const pattern of jsonPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        try {
          // Try to parse the JSON fragment
          const jsonStr = match[1] || match[0];
          const data = JSON.parse(jsonStr.replace(/'/g, '"'));
          
          if (Array.isArray(data)) {
            data.forEach(item => {
              if (item.title && item.price) {
                results.push({
                  title: item.title,
                  price: parseFloat(item.price.toString().replace(/[^0-9.]/g, '')),
                  date: new Date().toISOString().split('T')[0],
                  url: item.url || searchUrl,
                  image: item.image,
                  source: 'eBay'
                });
              }
            });
          }
        } catch (e) {
          // Continue if JSON parsing fails
          continue;
        }
      }
    }
  } catch (error) {
    console.error('JSON parsing error:', error);
  }
  
  console.log(`JSON data parser found ${results.length} items`);
  return results;
}

function deduplicateEbayResults(results: EbayResult[], originalQuery: string): EbayResult[] {
  const seen = new Map<string, EbayResult>();
  
  for (const result of results) {
    // Create a signature for deduplication
    const titleWords = result.title.toLowerCase().split(/\s+/).sort();
    const signature = `${titleWords.slice(0, 4).join('')}_${Math.round(result.price)}`;
    
    const existing = seen.get(signature);
    if (!existing || new Date(result.date) > new Date(existing.date)) {
      seen.set(signature, result);
    }
  }
  
  const uniqueResults = Array.from(seen.values());
  
  // Sort by relevance to the original query
  return uniqueResults.sort((a, b) => {
    const aScore = calculateEbayRelevanceScore(a.title, originalQuery);
    const bScore = calculateEbayRelevanceScore(b.title, originalQuery);
    
    if (Math.abs(aScore - bScore) > 0.1) {
      return bScore - aScore; // Higher score first
    }
    
    // If relevance is similar, prefer more recent
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}

function calculateEbayRelevanceScore(title: string, originalQuery: string): number {
  const titleLower = title.toLowerCase();
  const queryLower = originalQuery.toLowerCase();
  
  let score = 0;
  
  // Exact substring match bonus
  if (titleLower.includes(queryLower)) {
    score += 2.0;
  }
  
  // Extract key terms from both
  const titleTerms = titleLower.split(/\s+/).filter(t => t.length > 2);
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
  
  // Calculate term overlap
  const matchedTerms = queryTerms.filter(term => titleTerms.includes(term));
  const termScore = matchedTerms.length / queryTerms.length;
  score += termScore * 1.5;
  
  // Specific bonuses for card terms
  const cardTerms = ['prizm', 'silver', 'rookie', 'rc', 'daniels', 'jayden', '347', '2024'];
  const termBonuses = cardTerms.filter(term => 
    titleLower.includes(term) && queryLower.includes(term)
  );
  score += termBonuses.length * 0.2;
  
  // Penalty for obvious non-matches
  if (titleLower.includes('lot of') || titleLower.includes('break')) {
    score -= 1.0;
  }
  
  return Math.max(0, score);
}

async function fetchEbayAPI(searchQuery: string, apiKey: string): Promise<{ results: EbayResult[], error?: EbayError }> {
  console.log('Using eBay Browse API');
  
  const endpoint = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
  };
  
  // Enhanced filter for sold listings
  const params = new URLSearchParams({
    q: searchQuery,
    filter: 'conditionIds:{3000|3001|3002|3003|3004|3005},buyingOptions:{AUCTION|FIXED_PRICE},deliveryCountry:US,itemLocationCountry:US,itemEndDate:[2024-01-01T00:00:00.000Z..],soldItemsOnly:true',
    sort: 'endTimeNewest',
    limit: '200', // Max results
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
  
  console.log(`eBay API found ${results.length} results`);
  return { results };
}

// Rate limiting with better timing
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2500; // 2.5 seconds between requests

async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`eBay rate limiting: waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRequestTime = Date.now();
  return fetch(url, options);
}
