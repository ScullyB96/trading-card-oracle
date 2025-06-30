import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from './config.ts';
import { Logger } from './logger.ts';
import { extractCardInfoFromImage, parseCardDescription } from './vision-parser.ts';
import { CardEstimationError, handleError } from './errors.ts';
import { fetchProductionComps } from './sales-scrapers.ts';

interface EstimationRequest {
  image?: string;
  description?: string;
  sources: string[];
  compLogic: string;
}

serve(async (req) => {
  // **DEFINITIVE CORS PREFLIGHT FIX**
  // This block handles the browser's preflight request. It must return a 2xx
  // status (204 is best) with the correct headers for the browser to proceed.
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  const logger = new Logger();
  let traceId = '';

  try {
    const requestBody: EstimationRequest = await req.json();
    traceId = `est_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('Card estimation request received', { operation: 'estimate-card-value', traceId });

    if (!requestBody.image && !requestBody.description) {
      throw new CardEstimationError('Either image or description is required.', 'INVALID_INPUT', traceId);
    }

    let cardKeywords;
    // Prioritize text description as it's more reliable than image parsing.
    if (requestBody.description) {
        logger.info('Parsing card from description', { traceId });
        cardKeywords = await parseCardDescription(requestBody.description);
    } else if (requestBody.image) {
        logger.info('Parsing card from image', { traceId });
        cardKeywords = await extractCardInfoFromImage(requestBody.image);
    } else {
        throw new CardEstimationError('No input provided.', 'INVALID_INPUT', traceId);
    }

    logger.info('Card parsing complete', { traceId, player: cardKeywords.player });
    
    // Call the single, robust function to get results.
    // Note: The `sources` parameter is no longer needed here as the new architecture only uses eBay's API.
    const productionResult = await fetchProductionComps(
      cardKeywords,
      requestBody.compLogic,
      logger
    );

    const response = {
      success: true,
      traceId,
      cardInfo: cardKeywords,
      ...productionResult
    };

    logger.info('Card estimation complete', { traceId, success: true });

    // Return the final success response with correct CORS headers.
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    // The centralized error handler will apply the correct CORS headers to the error response.
    return handleError(error, traceId, logger);
  }
});
