import { Logger } from './logger.ts';
import { withTimeout } from './utils.ts';
import { config } from './config.ts';

export interface DirectLinkResult {
  title: string;
  price: number;
  date: string;
  source: string;
  image?: string;
  url: string;
  condition?: string;
}

export interface DirectLinkScrapingResult {
  results: DirectLinkResult[];
  errors: Array<{ source: string; message: string; url: string }>;
}

export async function scrapeDirectLinks(
  urls: string[],
  logger: Logger
): Promise<DirectLinkScrapingResult> {
  logger.info('Starting revised direct link scraping', {
    operation: 'scrapeDirectLinks',
    urlCount: urls.length
  });

  const results: DirectLinkResult[] = [];
  const errors: Array<{ source: string; message: string; url: string }> = [];

  for (const url of urls.slice(0, 6)) { // Limit to prevent timeouts
    try {
      logger.info(`Scraping direct link: ${url}`);
      
      let result: DirectLinkResult | null = null;
      
      if (url.includes('ebay.com')) {
        result = await scrapeEbayDirectLinkRevised(url, logger);
      } else if (url.includes('130point.com')) {
        result = await scrape130PointDirectLinkRevised(url, logger);
      } else if (url.includes('pwcc.market')) {
        result = await scrapePwccDirectLinkRevised(url, logger);
      } else {
        // Try generic scraping for unknown sources
        result = await scrapeGenericDirectLink(url, logger);
      }
      
      if (result) {
        results.push(result);
        logger.info(`✅ Successfully scraped: ${result.title} - $${result.price}`);
      } else {
        errors.push({
          source: 'Direct Link Scraper',
          message: 'No data extracted from page',
          url
        });
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      logger.error('Direct link scraping failed', error, { url });
      errors.push({
        source: 'Direct Link Scraper',
        message: `Scraping failed: ${error.message}`,
        url
      });
    }
  }

  logger.info('Direct link scraping completed', {
    operation: 'scrapeDirectLinks',
    successfulResults: results.length,
    errors: errors.length
  });

  return {
    results,
    errors
  };
}

async function scrapeEbayDirectLinkRevised(url: string, logger: Logger): Promise<DirectLinkResult | null> {
  try {
    const response = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache'
        }
      }),
      10000,
      'eBay direct link'
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Multiple title extraction strategies
    let title = '';
    const titlePatterns = [
      /<h1[^>]*id[^>]*="x-title-label-lbl"[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*class="[^"]*notranslate[^"]*"[^>]*>([^<]+)<\/h1>/i,
      /<title>([^|]+)\s*\|/i,
      /<h1[^>]*>([^<]{20,200})</i,
      /property="og:title"[^>]*content="([^"]+)"/i
    ];
    
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1] && match[1].trim().length > 10) {
        title = match[1].trim();
        break;
      }
    }

    // Multiple price extraction strategies
    let price = 0;
    const pricePatterns = [
      /"PRICE_VALUE":\s*"([^"]+)"/i,
      /"currentPrice"[^}]*"value":\s*"([^"]+)"/i,
      /span[^>]*class[^>]*"currentPrice"[^>]*>.*?\$([0-9,]+\.?\d*)/i,
      /class="notranslate"[^>]*>.*?\$([0-9,]+\.?\d*)/i,
      /"price":\s*"?([0-9,]+\.?\d*)"?/i,
      /\$([0-9,]+\.?\d*)/g // Fallback: any price-like pattern
    ];
    
    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const priceStr = match[1].replace(/[,$]/g, '');
        const parsedPrice = parseFloat(priceStr);
        if (!isNaN(parsedPrice) && parsedPrice > 0 && parsedPrice < 50000) {
          price = parsedPrice;
          break;
        }
      }
    }

    // If no price found with specific patterns, try all prices and pick reasonable one
    if (price === 0) {
      const allPriceMatches = [...html.matchAll(/\$([0-9,]+\.?\d*)/g)];
      for (const match of allPriceMatches) {
        const p = parseFloat(match[1].replace(/,/g, ''));
        if (p > 1 && p < 10000) {
          price = p;
          break;
        }
      }
    }

    if (!title || price <= 0) {
      logger.warn('Could not extract required data from eBay page', { url, title, price });
      return null;
    }

    // Date extraction
    let date = new Date().toISOString().split('T')[0];
    const datePatterns = [
      /"SOLD_DATE":\s*"([^"]+)"/i,
      /Sold\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /sold[^>]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i
    ];
    
    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match) {
        try {
          const parsedDate = new Date(match[1]);
          if (!isNaN(parsedDate.getTime())) {
            date = parsedDate.toISOString().split('T')[0];
            break;
          }
        } catch (error) {
          // Continue to next pattern
        }
      }
    }

    // Image extraction
    const imagePatterns = [
      /"originalImg":\s*"([^"]+)"/i,
      /img[^>]*id[^>]*="icImg"[^>]*src[^>]*="([^"]+)"/i,
      /property="og:image"[^>]*content="([^"]+)"/i
    ];
    
    let image;
    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        image = match[1];
        break;
      }
    }

    return {
      title,
      price,
      date,
      source: 'eBay',
      image,
      url,
      condition: extractConditionFromTitle(title)
    };

  } catch (error) {
    logger.error('eBay direct link scraping failed', error, { url });
    return null;
  }
}

async function scrape130PointDirectLinkRevised(url: string, logger: Logger): Promise<DirectLinkResult | null> {
  try {
    const response = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }),
      8000,
      '130Point direct link'
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Flexible title extraction
    let title = '';
    const titlePatterns = [
      /<h1[^>]*class[^>]*="card-title"[^>]*>([^<]+)<\/h1>/i,
      /<h1[^>]*>([^<]{15,200})</i,
      /<title>([^-|]+)[-|]/i,
      /property="og:title"[^>]*content="([^"]+)"/i,
      />([^<]*(?:card|rookie|prizm)[^<]*)</gi
    ];
    
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1] && match[1].trim().length >= 15) {
        title = match[1].trim();
        break;
      }
    }

    // Flexible price extraction
    let price = 0;
    const pricePatterns = [
      /\$([0-9,]+\.?\d*)/g,
      /price[^>]*>.*?\$([0-9,]+\.?\d*)/gi,
      /sold[^>]*\$([0-9,]+\.?\d*)/gi
    ];
    
    for (const pattern of pricePatterns) {
      const matches = [...html.matchAll(pattern)];
      for (const match of matches) {
        const p = parseFloat(match[1].replace(/[$,]/g, ''));
        if (p > 1 && p < 10000) {
          price = p;
          break;
        }
      }
      if (price > 0) break;
    }

    if (!title || price <= 0) {
      logger.warn('Could not extract required data from 130Point page', { url, title, price });
      return null;
    }

    // Date extraction
    let date = new Date().toISOString().split('T')[0];
    const dateMatch = html.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})|(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      try {
        const parsedDate = new Date(dateMatch[0]);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate.toISOString().split('T')[0];
        }
      } catch (error) {
        // Keep default date
      }
    }

    return {
      title,
      price,
      date,
      source: '130Point',
      url,
      condition: extractConditionFromTitle(title)
    };

  } catch (error) {
    logger.error('130Point direct link scraping failed', error, { url });
    return null;
  }
}

async function scrapePwccDirectLinkRevised(url: string, logger: Logger): Promise<DirectLinkResult | null> {
  try {
    const response = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      }),
      8000,
      'PWCC direct link'
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Extract title
    const titlePatterns = [
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title>([^|]+)\|/i,
      /property="og:title"[^>]*content="([^"]+)"/i
    ];
    
    let title = '';
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1] && match[1].trim().length > 10) {
        title = match[1].trim();
        break;
      }
    }

    // Extract price
    const pricePatterns = [
      /Final Price[^$]*\$([0-9,]+\.?\d*)/i,
      /\$([0-9,]+\.?\d*)/g
    ];
    
    let price = 0;
    for (const pattern of pricePatterns) {
      const matches = [...html.matchAll(pattern)];
      for (const match of matches) {
        const p = parseFloat(match[1].replace(/[$,]/g, ''));
        if (p > 10 && p < 50000) {
          price = p;
          break;
        }
      }
      if (price > 0) break;
    }

    if (!title || price <= 0) {
      return null;
    }

    let date = new Date().toISOString().split('T')[0];
    const dateMatch = html.match(/Ended[^>]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (dateMatch) {
      try {
        const parsedDate = new Date(dateMatch[1]);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate.toISOString().split('T')[0];
        }
      } catch (error) {
        // Keep default date
      }
    }

    return {
      title,
      price,
      date,
      source: 'PWCC',
      url,
      condition: extractConditionFromTitle(title)
    };

  } catch (error) {
    logger.error('PWCC direct link scraping failed', error, { url });
    return null;
  }
}

async function scrapeGenericDirectLink(url: string, logger: Logger): Promise<DirectLinkResult | null> {
  try {
    const response = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      }),
      8000,
      'Generic direct link'
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Generic title extraction
    const titlePatterns = [
      /<title>([^<]+)<\/title>/i,
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /property="og:title"[^>]*content="([^"]+)"/i
    ];
    
    let title = '';
    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1] && match[1].trim().length > 10) {
        title = match[1].trim();
        break;
      }
    }

    // Generic price extraction
    const allPrices = [...html.matchAll(/\$([0-9,]+\.?\d*)/g)];
    let price = 0;
    
    for (const match of allPrices) {
      const p = parseFloat(match[1].replace(/,/g, ''));
      if (p > 5 && p < 10000) {
        price = p;
        break;
      }
    }

    if (!title || price <= 0) {
      return null;
    }

    return {
      title,
      price,
      date: new Date().toISOString().split('T')[0],
      source: 'Generic',
      url,
      condition: extractConditionFromTitle(title)
    };

  } catch (error) {
    logger.error('Generic direct link scraping failed', error, { url });
    return null;
  }
}

function extractConditionFromTitle(title: string): string | undefined {
  const conditionPatterns = [
    /PSA\s+(\d+)/i,
    /BGS\s+(\d+\.?\d*)/i,
    /SGC\s+(\d+)/i,
    /\b(mint|nm|ex|vg|good|poor|damaged)\b/i,
    /\b(raw|ungraded)\b/i
  ];

  for (const pattern of conditionPatterns) {
    const match = title.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return undefined;
}
