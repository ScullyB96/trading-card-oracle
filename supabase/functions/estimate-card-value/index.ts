// supabase/functions/estimate-card-value/index.ts

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { extractCardInfoFromImage, parseCardDescription, ExtractedCardInfo } from './vision-parser.ts';
import { fetchProductionComps, SearchQuery, ProductionScraperResponse } from './sales-scrapers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ... (keep the rest of the interfaces like EstimationRequest, EstimationResponse)

// Helper function to create a JSON response with CORS headers
function createJsonResponse(data: object, status: number = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

serve(async (req) => {
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    console.log('=== PRODUCTION CARD ESTIMATION START ===');
    const requestData: EstimationRequest = await req.json();
    console.log('=== RECEIVED PAYLOAD ===');
    console.log('Payload summary:', {
      hasImage: !!requestData.image,
      descriptionLength: requestData.description?.length || 0,
      sources: requestData.sources,
      compLogic: requestData.compLogic,
      imageDataLength: requestData.image?.length || 0
    });

    // Input validation
    if (!requestData.sources || requestData.sources.length === 0) {
      return createJsonResponse({ success: false, error: 'No data sources selected', details: 'Please select at least one data source' }, 400);
    }

    const validSources = requestData.sources.filter(s => ['ebay', '130point'].includes(s));
    if (validSources.length === 0) {
      return createJsonResponse({ success: false, error: 'Invalid data sources', details: 'Please select valid data sources (ebay, 130point)' }, 400);
    }
    
    if (!requestData.image && !requestData.description?.trim()) {
      return createJsonResponse({ success: false, error: 'No input provided', details: 'Please provide either an image or a card description' }, 400);
    }
    
    const warnings: string[] = [];
    let cardInfo: ExtractedCardInfo;

    // STEP 1: Extract/Parse Card Information
    console.log('=== STEP 1: CARD INFORMATION EXTRACTION ===');
    try {
      if (requestData.image) {
        cardInfo = await extractCardInfoFromImage(requestData.image);
      } else {
        cardInfo = await parseCardDescription(requestData.description!.trim());
      }
      
      if (!cardInfo.player || cardInfo.player === 'unknown' || cardInfo.player === 'Unknown') {
        return createJsonResponse({ success: false, error: 'Could not identify player', details: 'Unable to extract player name from input. Please try a clearer image or more detailed description.' }, 400);
      }

    } catch (error) {
      console.error('Card parsing failed:', error);
      // You can expand handleParsingError to return the data for createJsonResponse
      return createJsonResponse({ success: false, error: 'Card parsing failed', details: error.message }, 500);
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
      const productionResponse = await fetchProductionComps(searchQuery, validSources, requestData.compLogic);
      const processingTime = Date.now() - startTime;
      console.log(`=== PRODUCTION PROCESSING COMPLETE in ${processingTime}ms ===`);

      // Add warnings
      if (!productionResponse.exactMatchFound) {
        warnings.push(productionResponse.matchMessage || 'No exact matches found');
      }
      if (productionResponse.confidence < 0.5) {
        warnings.push('Lower confidence estimate due to limited matching data');
      }
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
        productionResponse, // You might want to remove this from the final response to reduce payload size
        errors: productionResponse.errors,
        warnings: warnings.length > 0 ? warnings : undefined
      };

      return createJsonResponse(response, 200);

    } catch (error) {
      console.error('Production scraper failed:', error);
      return createJsonResponse({ success: false, error: 'Data scraping failed', details: `Failed to fetch real sales data: ${error.message}` }, 500);
    }

  } catch (error) {
    console.error('=== UNHANDLED ERROR ===', error);
    return createJsonResponse({ success: false, error: 'Unexpected error occurred', details: error.message }, 500);
  }
});