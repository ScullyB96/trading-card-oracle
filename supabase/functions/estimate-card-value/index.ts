
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
  useProductionScrapers?: boolean; // New flag to enable production scrapers
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
  // New production fields
  exactMatchFound?: boolean;
  matchMessage?: string;
  productionResponse?: ProductionScraperResponse;
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

    // STEP 2: Choose scraping method
    console.log('=== STEP 2: CHOOSING SCRAPING METHOD ===');
    
    if (requestData.useProductionScrapers) {
      console.log('Using PRODUCTION SCRAPERS');
      
      try {
        const productionResponse = await fetchProductionComps(
          searchQuery,
          requestData.sources,
          requestData.compLogic
        );
        
        const processingTime = Date.now() - startTime;
        console.log(`=== PRODUCTION PROCESSING COMPLETE in ${processingTime}ms ===`);
        
        // Add warnings based on match quality
        if (!productionResponse.exactMatchFound) {
          warnings.push(productionResponse.matchMessage || 'No exact matches found');
        }
        
        if (productionResponse.confidence < 0.5) {
          warnings.push('Lower confidence estimate due to limited matching data');
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
        warnings.push('Production scrapers failed, falling back to legacy system');
        // Fall through to legacy system
      }
    }

    // STEP 2 (Legacy): Fetch Real Sales Data
    console.log('=== STEP 2: REAL SALES DATA FETCH (LEGACY) ===');
    let salesResults: SalesResult[];
    
    try {
      salesResults = await fetchRealSalesData(searchQuery, requestData.sources);
      console.log(`Found ${salesResults.length} total sales results`);
      
      if (salesResults.length === 0) {
        // Try broader search without card number or grade
        console.log('No exact matches, trying broader search...');
        const broaderQuery = {
          ...searchQuery,
          cardNumber: '',
          grade: undefined
        };
        
        salesResults = await fetchRealSalesData(broaderQuery, requestData.sources);
        
        if (salesResults.length > 0) {
          warnings.push(`No exact matches found. Showing ${salesResults.length} similar cards. Results may be less accurate.`);
        } else {
          warnings.push('No sales data found for this card. This may be a rare or recently released card.');
        }
      }
      
    } catch (error) {
      console.error('Sales data fetch failed:', error);
      return errorResponse('Sales data fetch failed', error.message, 500, 'sales-fetch-error');
    }

    // STEP 3: Calculate Estimated Value
    console.log('=== STEP 3: VALUE CALCULATION ===');
    let calculationResult: CalculationResult;
    
    try {
      // Mark all results as selected by default
      const salesWithSelection = salesResults.map(result => ({
        ...result,
        selected: true
      }));
      
      calculationResult = calculateEstimatedValue(
        salesWithSelection,
        requestData.compLogic,
        cardInfo.confidence
      );
      
      console.log('Calculation result:', calculationResult);
      
      // Add price consistency warnings
      const consistencyWarnings = validatePriceConsistency(salesWithSelection);
      warnings.push(...consistencyWarnings);
      
    } catch (error) {
      console.error('Value calculation failed:', error);
      return errorResponse('Value calculation failed', error.message, 500, 'calculation-error');
    }

    // STEP 4: Final Quality Checks
    console.log('=== STEP 4: QUALITY VALIDATION ===');
    
    // Check for very low match scores
    const avgMatchScore = salesResults.reduce((sum, r) => sum + (r.matchScore || 0), 0) / Math.max(1, salesResults.length);
    if (avgMatchScore < 0.3) {
      warnings.push('Low similarity between search and found results. Consider refining your search.');
    }
    
    // Check for stale data
    const recentSales = salesResults.filter(r => {
      const daysSince = (Date.now() - new Date(r.date).getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 90;
    });
    
    if (recentSales.length < salesResults.length / 2) {
      warnings.push('Many results are from older sales. Current market value may differ.');
    }

    const processingTime = Date.now() - startTime;
    console.log(`=== PROCESSING COMPLETE in ${processingTime}ms ===`);

    const response: EstimationResponse = {
      success: true,
      cardInfo,
      salesResults: salesResults.map(r => ({ ...r, selected: true })),
      estimatedValue: calculationResult.estimatedValue,
      confidence: calculationResult.confidence,
      methodology: calculationResult.methodology,
      dataPoints: calculationResult.dataPoints,
      priceRange: calculationResult.priceRange,
      logicUsed: requestData.compLogic,
      warnings: warnings.length > 0 ? warnings : undefined
    };

    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

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
