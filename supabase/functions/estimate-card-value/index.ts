import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? ''
);

interface EstimationRequest {
  image?: string; // base64 encoded image
  description?: string;
  sources: string[];
  compLogic: string;
}

interface SalesResult {
  id: string;
  title: string;
  price: number;
  date: string;
  source: string;
  url: string;
  thumbnail?: string;
  selected: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== EDGE FUNCTION START ===');
    console.log('Request method:', req.method);
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));

    const requestData: EstimationRequest = await req.json();
    console.log('=== RECEIVED PAYLOAD ===');
    console.log('Full payload:', {
      hasImage: !!requestData.image,
      hasDescription: !!requestData.description,
      descriptionLength: requestData.description?.length || 0,
      sources: requestData.sources,
      compLogic: requestData.compLogic,
      imageLength: requestData.image?.length || 0
    });

    // Validate required fields
    if (!requestData.sources || requestData.sources.length === 0) {
      console.error('No sources provided');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No data sources selected',
          details: 'Please select at least one data source'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!requestData.image && !requestData.description?.trim()) {
      console.error('No input provided - neither image nor description');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No input provided',
          details: 'Please provide either an image or a card description'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let cardInfo = '';

    // Step 1: Extract card information
    if (requestData.image) {
      console.log('=== PROCESSING IMAGE ===');
      try {
        cardInfo = await extractTextFromImage(requestData.image);
        console.log('Extracted text:', cardInfo);
      } catch (error) {
        console.error('Image processing failed:', error);
        
        // If Google Vision API is not enabled, provide helpful error message
        if (error.message.includes('Cloud Vision API has not been used') || error.message.includes('SERVICE_DISABLED')) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Google Vision API not enabled',
              details: 'The Google Vision API needs to be enabled for your Google Cloud project. Please enable it at: https://console.developers.google.com/apis/api/vision.googleapis.com/overview or use the card description option instead.',
              suggestion: 'Try using the "Describe Card" tab instead of uploading an image.',
              traceId: 'vision-api-disabled'
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Image processing failed',
            details: error.message,
            suggestion: 'Try using the "Describe Card" tab instead of uploading an image.',
            traceId: 'image-processing-error'
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    } else if (requestData.description?.trim()) {
      console.log('=== USING DESCRIPTION ===');
      cardInfo = requestData.description.trim();
      console.log('Card description:', cardInfo);
    }

    // Step 2: Parse and enhance card information using OpenAI
    console.log('=== PARSING CARD INFO ===');
    let parsedCardInfo;
    try {
      parsedCardInfo = await parseCardInformation(cardInfo);
      console.log('Parsed card info:', parsedCardInfo);
    } catch (error) {
      console.error('Card parsing failed:', error);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Card information parsing failed',
          details: error.message,
          traceId: 'card-parsing-error'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 3: Search for comparable sales
    console.log('=== SEARCHING SALES ===');
    let salesResults;
    try {
      salesResults = await searchComparableSales(parsedCardInfo, requestData.sources);
      console.log('Found sales results:', salesResults.length);
    } catch (error) {
      console.error('Sales search failed:', error);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Sales data search failed',
          details: error.message,
          traceId: 'sales-search-error'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 4: Calculate estimated value
    console.log('=== CALCULATING VALUE ===');
    let estimatedValue;
    try {
      estimatedValue = calculateEstimatedValue(salesResults, requestData.compLogic);
      console.log('Calculated value:', estimatedValue);
    } catch (error) {
      console.error('Value calculation failed:', error);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Value calculation failed',
          details: error.message,
          traceId: 'value-calculation-error'
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('=== SUCCESS ===');
    return new Response(
      JSON.stringify({
        success: true,
        cardInfo: parsedCardInfo,
        salesResults,
        estimatedValue
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('=== UNHANDLED ERROR ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: 'An unexpected error occurred',
        details: error.message,
        traceId: 'unhandled-error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function extractTextFromImage(base64Image: string): Promise<string> {
  console.log('=== EXTRACT TEXT FROM IMAGE ===');
  
  // Try multiple possible environment variable names for Google API key
  const googleApiKey = Deno.env.get('GOOGLE_API_KEY') || 
                      Deno.env.get('Google API Key') || 
                      Deno.env.get('GOOGLE_CLOUD_API_KEY');
  
  console.log('Available env vars:', Object.keys(Deno.env.toObject()));
  console.log('Google API key found:', !!googleApiKey);
  
  if (!googleApiKey) {
    throw new Error('Google API key not found in environment variables. Please set the "Google API Key" secret in your Supabase project settings.');
  }

  try {
    // Remove data URL prefix if present
    const imageData = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
    console.log('Image data length after cleanup:', imageData.length);

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              image: {
                content: imageData
              },
              features: [
                {
                  type: 'TEXT_DETECTION',
                  maxResults: 10
                }
              ]
            }
          ]
        })
      }
    );

    console.log('Google Vision API response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Vision API error response:', errorText);
      
      // Parse the error to provide more specific messages
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error?.message?.includes('Cloud Vision API has not been used')) {
          throw new Error('Cloud Vision API has not been used in project before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/vision.googleapis.com/overview then retry. If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry.');
        }
      } catch (parseError) {
        // If we can't parse the error, use the original message
      }
      
      throw new Error(`Google Vision API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Google Vision API response data keys:', Object.keys(data));
    
    if (data.responses?.[0]?.textAnnotations?.[0]?.description) {
      return data.responses[0].textAnnotations[0].description;
    }
    
    if (data.responses?.[0]?.error) {
      throw new Error(`Google Vision API error: ${data.responses[0].error.message}`);
    }
    
    throw new Error('No text detected in image');
  } catch (error) {
    console.error('Vision API request failed:', error);
    throw error;
  }
}

async function parseCardInformation(rawText: string): Promise<string> {
  console.log('=== PARSE CARD INFORMATION ===');
  
  // Try multiple possible environment variable names for OpenAI API key
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY') || 
                       Deno.env.get('OPEN AI KEY') || 
                       Deno.env.get('OPENAI_KEY');
  
  console.log('OpenAI API key found:', !!openaiApiKey);
  
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not found in environment variables');
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert trading card analyzer. Parse the following text and extract key information about the trading card. Return a structured description that includes:
            - Player name
            - Year and brand/set
            - Card number
            - Type (rookie, parallel, base, etc.)
            - Condition/grade if mentioned
            - Sport
            
            Format the response as a clear, searchable description that would be useful for finding comparable sales.`
          },
          {
            role: 'user',
            content: rawText
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      }),
    });

    console.log('OpenAI API response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error response:', errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('OpenAI API response data keys:', Object.keys(data));
    
    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    
    throw new Error('Failed to parse card information - no content in response');
  } catch (error) {
    console.error('OpenAI API request failed:', error);
    throw error;
  }
}

async function searchComparableSales(cardInfo: string, sources: string[]): Promise<SalesResult[]> {
  console.log('=== SEARCH COMPARABLE SALES ===');
  console.log(`Searching for: ${cardInfo} across sources: ${sources.join(', ')}`);
  
  // This is a mock implementation. In a real app, you would integrate with actual APIs
  // from eBay, 130point, Goldin, and PWCC
  
  const mockResults: SalesResult[] = [];
  let idCounter = 1;

  try {
    if (sources.includes('ebay')) {
      mockResults.push({
        id: (idCounter++).toString(),
        title: `${cardInfo} - eBay Sale`,
        price: Math.floor(Math.random() * 200) + 50,
        date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        source: 'eBay',
        url: 'https://ebay.com/itm/123456789',
        selected: true
      });
    }

    if (sources.includes('130point')) {
      mockResults.push({
        id: (idCounter++).toString(),
        title: `${cardInfo} - 130point Auction`,
        price: Math.floor(Math.random() * 250) + 75,
        date: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        source: '130point',
        url: 'https://130point.com/sales/123456',
        selected: true
      });
    }

    if (sources.includes('goldin')) {
      mockResults.push({
        id: (idCounter++).toString(),
        title: `${cardInfo} - Goldin Auction`,
        price: Math.floor(Math.random() * 300) + 100,
        date: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        source: 'Goldin',
        url: 'https://goldin.co/lot/123456',
        selected: true
      });
    }

    if (sources.includes('pwcc')) {
      mockResults.push({
        id: (idCounter++).toString(),
        title: `${cardInfo} - PWCC Marketplace`,
        price: Math.floor(Math.random() * 180) + 60,
        date: new Date(Date.now() - Math.random() * 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        source: 'PWCC',
        url: 'https://pwccmarketplace.com/lot/123456',
        selected: true
      });
    }

    console.log(`Generated ${mockResults.length} mock sales results`);
    return mockResults;
  } catch (error) {
    console.error('Error generating mock sales data:', error);
    throw error;
  }
}

function calculateEstimatedValue(salesResults: SalesResult[], compLogic: string): number {
  console.log('=== CALCULATE ESTIMATED VALUE ===');
  console.log(`Calculation logic: ${compLogic}`);
  
  const selectedResults = salesResults.filter(r => r.selected);
  console.log(`Selected results: ${selectedResults.length}`);
  
  if (selectedResults.length === 0) {
    console.log('No selected results, returning 0');
    return 0;
  }

  const prices = selectedResults.map(r => r.price);
  console.log('Prices:', prices);
  
  let result = 0;
  
  try {
    switch (compLogic) {
      case 'average3':
        // Take average of up to 3 most recent sales
        const recent3 = prices.slice(0, 3);
        result = Math.round((recent3.reduce((sum, price) => sum + price, 0) / recent3.length) * 100) / 100;
        break;
      
      case 'median':
        const sorted = [...prices].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        result = sorted.length % 2 === 0 
          ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100
          : sorted[mid];
        break;
      
      case 'mode':
        // Find most common price range (within $10)
        const ranges: { [key: string]: number[] } = {};
        prices.forEach(price => {
          const range = Math.floor(price / 10) * 10;
          if (!ranges[range]) ranges[range] = [];
          ranges[range].push(price);
        });
        
        const mostCommonRange = Object.values(ranges).reduce((max, current) => 
          current.length > max.length ? current : max
        );
        
        result = Math.round((mostCommonRange.reduce((sum, price) => sum + price, 0) / mostCommonRange.length) * 100) / 100;
        break;
      
      case 'conservative':
        // Take 25th percentile
        const sortedConservative = [...prices].sort((a, b) => a - b);
        const index = Math.floor(sortedConservative.length * 0.25);
        result = sortedConservative[index];
        break;
      
      default:
        // Default to average
        result = Math.round((prices.reduce((sum, price) => sum + price, 0) / prices.length) * 100) / 100;
        break;
    }
    
    console.log(`Calculated value: ${result}`);
    return result;
  } catch (error) {
    console.error('Error in value calculation:', error);
    throw error;
  }
}
