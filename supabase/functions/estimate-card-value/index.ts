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
    if (requestBody.description) {
        cardKeywords = await parseCardDescription(requestBody.description);
    } else if (requestBody.image) {
        cardKeywords = await extractCardInfoFromImage(requestBody.image);
    } else {
        throw new CardEstimationError('No input provided.', 'INVALID_INPUT', traceId);
    }

    logger.info('Card parsing complete', { traceId, player: cardKeywords.player });
    
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

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    return handleError(error, traceId, logger);
  }
});
