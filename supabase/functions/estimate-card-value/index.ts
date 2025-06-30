import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from './config.ts'; // Import centralized headers
import { Logger } from './logger.ts';
import { parseCardFromImage, parseCardFromDescription } from './card-parser.ts';
import { CardEstimationError, handleError } from './errors.ts';
import { fetchProductionComps } from './sales-scrapers.ts';

interface EstimationRequest {
  image?: string;
  description?: string;
  sources: string[];
  compLogic: string;
}

serve(async (req) => {
  // **IMPROVED CORS HANDLING**
  // Handle CORS preflight requests by returning a 204 No Content response.
  // This is a standard and robust way to handle preflight checks.
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  const logger = new Logger();
  let traceId = '';

  try {
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

    if (!requestBody.image && !requestBody.description) {
      throw new CardEstimationError('Either image or description is required', 'INVALID_INPUT', traceId);
    }

    if (!requestBody.sources || requestBody.sources.length === 0) {
      throw new CardEstimationError('At least one source is required', 'INVALID_INPUT', traceId);
    }

    let cardKeywords;
    if (requestBody.description) {
        logger.info('Parsing card from description', { operation: 'parseCardFromDescription', traceId });
        cardKeywords = await parseCardFromDescription(requestBody.description, logger);
    } else if (requestBody.image) {
        logger.info('Parsing card from image', { operation: 'parseCardFromImage', traceId });
        cardKeywords = await parseCardFromImage(requestBody.image, logger);
    } else {
        throw new CardEstimationError('No input provided.', 'INVALID_INPUT', traceId);
    }

    logger.info('Card parsing complete', {
      operation: 'parseCard',
      traceId,
      player: cardKeywords.player,
      year: cardKeywords.year,
      set: cardKeywords.set
    });
    
    const productionResult = await fetchProductionComps(
      cardKeywords,
      requestBody.sources,
      requestBody.compLogic
    );

    const response = {
      success: true,
      traceId,
      cardInfo: cardKeywords,
      ...productionResult
    };

    logger.info('Card estimation complete', {
      operation: 'estimate-card-value',
      traceId,
      estimatedValue: productionResult.estimatedValue,
      compsFound: productionResult.comps.length,
      success: true
    });

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    return handleError(error, traceId, logger);
  }
});
