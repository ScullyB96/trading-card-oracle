
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { extractCardInfoFromImage, parseCardDescription, ExtractedCardInfo } from './vision-parser.ts';
import { fetchProductionComps, SearchQuery, ProductionScraperResponse } from './sales-scrapers.ts';
import { 
  CardProcessingError, 
  ImageParsingError, 
  ValidationError, 
  ConfigurationError,
  TimeoutError 
} from './errors.ts';
import { config } from './config.ts';
import { Logger } from './logger.ts';
import { generateTraceId, withTimeout } from './utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

interface EstimationRequest {
  image?: string;
  description?: string;
  sources: string[];
  compLogic: string;
  useProductionScrapers?: boolean;
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
  // Production fields
  exactMatchFound?: boolean;
  matchMessage?: string;
  productionResponse?: ProductionScraperResponse;
  errors?: Array<{
    source: string;
    message: string;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = generateTraceId();
  const logger = new Logger(traceId);
  const startTime = Date.now();
  
  try {
    logger.info('Card estimation request started', {
      operation: 'estimate-card-value',
      method: req.method
    });

    // Parse and validate request
    const requestData = await parseRequest(req, logger);
    
    // Extract card information
    const cardInfo = await extractCardInformation(requestData, logger);
    
    // Build search query
    const searchQuery = buildSearchQuery(cardInfo, logger);
    
    // Fetch comparable sales data
    const productionResponse = await withTimeout(
      fetchProductionComps(searchQuery, requestData.sources, requestData.compLogic),
      config.timeout.total,
      'total-estimation'
    );
    
    // Build final response
    const response = buildSuccessResponse(cardInfo, productionResponse, requestData, traceId);
    
    const processingTime = Date.now() - startTime;
    logger.performance('estimate-card-value', processingTime);
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('Request processing failed', error, { processingTime });
    
    return handleError(error, traceId, processingTime);
  }
});

async function parseRequest(req: Request, logger: Logger): Promise<EstimationRequest> {
  logger.info('Parsing request', { operation: 'parseRequest' });
  
  try {
    const requestData: EstimationRequest = await req.json();
    
    logger.info('Request parsed successfully', {
      operation: 'parseRequest',
      hasImage: !!requestData.image,
      hasDescription: !!requestData.description,
      sources: requestData.sources,
      compLogic: requestData.compLogic
    });

    // Input validation
    if (!requestData.sources || requestData.sources.length === 0) {
      throw new ValidationError('No data sources selected', 'sources');
    }

    // Validate sources
    const validSources = requestData.sources.filter(s => ['ebay', '130point'].includes(s));
    if (validSources.length === 0) {
      throw new ValidationError('Invalid data sources selected', 'sources');
    }

    if (!requestData.image && !requestData.description?.trim()) {
      throw new ValidationError('No input provided', 'input');
    }

    return {
      ...requestData,
      sources: validSources
    };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Invalid request format', 'request');
  }
}

async function extractCardInformation(
  requestData: EstimationRequest, 
  logger: Logger
): Promise<ExtractedCardInfo> {
  logger.info('Starting card information extraction', { 
    operation: 'extractCardInformation',
    method: requestData.image ? 'image' : 'description'
  });

  try {
    let cardInfo: ExtractedCardInfo;

    if (requestData.image) {
      logger.info('Processing image with Vision API', { operation: 'extractCardInformation' });
      cardInfo = await extractCardInfoFromImage(requestData.image);
    } else {
      logger.info('Processing text description', { operation: 'extractCardInformation' });
      cardInfo = await parseCardDescription(requestData.description!.trim());
    }

    // Validate extracted card information
    if (!cardInfo.player || cardInfo.player === 'unknown' || cardInfo.player === 'Unknown') {
      throw new ImageParsingError('Could not identify player from input');
    }

    logger.info('Card information extracted successfully', {
      operation: 'extractCardInformation',
      player: cardInfo.player,
      year: cardInfo.year,
      set: cardInfo.set,
      confidence: cardInfo.confidence
    });

    return cardInfo;

  } catch (error) {
    logger.error('Card information extraction failed', error, { operation: 'extractCardInformation' });
    
    if (error instanceof ImageParsingError) {
      throw error;
    }
    
    // Transform known error types
    if (error.message.includes('Could not extract sufficient text from image')) {
      throw new ImageParsingError('Image quality too poor for text extraction');
    }
    
    if (error.message.includes('BILLING_DISABLED') || error.message.includes('billing to be enabled')) {
      throw new ConfigurationError('Google Vision API billing not enabled');
    }
    
    if (error.message.includes('Cloud Vision API has not been used') || error.message.includes('SERVICE_DISABLED')) {
      throw new ConfigurationError('Google Vision API not enabled');
    }
    
    if (error.message.includes('insufficient_quota') || error.message.includes('exceeded your current quota')) {
      throw new ConfigurationError('OpenAI API quota exceeded');
    }

    throw new ImageParsingError('Failed to extract card information', error.message);
  }
}

function buildSearchQuery(cardInfo: ExtractedCardInfo, logger: Logger): SearchQuery {
  logger.info('Building search query', { operation: 'buildSearchQuery' });
  
  const searchQuery: SearchQuery = {
    player: cardInfo.player,
    year: cardInfo.year,
    set: cardInfo.set,
    cardNumber: cardInfo.cardNumber,
    grade: cardInfo.grade,
    sport: cardInfo.sport
  };

  logger.info('Search query built', {
    operation: 'buildSearchQuery',
    query: searchQuery
  });

  return searchQuery;
}

function buildSuccessResponse(
  cardInfo: ExtractedCardInfo,
  productionResponse: ProductionScraperResponse,
  requestData: EstimationRequest,
  traceId: string
): EstimationResponse {
  const warnings: string[] = [];
  
  // Add warnings based on match quality and errors
  if (!productionResponse.exactMatchFound) {
    warnings.push(productionResponse.matchMessage || 'No exact matches found');
  }
  
  if (productionResponse.confidence < 0.5) {
    warnings.push('Lower confidence estimate due to limited matching data');
  }
  
  // Add source-specific error warnings
  if (productionResponse.errors && productionResponse.errors.length > 0) {
    productionResponse.errors.forEach(error => {
      warnings.push(`${error.source} error: ${error.message}`);
    });
  }
  
  return {
    success: true,
    cardInfo,
    estimatedValue: parseFloat(productionResponse.estimatedValue.replace('$', '')),
    confidence: productionResponse.confidence,
    methodology: productionResponse.methodology,
    dataPoints: productionResponse.comps.length,
    logicUsed: requestData.compLogic,
    exactMatchFound: productionResponse.exactMatchFound,
    matchMessage: productionResponse.matchMessage,
    productionResponse,
    errors: productionResponse.errors,
    warnings: warnings.length > 0 ? warnings : undefined,
    traceId
  };
}

function handleError(error: Error, traceId: string, processingTime: number): Response {
  let statusCode = 500;
  let errorTitle = 'Unexpected error occurred';
  let errorDetails = error.message;
  let errorCode = 'unhandled-error';

  if (error instanceof CardProcessingError) {
    statusCode = error.statusCode;
    errorCode = error.code;
    
    switch (error.name) {
      case 'ValidationError':
        errorTitle = 'Invalid request';
        break;
      case 'ImageParsingError':
        errorTitle = 'Image processing failed';
        if (error.message.includes('Image quality too poor')) {
          errorDetails = 'The image quality is too poor for text extraction. Please try a clearer image or use the "Describe Card" tab instead.';
          errorCode = 'poor-image-quality';
        }
        break;
      case 'ConfigurationError':
        errorTitle = 'Configuration error';
        if (error.message.includes('Google Vision API billing')) {
          errorDetails = 'The Google Vision API requires billing to be enabled. Please enable billing on your Google Cloud project or use the "Describe Card" tab instead.';
          errorCode = 'billing-disabled';
        } else if (error.message.includes('Google Vision API not enabled')) {
          errorDetails = 'The Google Vision API needs to be enabled for your Google Cloud project. Please enable it or use the card description option instead.';
          errorCode = 'vision-api-disabled';
        } else if (error.message.includes('OpenAI API quota')) {
          errorDetails = 'The OpenAI API quota has been exceeded. Please check your OpenAI account billing and usage limits.';
          errorCode = 'openai-quota-exceeded';
        }
        break;
      case 'ScrapingError':
        errorTitle = 'Data scraping failed';
        errorDetails = `Failed to fetch sales data: ${error.message}`;
        errorCode = 'scraping-error';
        break;
      case 'TimeoutError':
        errorTitle = 'Request timeout';
        errorDetails = `The operation timed out while ${error.operation}. Please try again.`;
        errorCode = 'timeout-error';
        statusCode = 408;
        break;
    }
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: errorTitle,
      details: errorDetails,
      traceId: errorCode,
      processingTime
    }),
    {
      status: statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}
