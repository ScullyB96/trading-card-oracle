
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { extractCardInfoFromImage, parseCardDescription, ExtractedCardInfo } from './vision-parser.ts';
import { fetchProductionComps, SearchQuery, ProductionScraperResponse } from './sales-scrapers.ts';
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
  cardInfo?: ExtractedCardInfo;
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
    
    // Validate sources
    if (!requestData.sources || requestData.sources.length === 0) {
      errors.push('No data sources selected');
    } else {
      const validSources = requestData.sources.filter(s => ['ebay', '130point'].includes(s));
      if (validSources.length === 0) {
        errors.push('Invalid data sources provided');
      }
      requestData.sources = validSources;
    }
    
    // Validate input
    if (!requestData.image && !requestData.description?.trim()) {
      errors.push('No input provided - either image or description is required');
    }
    
    // Validate comp logic
    if (!requestData.compLogic) {
      requestData.compLogic = 'average3'; // Default fallback
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
): Promise<{ cardInfo?: ExtractedCardInfo; errors: Array<{ source: string; message: string }> }> {
  const errors: Array<{ source: string; message: string }> = [];
  
  try {
    if (requestData.image) {
      // Check API availability
      if (!config.googleVisionApiKey) {
        errors.push({
          source: 'Google Vision API',
          message: 'Image processing is not available - API key not configured'
        });
        return { errors };
      }
      
      logger.info('Processing image with Vision API');
      const cardInfo = await extractCardInfoFromImage(requestData.image);
      
      if (!cardInfo.player || cardInfo.player === 'unknown') {
        errors.push({
          source: 'Image Processing',
          message: 'Could not identify player from the provided image'
        });
        return { errors };
      }
      
      logger.info('Image processing successful', { 
        player: cardInfo.player,
        confidence: cardInfo.confidence 
      });
      
      return { cardInfo, errors };
      
    } else if (requestData.description?.trim()) {
      logger.info('Processing text description');
      const cardInfo = await parseCardDescription(requestData.description.trim());
      
      if (!cardInfo.player || cardInfo.player === 'unknown') {
        errors.push({
          source: 'Text Processing',
          message: 'Could not identify player from the provided description'
        });
        return { errors };
      }
      
      logger.info('Text processing successful', { 
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
    logger.error('Card info extraction failed', error);
    
    errors.push({
      source: requestData.image ? 'Image Processing' : 'Text Processing',
      message: `Processing failed: ${error.message || 'Unknown error'}`
    });
    
    return { errors };
  }
}

async function safeFetchComps(
  cardInfo: ExtractedCardInfo,
  sources: string[],
  compLogic: string,
  logger: Logger
): Promise<{ response?: ProductionScraperResponse; errors: Array<{ source: string; message: string }> }> {
  const errors: Array<{ source: string; message: string }> = [];
  
  try {
    const searchQuery: SearchQuery = {
      player: cardInfo.player,
      year: cardInfo.year,
      set: cardInfo.set,
      cardNumber: cardInfo.cardNumber,
      grade: cardInfo.grade,
      sport: cardInfo.sport
    };
    
    logger.info('Starting sales data fetch', { searchQuery, sources, compLogic });
    
    const response = await fetchProductionComps(searchQuery, sources, compLogic);
    
    // Collect any errors from the scraping process
    if (response.errors && response.errors.length > 0) {
      errors.push(...response.errors);
    }
    
    logger.info('Sales data fetch completed', {
      success: response.estimatedValue !== '$0.00',
      compsFound: response.comps?.length || 0,
      estimatedValue: response.estimatedValue
    });
    
    return { response, errors };
    
  } catch (error) {
    logger.error('Sales data fetch failed', error);
    
    errors.push({
      source: 'Sales Data Fetcher',
      message: `Failed to fetch sales data: ${error.message || 'Unknown error'}`
    });
    
    return { errors };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  const traceId = generateTraceId();
  const logger = new Logger(traceId);
  const startTime = Date.now();
  
  logger.info('Request received', { method: req.method });
  
  try {
    // Step 1: Validate and parse request
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
    
    logger.info('Request validated successfully', {
      hasImage: !!requestData.image,
      hasDescription: !!requestData.description,
      sources: requestData.sources,
      compLogic: requestData.compLogic
    });
    
    // Step 2: Extract card information
    const { cardInfo, errors: cardErrors } = await safeExtractCardInfo(requestData, logger);
    
    if (!cardInfo) {
      logger.warn('Card info extraction failed', { errors: cardErrors });
      
      const errorResponse = createErrorResponse(
        'Unable to extract card information',
        traceId,
        cardErrors,
        'Please try with a clearer image or more detailed description'
      );
      
      return createJsonResponse(errorResponse, 400);
    }
    
    // Step 3: Fetch sales comparables
    const { response: productionResponse, errors: salesErrors } = await safeFetchComps(
      cardInfo,
      requestData.sources,
      requestData.compLogic,
      logger
    );
    
    // Collect all errors
    const allErrors = [...cardErrors, ...salesErrors];
    
    // Step 4: Build final response
    if (productionResponse) {
      // We have sales data - create success response
      const processingTime = Date.now() - startTime;
      logger.performance('Request completed', processingTime);
      
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
      // No sales data but we should still return a structured response
      logger.warn('No sales data available', { errors: allErrors });
      
      const errorResponse = createErrorResponse(
        'No sales data available',
        traceId,
        allErrors,
        'Unable to find comparable sales for this card'
      );
      
      // Include card info if we have it
      if (cardInfo) {
        errorResponse.cardInfo = cardInfo;
      }
      
      return createJsonResponse(errorResponse, 200);
    }
    
  } catch (error) {
    // Final safety net - should never reach here with proper error handling above
    const processingTime = Date.now() - startTime;
    logger.error('Unhandled error in main request handler', error, { processingTime });
    
    const errorResponse = createErrorResponse(
      'An unexpected error occurred',
      traceId,
      [{ source: 'System', message: `Internal processing error: ${error.message}` }],
      'Please try again later'
    );
    
    return createJsonResponse(errorResponse, 500);
  }
});
