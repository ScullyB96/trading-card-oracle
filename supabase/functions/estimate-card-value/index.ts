
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
    const requestData: EstimationRequest = await req.json();
    console.log('Processing estimation request:', {
      hasImage: !!requestData.image,
      hasDescription: !!requestData.description,
      sources: requestData.sources,
      compLogic: requestData.compLogic
    });

    let cardInfo = '';

    // Step 1: Extract card information
    if (requestData.image) {
      console.log('Processing image with Google Vision API...');
      cardInfo = await extractTextFromImage(requestData.image);
    } else if (requestData.description) {
      cardInfo = requestData.description;
    }

    // Step 2: Parse and enhance card information using OpenAI
    console.log('Parsing card information with OpenAI...');
    const parsedCardInfo = await parseCardInformation(cardInfo);

    // Step 3: Search for comparable sales
    console.log('Searching for comparable sales...');
    const salesResults = await searchComparableSales(parsedCardInfo, requestData.sources);

    // Step 4: Calculate estimated value
    const estimatedValue = calculateEstimatedValue(salesResults, requestData.compLogic);

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
    console.error('Error in estimate-card-value function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function extractTextFromImage(base64Image: string): Promise<string> {
  const googleApiKey = Deno.env.get('GOOGLE_API_KEY');
  if (!googleApiKey) {
    throw new Error('Google API key not found');
  }

  // Remove data URL prefix if present
  const imageData = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');

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

  const data = await response.json();
  
  if (data.responses?.[0]?.textAnnotations?.[0]?.description) {
    return data.responses[0].textAnnotations[0].description;
  }
  
  throw new Error('No text detected in image');
}

async function parseCardInformation(rawText: string): Promise<string> {
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not found');
  }

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

  const data = await response.json();
  
  if (data.choices?.[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  
  throw new Error('Failed to parse card information');
}

async function searchComparableSales(cardInfo: string, sources: string[]): Promise<SalesResult[]> {
  // This is a mock implementation. In a real app, you would integrate with actual APIs
  // from eBay, 130point, Goldin, and PWCC
  
  console.log(`Searching for: ${cardInfo} across sources: ${sources.join(', ')}`);
  
  // Simulate different results based on card info and sources
  const mockResults: SalesResult[] = [];
  let idCounter = 1;

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

  return mockResults;
}

function calculateEstimatedValue(salesResults: SalesResult[], compLogic: string): number {
  const selectedResults = salesResults.filter(r => r.selected);
  
  if (selectedResults.length === 0) {
    return 0;
  }

  const prices = selectedResults.map(r => r.price);
  
  switch (compLogic) {
    case 'average3':
      // Take average of up to 3 most recent sales
      const recent3 = prices.slice(0, 3);
      return Math.round((recent3.reduce((sum, price) => sum + price, 0) / recent3.length) * 100) / 100;
    
    case 'median':
      const sorted = [...prices].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 
        ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100
        : sorted[mid];
    
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
      
      return Math.round((mostCommonRange.reduce((sum, price) => sum + price, 0) / mostCommonRange.length) * 100) / 100;
    
    case 'conservative':
      // Take 25th percentile
      const sortedConservative = [...prices].sort((a, b) => a - b);
      const index = Math.floor(sortedConservative.length * 0.25);
      return sortedConservative[index];
    
    default:
      // Default to average
      return Math.round((prices.reduce((sum, price) => sum + price, 0) / prices.length) * 100) / 100;
  }
}
