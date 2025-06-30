import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { extractCardInfoFromImage, parseCardDescription, ExtractedCardInfo } from './vision-parser.ts';
import { fetchProductionComps, SearchQuery, ProductionScraperResponse } from './sales-scrapers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Interfaces (keep your existing interfaces here) ---
interface EstimationRequest {
  image?: string;
  description?: string;
  sources: string[];
  compLogic: string;
}

interface EstimationResponse {
  success: boolean;
  cardInfo?: ExtractedCardInfo;
  salesResults?: any[]; // Use a more specific type if available
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

// --- Helper Function to create a JSON response with CORS headers ---
function createJsonResponse(data: object, status: number = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: status,
  });
}


serve(async (req) => {
  // --- This is the crucial part for fixing the CORS error ---
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  const startTime = Date.now();
  
  try {
    const requestData: EstimationRequest = await req.json();

    // Input validation
    if (!requestData.sources || requestData.sources.length === 0) {
      return createJsonResponse({ success: false, error: 'No data sources selected' }, 400);
    }
    const validSources = requestData.sources.filter(s => ['ebay', '130point'].includes(s));
    if (validSources.length === 0) {
      return createJsonResponse({ success: false, error: 'Invalid data sources' }, 400);
    }
    if (!requestData.image && !requestData.description?.trim()) {
      return createJsonResponse({ success: false, error: 'No input provided' }, 400);
    }

    let cardInfo: ExtractedCardInfo;

    // STEP 1: Extract/Parse Card Information
    try {
      if (requestData.image) {
        cardInfo = await extractCardInfoFromImage(requestData.image);
      } else {
        cardInfo = await parseCardDescription(requestData.description!.trim());
      }
      if (!cardInfo.player || cardInfo.player === 'unknown') {
        return createJsonResponse({ success: false, error: 'Could not identify player from the provided input.' }, 400);
      }
    } catch (error) {
       return createJsonResponse({ success: false, error: `Card Parsing Failed: ${error.message}` }, 500);
    }

    const searchQuery: SearchQuery = {
      player: cardInfo.player,
      year: cardInfo.year,
      set: cardInfo.set,
      cardNumber: cardInfo.cardNumber,
      grade: cardInfo.grade,
      sport: cardInfo.sport
    };

    // STEP 2: Fetch and process sales data
    const productionResponse = await fetchProductionComps(
      searchQuery,
      validSources,
      requestData.compLogic
    );
    
    // Final successful response
    return createJsonResponse({ success: true, ...productionResponse }, 200);

  } catch (error) {
    console.error('=== UNHANDLED ERROR ===', error);
    return createJsonResponse({ success: false, error: 'An unexpected error occurred.', details: error.message }, 500);
  }
});