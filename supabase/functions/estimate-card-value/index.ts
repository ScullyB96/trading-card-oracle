
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { extractCardInfoFromImage, parseCardDescription, ExtractedCardInfo } from './vision-parser.ts';
import { fetchRealSalesData, fetchProductionComps, SalesResult, SearchQuery, ProductionScraperResponse } from './sales-scrapers.ts';
import { calculateEstimatedValue, validatePriceConsistency, CalculationResult } from './value-calculator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? ''
);

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
  salesResults?: SalesResult[];
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

  const startTime = Date.now();
  
  try {
    console.log('=== PRODUCTION CARD ESTIMATION START ===');
    console.log('Request method:', req.method);

    const requestData: EstimationRequest = await req.json();
    console.log('=== RECEIVED PAYLOAD ===');
    console.log('Payload summary:', {
      hasImage: !!requestData.image,
      hasDescription: !!requestData.description,
      descriptionLength: requestData.description?.length || 0,
      sources: requestData.sources,
      compLogic: requestData.compLogic,
      useProductionScrapers: requestData.useProductionScrapers,
      imageDataLength: requestData.image?.length || 0
    });

    // Input validation
    if (!requestData.sources || requestData.sources.length === 0) {
      return errorResponse('No data sources selected', 'Please select at least one data source', 400);
    }

    // Validate sources
    const validSources = requestData.sources.filter(s => ['ebay', '130point'].includes(s));
    if (validSources.length === 0) {
      return errorResponse('Invalid data sources', 'Please select valid data sources (ebay, 130point)', 400);
    }

    if (!requestData.image && !requestData.description?.trim()) {
      return errorResponse('No input provided', 'Please provide either an image or a card description', 400);
    }

    const warnings: string[] = [];
    let cardInfo: ExtractedCardInfo;

    // STEP 1: Extract/Parse Card Information
    console.log('=== STEP 1: CARD INFORMATION EXTRACTION ===');
    try {
      if (requestData.image) {
        console.log('Processing image with Vision API');
        cardInfo = await extractCardInfoFromImage(requestData.image);
        console.log('Extracted card info:', cardInfo);
        
        if (cardInfo.confidence < 0.6) {
          warnings.push(`Low confidence in image parsing (${Math.round(cardInfo.confidence * 100)}%). Results may be less accurate.`);
        }
      } else {
        console.log('Processing text description');
        cardInfo = await parseCardDescription(requestData.description!.trim());
        console.log('Parsed card info:', cardInfo);
      }
      
      if (!cardInfo.player || cardInfo.player === 'Unknown') {
        return errorResponse('Could not identify player', 'Unable to extract player name from input. Please try a clearer image or more detailed description.', 400);
      }
      
    } catch (error) {
      console.error('Card parsing failed:', error);
      return handleParsingError(error);
    }

    const searchQuery: SearchQuery = {
      player: cardInfo.player,
      year: cardInfo.year,
      set: cardInfo.set,
      cardNumber: cardInfo.cardNumber,
      grade: cardInfo.grade,
      sport: cardInfo.sport
    };

    // STEP 2: Use Production Scrapers (Real Data Only)
    console.log('=== STEP 2: PRODUCTION SCRAPING (REAL DATA ONLY) ===');
    
    try {
      const productionResponse = await fetchProductionComps(
        searchQuery,
        validSources,
        requestData.compLogic
      );
      
      const processingTime = Date.now() - startTime;
      console.log(`=== PRODUCTION PROCESSING COMPLETE in ${processingTime}ms ===`);
      
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
      
      const response: EstimationResponse = {
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
        warnings: warnings.length > 0 ? warnings : undefined
      };

      return new Response(
        JSON.stringify(response),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
      
    } catch (error) {
      console.error('Production scraper failed:', error);
      return errorResponse(
        'Data scraping failed', 
        `Failed to fetch real sales data: ${error.message}`, 
        500, 
        'scraping-error'
      );
    }

  } catch (error) {
    console.error('=== UNHANDLED ERROR ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return errorResponse('Unexpected error occurred', error.message, 500, 'unhandled-error');
  }
});

function errorResponse(error: string, details: string, status: number, traceId?: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error,
      details,
      traceId
    }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

function handleParsingError(error: any): Response {
  if (error.message.includes('BILLING_DISABLED') || error.message.includes('billing to be enabled')) {
    return errorResponse(
      'Google Vision API billing not enabled',
      'The Google Vision API requires billing to be enabled. Please enable billing on your Google Cloud project or use the "Describe Card" tab instead.',
      400,
      'billing-disabled'
    );
  }

  if (error.message.includes('Cloud Vision API has not been used') || error.message.includes('SERVICE_DISABLED')) {
    return errorResponse(
      'Google Vision API not enabled',
      'The Google Vision API needs to be enabled for your Google Cloud project. Please enable it or use the card description option instead.',
      400,
      'vision-api-disabled'
    );
  }

  if (error.message.includes('insufficient_quota') || error.message.includes('exceeded your current quota')) {
    return errorResponse(
      'OpenAI API quota exceeded',
      'The OpenAI API quota has been exceeded. Please check your OpenAI account billing and usage limits.',
      400,
      'openai-quota-exceeded'
    );
  }

  return errorResponse(
    'Card information parsing failed',
    error.message,
    500,
    'parsing-error'
  );
}
