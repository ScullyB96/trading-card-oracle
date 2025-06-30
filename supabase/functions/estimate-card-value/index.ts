
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from './config.ts'
import { Logger } from './logger.ts'
import { parseCardFromImage, parseCardFromDescription } from './card-parser.ts'
import { generateSearchQueries } from './query-generator.ts'
import { discoverCardListings } from './search-discovery.ts'
import { scrapeDirectLinks } from './direct-link-scrapers.ts'
import { calculateCardValue } from './value-calculator.ts'
import { CardEstimationError, handleError } from './errors.ts'

interface EstimationRequest {
  image?: string;
  description?: string;
  sources: string[];
  compLogic: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const logger = new Logger();
  let traceId = '';

  try {
    // Parse request body
    const requestBody: EstimationRequest = await req.json();
    traceId = `est_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('Card estimation request received', {
      operation: 'estimate-card-value',
      traceId,
      sources: requestBody.sources,
      compLogic: requestBody.compLogic,
      hasImage: !!requestBody.image,
      hasDescription: !!requestBody.description
    });

    // Validate request
    if (!requestBody.image && !requestBody.description) {
      throw new CardEstimationError('Either image or description is required', 'INVALID_INPUT', traceId);
    }

    if (!requestBody.sources || requestBody.sources.length === 0) {
      throw new CardEstimationError('At least one source is required', 'INVALID_INPUT', traceId);
    }

    // Parse card information
    let cardKeywords;
    try {
      if (requestBody.image) {
        logger.info('Parsing card from image', { operation: 'parseCardFromImage', traceId });
        cardKeywords = await parseCardFromImage(requestBody.image, logger);
      } else {
        logger.info('Parsing card from description', { operation: 'parseCardFromDescription', traceId });
        cardKeywords = await parseCardFromDescription(requestBody.description!, logger);
      }
    } catch (error: any) {
      if (error.message?.includes('billing') || error.message?.includes('BILLING_NOT_ENABLED')) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Google Vision API billing required',
          details: 'Please enable billing for the Google Vision API or use the card description method.',
          traceId: 'billing-disabled'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      if (error.message?.includes('API_NOT_ENABLED') || error.message?.includes('vision')) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Google Vision API not enabled',
          details: 'Please enable the Google Vision API or use the card description method.',
          traceId: 'vision-api-disabled'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      throw error;
    }

    logger.info('Card parsing complete', {
      operation: 'parseCard',
      traceId,
      player: cardKeywords.player,
      year: cardKeywords.year,
      set: cardKeywords.set
    });

    // Generate search queries
    const querySet = generateSearchQueries(cardKeywords, logger);
    
    if (querySet.allQueries.length === 0) {
      throw new CardEstimationError('No valid search queries could be generated', 'QUERY_GENERATION_FAILED', traceId);
    }

    logger.info('Search queries generated', {
      operation: 'generateQueries',
      traceId,
      queryCount: querySet.allQueries.length
    });

    // Discover card listings
    const discoveryResults = await discoverCardListings(querySet, requestBody.sources, logger);
    
    logger.info('Discovery phase complete', {
      operation: 'discoverListings',
      traceId,
      totalLinks: discoveryResults.discoveredLinks.length,
      errors: discoveryResults.errors.length
    });

    // Scrape direct links for detailed information
    const scrapingResults = await scrapeDirectLinks(
      discoveryResults.discoveredLinks,
      requestBody.sources,
      cardKeywords,
      logger
    );

    logger.info('Scraping phase complete', {
      operation: 'scrapeLinks',
      traceId,
      salesFound: scrapingResults.salesData.length,
      errors: scrapingResults.errors.length
    });

    // Calculate estimated value
    const valueResult = calculateCardValue(
      scrapingResults.salesData,
      requestBody.compLogic,
      logger
    );

    // Compile final response
    const response = {
      success: true,
      traceId,
      cardInfo: cardKeywords,
      estimatedValue: valueResult.estimatedValue,
      confidence: valueResult.confidence,
      methodology: valueResult.methodology,
      comps: scrapingResults.salesData,
      warnings: [
        ...discoveryResults.errors.map(e => e.message),
        ...scrapingResults.errors.map(e => e.message)
      ].filter(Boolean),
      exactMatchFound: scrapingResults.salesData.length > 0,
      matchMessage: scrapingResults.salesData.length > 0 
        ? `Found ${scrapingResults.salesData.length} comparable sales`
        : 'No exact matches found, showing similar cards',
      dataPoints: scrapingResults.salesData.length,
      priceRange: valueResult.priceRange,
      productionResponse: {
        architecture: 'Discover-then-Scrape v2.0',
        discoveryPhase: {
          queriesGenerated: querySet.allQueries.length,
          linksDiscovered: discoveryResults.discoveredLinks.length,
          sourcesUsed: requestBody.sources
        },
        scrapingPhase: {
          linksProcessed: discoveryResults.discoveredLinks.length,
          salesExtracted: scrapingResults.salesData.length,
          processingTime: 'Real-time'
        },
        valuationPhase: {
          logic: requestBody.compLogic,
          confidence: valueResult.confidence,
          methodology: valueResult.methodology
        }
      }
    };

    logger.info('Card estimation complete', {
      operation: 'estimate-card-value',
      traceId,
      estimatedValue: valueResult.estimatedValue,
      compsFound: scrapingResults.salesData.length,
      success: true
    });

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    return handleError(error, traceId, logger);
  }
});
