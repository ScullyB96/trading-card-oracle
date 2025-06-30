
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { extractCardInfoFromImage, parseCardDescription, ExtractedCardKeywords } from './vision-parser.ts';
import { fetchProductionComps, ProductionScraperResponse } from './sales-scrapers.ts';
import { config } from './config.ts';
import { Logger } from './logger.ts';
import { generateTraceId } from './utils.ts';
import { CardProcessingError, ValidationError, ConfigurationError } from './errors.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EstimationRequest {
  image?: string;
  description?: string;
  sources: string[];
  compLogic: string;
}

interface EstimationResponse {
  success: boolean;
  cardInfo?: ExtractedCardKeywords;
  salesResults?: any[];
  estimatedValue?: number;
  confidence?: number;
  methodology?: string;
  dataPoints?: number;
  priceRange?: { low: number; high: number };
  logicUsed?: string;
  warnings?: string[];
  error?: string;
  details?: string;
  traceId?: string;
  exactMatchFound?: boolean;
  matchMessage?: string;
  productionResponse?: ProductionScraperResponse;
  errors?: Array<{
    source: string;
    message: string;
  }>;
}

function createJsonResponse(data: object, status: number = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: status,
  });
}

function createSuccessResponse(data: Partial<EstimationResponse>, traceId: string): EstimationResponse {
  return {
    success: true,
    traceId,
    errors: [],
    warnings: [],
    ...data
  };
}

function createErrorResponse(
  message: string, 
  traceId: string, 
  errors: Array<{ source: string; message: string }> = [],
  details?: string
): EstimationResponse {
  return {
    success: false,
    error: message,
    details,
    traceId,
    errors,
    warnings: [],
    estimatedValue: 0,
    confidence: 0,
    methodology: 'Error occurred',
    dataPoints: 0,
    priceRange: { low: 0, high: 0 }
  };
}

async function validateAndParseRequest(req: Request): Promise<{ data: EstimationRequest; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    const requestData: EstimationRequest = await req.json();
    
    if (!requestData.sources || requestData.sources.length === 0) {
      errors.push('No data sources selected');
    } else {
      const validSources = requestData.sources.filter(s => ['ebay', '130point'].includes(s));
      if (validSources.length === 0) {
        errors.push('Invalid data sources provided');
      }
      requestData.sources = validSources;
    }
    
    if (!requestData.image && !requestData.description?.trim()) {
      errors.push('No input provided - either image or description is required');
    }
    
    if (!requestData.compLogic) {
      requestData.compLogic = 'average3';
    }
    
    return { data: requestData, errors };
    
  } catch (error) {
    console.error('Request parsing error:', error);
    return { 
      data: {} as EstimationRequest, 
      errors: ['Invalid request format - unable to parse JSON'] 
    };
  }
}

async function safeExtractCardInfo(
  requestData: EstimationRequest, 
  logger: Logger
): Promise<{ cardInfo?: ExtractedCardKeywords; errors: Array<{ source: string; message: string }> }> {
  const errors: Array<{ source: string; message: string }> = [];
  
  try {
    if (requestData.image) {
      if (!config.googleVisionApiKey) {
        errors.push({
          source: 'Google Vision API',
          message: 'Image processing is not available - API key not configured'
        });
        return { errors };
      }
      
      logger.info('Processing image with NEW ARCHITECTURE Vision API');
      const cardInfo = await extractCardInfoFromImage(requestData.image);
      
      if (!cardInfo.player || cardInfo.player === 'unknown') {
        errors.push({
          source: 'Image Processing',
          message: 'Could not identify player from the provided image'
        });
        return { errors };
      }
      
      logger.info('NEW ARCHITECTURE image processing successful', { 
        player: cardInfo.player,
        keywords: {
          parallels: cardInfo.parallels.length,
          specialAttributes: cardInfo.specialAttributes.length
        },
        confidence: cardInfo.confidence 
      });
      
      return { cardInfo, errors };
      
    } else if (requestData.description?.trim()) {
      logger.info('Processing text description with NEW ARCHITECTURE');
      const cardInfo = await parseCardDescription(requestData.description.trim());
      
      if (!cardInfo.player || cardInfo.player === 'unknown') {
        errors.push({
          source: 'Text Processing',
          message: 'Could not identify player from the provided description'
        });
        return { errors };
      }
      
      logger.info('NEW ARCHITECTURE text processing successful', { 
        player: cardInfo.player,
        confidence: cardInfo.confidence 
      });
      
      return { cardInfo, errors };
    }
    
    errors.push({
      source: 'Input Validation',
      message: 'No valid input provided'
    });
    
    return { errors };
    
  } catch (error) {
    logger.error('NEW ARCHITECTURE card info extraction failed', error);
    
    errors.push({
      source: requestData.image ? 'Image Processing' : 'Text Processing',
      message: `Processing failed: ${error.message || 'Unknown error'}`
    });
    
    return { errors };
  }
}

async function safeFetchComps(
  cardInfo: ExtractedCardKeywords,
  sources: string[],
  compLogic: string,
  logger: Logger
): Promise<{ response?: ProductionScraperResponse; errors: Array<{ source: string; message: string }> }> {
  const errors: Array<{ source: string; message: string }> = [];
  
  try {
    logger.info('Starting NEW ARCHITECTURE sales data fetch', { 
      player: cardInfo.player,
      keywords: {
        year: cardInfo.year,
        set: cardInfo.set,
        parallels: cardInfo.parallels,
        specialAttributes: cardInfo.specialAttributes
      },
      sources, 
      compLogic 
    });
    
    const response = await fetchProductionComps(cardInfo, sources, compLogic);
    
    if (response.errors && response.errors.length > 0) {
      errors.push(...response.errors);
    }
    
    logger.info('NEW ARCHITECTURE sales data fetch completed', {
      success: response.estimatedValue !== '$0.00',
      compsFound: response.comps?.length || 0,
      estimatedValue: response.estimatedValue,
      architecture: 'Discover-then-Scrape'
    });
    
    return { response, errors };
    
  } catch (error) {
    logger.error('NEW ARCHITECTURE sales data fetch failed', error);
    
    errors.push({
      source: 'Sales Data Fetcher',
      message: `Failed to fetch sales data: ${error.message || 'Unknown error'}`
    });
    
    return { errors };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  const traceId = generateTraceId();
  const logger = new Logger(traceId);
  const startTime = Date.now();
  
  logger.info('NEW ARCHITECTURE Request received', { method: req.method });
  
  try {
    const { data: requestData, errors: validationErrors } = await validateAndParseRequest(req);
    
    if (validationErrors.length > 0) {
      logger.warn('Request validation failed', { errors: validationErrors });
      
      const errorResponse = createErrorResponse(
        'Invalid request',
        traceId,
        validationErrors.map(error => ({ source: 'Request Validation', message: error })),
        'Please check your request parameters and try again'
      );
      
      return createJsonResponse(errorResponse, 400);
    }
    
    logger.info('NEW ARCHITECTURE Request validated successfully', {
      hasImage: !!requestData.image,
      hasDescription: !!requestData.description,
      sources: requestData.sources,
      compLogic: requestData.compLogic
    });
    
    const { cardInfo, errors: cardErrors } = await safeExtractCardInfo(requestData, logger);
    
    if (!cardInfo) {
      logger.warn('NEW ARCHITECTURE Card info extraction failed', { errors: cardErrors });
      
      const errorResponse = createErrorResponse(
        'Unable to extract card information',
        traceId,
        cardErrors,
        'Please try with a clearer image or more detailed description'
      );
      
      return createJsonResponse(errorResponse, 400);
    }
    
    const { response: productionResponse, errors: salesErrors } = await safeFetchComps(
      cardInfo,
      requestData.sources,
      requestData.compLogic,
      logger
    );
    
    const allErrors = [...cardErrors, ...salesErrors];
    
    if (productionResponse) {
      const processingTime = Date.now() - startTime;
      logger.performance('NEW ARCHITECTURE Request completed', processingTime);
      
      const successResponse = createSuccessResponse({
        cardInfo,
        productionResponse,
        estimatedValue: parseFloat(productionResponse.estimatedValue.replace('$', '')),
        confidence: productionResponse.confidence,
        methodology: productionResponse.methodology,
        dataPoints: productionResponse.comps?.length || 0,
        priceRange: productionResponse.comps?.length > 0 ? {
          low: Math.min(...productionResponse.comps.map(c => c.price)),
          high: Math.max(...productionResponse.comps.map(c => c.price))
        } : { low: 0, high: 0 },
        logicUsed: productionResponse.logicUsed,
        exactMatchFound: productionResponse.exactMatchFound,
        matchMessage: productionResponse.matchMessage,
        errors: allErrors,
        warnings: allErrors.length > 0 ? ['Some data sources encountered issues'] : []
      }, traceId);
      
      return createJsonResponse(successResponse, 200);
      
    } else {
      logger.warn('NEW ARCHITECTURE No sales data available', { errors: allErrors });
      
      const errorResponse = createErrorResponse(
        'No sales data available',
        traceId,
        allErrors,
        'Unable to find comparable sales for this card'
      );
      
      if (cardInfo) {
        errorResponse.cardInfo = cardInfo;
      }
      
      return createJsonResponse(errorResponse, 200);
    }
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('NEW ARCHITECTURE Unhandled error in main request handler', error, { processingTime });
    
    const errorResponse = createErrorResponse(
      'An unexpected error occurred',
      traceId,
      [{ source: 'System', message: `Internal processing error: ${error.message}` }],
      'Please try again later'
    );
    
    return createJsonResponse(errorResponse, 500);
  }
});
