
/**
 * eBay Finding API scraper for completed/sold listings
 * Integrates with existing scraper architecture
 */

export interface EbayFindingResult {
  title: string;
  price: number;
  date: string;
  source: string;
  image?: string;
  url: string;
  condition?: string;
  itemId: string;
}

export interface EbayFindingError {
  source: string;
  message: string;
}

export interface EbayFindingConfig {
  appId: string;
  maxResults?: number;
  timeout?: number;
}

export interface EbaySearchParams {
  keywords: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
}

/**
 * eBay Finding API client with rate limiting and error handling
 */
export class EbayFindingClient {
  private appId: string;
  private baseUrl = 'https://svcs.ebay.com/services/search/FindingService/v1';
  private maxResults: number;
  private timeout: number;
  private lastRequestTime = 0;
  private minRequestInterval = 100; // 100ms between requests

  constructor(config: EbayFindingConfig) {
    this.appId = config.appId;
    this.maxResults = Math.min(config.maxResults || 20, 100); // eBay API limit
    this.timeout = config.timeout || 10000;
  }

  /**
   * Search for completed/sold items using eBay Finding API
   */
  async findCompletedItems(params: EbaySearchParams): Promise<{ results: EbayFindingResult[], error?: EbayFindingError }> {
    try {
      console.log(`🔍 eBay Finding API: Searching for "${params.keywords}"`);
      
      // Rate limiting
      await this.enforceRateLimit();
      
      const searchUrl = this.buildSearchUrl(params);
      console.log(`📡 eBay API URL: ${searchUrl}`);
      
      const response = await this.makeRequest(searchUrl);
      const results = await this.parseResponse(response);
      
      console.log(`✅ eBay Finding API: Found ${results.length} completed items`);
      return { results };
      
    } catch (error: any) {
      console.error('❌ eBay Finding API error:', error);
      return {
        results: [],
        error: {
          source: 'eBay Finding API',
          message: `Search failed: ${error.message}`
        }
      };
    }
  }

  /**
   * Build eBay Finding API search URL with parameters
   */
  private buildSearchUrl(params: EbaySearchParams): string {
    const baseParams = new URLSearchParams({
      'OPERATION-NAME': 'findCompletedItems',
      'SERVICE-VERSION': '1.0.0',
      'SECURITY-APPNAME': this.appId,
      'RESPONSE-DATA-FORMAT': 'JSON',
      'REST-PAYLOAD': 'true',
      'keywords': params.keywords,
      'paginationInput.entriesPerPage': this.maxResults.toString(),
      'paginationInput.pageNumber': '1',
      'sortOrder': 'EndTimeSoonest',
      // Only sold items
      'itemFilter(0).name': 'SoldItemsOnly',
      'itemFilter(0).value': 'true',
      // Exclude auctions that ended without sale
      'itemFilter(1).name': 'Condition',
      'itemFilter(1).value': 'Used',
      'itemFilter(2).name': 'Condition', 
      'itemFilter(2).value': 'New'
    });

    // Add category filter if provided
    if (params.categoryId) {
      baseParams.set('categoryId', params.categoryId);
    }

    // Add price filters if provided
    if (params.minPrice) {
      baseParams.set('itemFilter(3).name', 'MinPrice');
      baseParams.set('itemFilter(3).value', params.minPrice.toString());
    }
    
    if (params.maxPrice) {
      const filterIndex = params.minPrice ? '4' : '3';
      baseParams.set(`itemFilter(${filterIndex}).name`, 'MaxPrice');
      baseParams.set(`itemFilter(${filterIndex}).value`, params.maxPrice.toString());
    }

    return `${this.baseUrl}?${baseParams.toString()}`;
  }

  /**
   * Make HTTP request with timeout and retry logic
   */
  private async makeRequest(url: string, retries = 3): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'CardValueEstimator/1.0',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Check for eBay API errors
        if (data.errorMessage) {
          throw new Error(`eBay API Error: ${data.errorMessage[0].error[0].message[0]}`);
        }

        return data;

      } catch (error: any) {
        console.warn(`⚠️ eBay API attempt ${attempt}/${retries} failed:`, error.message);
        
        if (attempt === retries) {
          throw error;
        }
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Parse eBay Finding API response into normalized results
   */
  private async parseResponse(data: any): Promise<EbayFindingResult[]> {
    try {
      const searchResult = data.findCompletedItemsResponse?.[0]?.searchResult?.[0];
      
      if (!searchResult || searchResult['@count'] === '0') {
        console.log('📭 No completed items found');
        return [];
      }

      const items = searchResult.item || [];
      const results: EbayFindingResult[] = [];

      for (const item of items) {
        try {
          const result = this.parseItem(item);
          if (result) {
            results.push(result);
          }
        } catch (error) {
          console.warn('⚠️ Failed to parse eBay item:', error);
          // Continue with other items
        }
      }

      return results;
      
    } catch (error) {
      console.error('❌ Failed to parse eBay response:', error);
      return [];
    }
  }

  /**
   * Parse individual eBay item into normalized format
   */
  private parseItem(item: any): EbayFindingResult | null {
    try {
      // Extract required fields
      const title = item.title?.[0];
      const priceValue = item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__;
      const endTime = item.listingInfo?.[0]?.endTime?.[0];
      const itemId = item.itemId?.[0];
      const viewItemURL = item.viewItemURL?.[0];

      if (!title || !priceValue || !endTime || !itemId || !viewItemURL) {
        return null;
      }

      // Parse price
      const price = parseFloat(priceValue);
      if (isNaN(price) || price <= 0) {
        return null;
      }

      // Parse date
      const date = new Date(endTime);
      if (isNaN(date.getTime())) {
        return null;
      }

      // Extract optional fields
      const condition = item.condition?.[0]?.conditionDisplayName?.[0];
      const imageUrl = item.galleryURL?.[0];

      return {
        title: title.trim(),
        price: Math.round(price * 100) / 100, // Round to 2 decimal places
        date: date.toISOString().split('T')[0], // YYYY-MM-DD format
        source: 'eBay',
        url: viewItemURL,
        image: imageUrl,
        condition,
        itemId
      };

    } catch (error) {
      console.error('❌ Error parsing eBay item:', error);
      return null;
    }
  }

  /**
   * Enforce rate limiting between requests
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const delay = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }
}

/**
 * Convenience function to search eBay completed items
 * Follows the pattern of other scrapers in the project
 */
export async function scrapeEbayCompletedItems(
  keywords: string,
  appId: string,
  options: {
    categoryId?: string;
    minPrice?: number;
    maxPrice?: number;
    maxResults?: number;
  } = {}
): Promise<{ results: EbayFindingResult[], error?: EbayFindingError }> {
  
  console.log(`🎯 Starting eBay completed items scrape for: "${keywords}"`);
  
  const client = new EbayFindingClient({
    appId,
    maxResults: options.maxResults || 20,
    timeout: 10000
  });

  const searchParams: EbaySearchParams = {
    keywords,
    categoryId: options.categoryId,
    minPrice: options.minPrice,
    maxPrice: options.maxPrice
  };

  return await client.findCompletedItems(searchParams);
}

/**
 * Test function for development/debugging
 */
export async function testEbayFindingAPI(appId: string): Promise<void> {
  console.log('🧪 Testing eBay Finding API...');
  
  const testQuery = "2021 Topps Chrome Mike Trout";
  const result = await scrapeEbayCompletedItems(testQuery, appId, {
    maxResults: 5
  });

  console.log('📊 Test Results:');
  console.log(`- Found ${result.results.length} items`);
  if (result.error) {
    console.log(`- Error: ${result.error.message}`);
  }
  
  result.results.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.title} - $${item.price} (${item.date})`);
  });
}
