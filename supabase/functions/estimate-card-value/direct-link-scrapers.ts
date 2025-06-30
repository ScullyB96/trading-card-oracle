
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
  logger.info('Starting direct link scraping', {
    operation: 'scrapeDirectLinks',
    urlCount: urls.length
  });

  const results: DirectLinkResult[] = [];
  const errors: Array<{ source: string; message: string; url: string }> = [];

  for (const url of urls) {
    try {
      logger.info(`Scraping direct link: ${url}`);
      
      let result: DirectLinkResult | null = null;
      
      if (url.includes('ebay.com')) {
        result = await scrapeEbayDirectLink(url, logger);
      } else if (url.includes('130point.com')) {
        result = await scrape130PointDirectLink(url, logger);
      } else if (url.includes('pwcc.market')) {
        result = await scrapePwccDirectLink(url, logger);
      }
      
      if (result) {
        results.push(result);
      } else {
        errors.push({
          source: 'Direct Link Scraper',
          message: 'No data extracted from page',
          url
        });
      }
      
      // Rate limiting between requests
      await new Promise(resolve => setTimeout(resolve, 1500));
      
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

async function scrapeEbayDirectLink(url: string, logger: Logger): Promise<DirectLinkResult | null> {
  try {
    const response = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache'
        }
      }),
      config.timeout.request,
      'eBay direct link'
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Extract data using targeted selectors
    const titleMatch = html.match(/<h1[^>]*id[^>]*="x-title-label-lbl"[^>]*>([^<]+)<\/h1>/i) ||
                      html.match(/<title>([^|]+)\|/i);
    
    const priceMatch = html.match(/"PRICE_VALUE":\s*"([^"]+)"/i) ||
                      html.match(/span[^>]*class[^>]*"currentPrice"[^>]*>([^<]+)</i);
    
    const dateMatch = html.match(/"SOLD_DATE":\s*"([^"]+)"/i) ||
                     html.match(/Sold\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
    
    const imageMatch = html.match(/"originalImg":\s*"([^"]+)"/i) ||
                      html.match(/img[^>]*id[^>]*="icImg"[^>]*src[^>]*="([^"]+)"/i);

    if (!titleMatch || !priceMatch) {
      logger.warn('Could not extract required data from eBay page', { url });
      return null;
    }

    const title = titleMatch[1].trim();
    const priceStr = priceMatch[1].replace(/[,$]/g, '');
    const price = parseFloat(priceStr);
    
    if (isNaN(price) || price <= 0) {
      logger.warn('Invalid price extracted from eBay page', { url, priceStr });
      return null;
    }

    // Parse date
    let date = new Date().toISOString().split('T')[0]; // Default to today
    if (dateMatch) {
      try {
        const parsedDate = new Date(dateMatch[1]);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate.toISOString().split('T')[0];
        }
      } catch (error) {
        logger.warn('Failed to parse eBay date', { dateStr: dateMatch[1] });
      }
    }

    return {
      title,
      price,
      date,
      source: 'eBay',
      image: imageMatch?.[1],
      url,
      condition: extractConditionFromTitle(title)
    };

  } catch (error) {
    logger.error('eBay direct link scraping failed', error, { url });
    return null;
  }
}

async function scrape130PointDirectLink(url: string, logger: Logger): Promise<DirectLinkResult | null> {
  try {
    const response = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }),
      config.timeout.request,
      '130Point direct link'
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Extract data using 130Point specific patterns
    const titleMatch = html.match(/<h1[^>]*class[^>]*="card-title"[^>]*>([^<]+)<\/h1>/i) ||
                      html.match(/<title>([^-]+)-/i);
    
    const priceMatch = html.match(/\$([0-9,]+\.?\d*)/i);
    
    const dateMatch = html.match(/sold[^>]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i) ||
                     html.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    
    const imageMatch = html.match(/img[^>]*src[^>]*="([^"]*card[^"]*\.(?:jpg|jpeg|png|gif))"/i);

    if (!titleMatch || !priceMatch) {
      logger.warn('Could not extract required data from 130Point page', { url });
      return null;
    }

    const title = titleMatch[1].trim();
    const priceStr = priceMatch[1].replace(/[,$]/g, '');
    const price = parseFloat(priceStr);
    
    if (isNaN(price) || price <= 0) {
      logger.warn('Invalid price extracted from 130Point page', { url, priceStr });
      return null;
    }

    // Parse date
    let date = new Date().toISOString().split('T')[0];
    if (dateMatch) {
      try {
        const parsedDate = new Date(dateMatch[1]);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate.toISOString().split('T')[0];
        }
      } catch (error) {
        logger.warn('Failed to parse 130Point date', { dateStr: dateMatch[1] });
      }
    }

    return {
      title,
      price,
      date,
      source: '130Point',
      image: imageMatch?.[1],
      url,
      condition: extractConditionFromTitle(title)
    };

  } catch (error) {
    logger.error('130Point direct link scraping failed', error, { url });
    return null;
  }
}

async function scrapePwccDirectLink(url: string, logger: Logger): Promise<DirectLinkResult | null> {
  try {
    const response = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      }),
      config.timeout.request,
      'PWCC direct link'
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Extract data using PWCC specific patterns
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                      html.match(/<title>([^|]+)\|/i);
    
    const priceMatch = html.match(/Final Price[^$]*\$([0-9,]+\.?\d*)/i) ||
                      html.match(/\$([0-9,]+\.?\d*)/i);
    
    const dateMatch = html.match(/Ended[^>]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    
    const imageMatch = html.match(/img[^>]*src[^>]*="([^"]*\.(?:jpg|jpeg|png|gif))"/i);

    if (!titleMatch || !priceMatch) {
      logger.warn('Could not extract required data from PWCC page', { url });
      return null;
    }

    const title = titleMatch[1].trim();
    const priceStr = priceMatch[1].replace(/[,$]/g, '');
    const price = parseFloat(priceStr);
    
    if (isNaN(price) || price <= 0) {
      logger.warn('Invalid price extracted from PWCC page', { url, priceStr });
      return null;
    }

    let date = new Date().toISOString().split('T')[0];
    if (dateMatch) {
      try {
        const parsedDate = new Date(dateMatch[1]);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate.toISOString().split('T')[0];
        }
      } catch (error) {
        logger.warn('Failed to parse PWCC date', { dateStr: dateMatch[1] });
      }
    }

    return {
      title,
      price,
      date,
      source: 'PWCC',
      image: imageMatch?.[1],
      url,
      condition: extractConditionFromTitle(title)
    };

  } catch (error) {
    logger.error('PWCC direct link scraping failed', error, { url });
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
