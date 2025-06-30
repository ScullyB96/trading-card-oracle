
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from './config.ts'
import { Logger } from './logger.ts'
import { parseCardFromImage, parseCardFromDescription } from './card-parser.ts'
import { fetchProductionComps } from './sales-scrapers.ts'
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

    // Use the new centralized scraping function
    const scrapingResult = await fetchProductionComps(
      cardKeywords,
      requestBody.sources,
      requestBody.compLogic
    );

    logger.info('Card estimation complete', {
      operation: 'estimate-card-value',
      traceId,
      estimatedValue: scrapingResult.estimatedValue,
      compsFound: scrapingResult.comps.length,
      success: scrapingResult.success
    });

    // Return consistent response structure
    const response = {
      success: scrapingResult.success,
      traceId,
      cardInfo: cardKeywords,
      estimatedValue: scrapingResult.estimatedValue,
      confidence: scrapingResult.confidence,
      methodology: scrapingResult.methodology,
      comps: scrapingResult.comps,
      warnings: scrapingResult.warnings,
      exactMatchFound: scrapingResult.exactMatchFound,
      matchMessage: scrapingResult.matchMessage,
      dataPoints: scrapingResult.dataPoints,
      priceRange: scrapingResult.priceRange,
      productionResponse: scrapingResult.productionResponse
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    return handleError(error, traceId, logger);
  }
});
