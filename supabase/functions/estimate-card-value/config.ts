
import { ConfigurationError } from './errors.ts';

// Centralized configuration management with validation
export interface AppConfig {
  googleVisionApiKey: string;
  openaiApiKey: string;
  googleSearchApiKey: string;
  googleSearchEngineId: string;
  ebayAppId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  timeout: {
    scraping: number;
    total: number;
    request: number;
    search: number;
  };
  limits: {
    maxResults: number;
    maxQueries: number;
    maxPrice: number;
    maxSearchResults: number;
  };
  search: {
    enabled: boolean;
    fallbackToDirectScraping: boolean;
    maxSearchQueries: number;
  };
}

export function loadConfiguration(): AppConfig {
  const config: AppConfig = {
    googleVisionApiKey: Deno.env.get("GOOGLE_VISION_API_KEY") || "",
    openaiApiKey: Deno.env.get("OPENAI_API_KEY") || "",
    googleSearchApiKey: Deno.env.get("GOOGLE_SEARCH_API_KEY") || "",
    googleSearchEngineId: Deno.env.get("GOOGLE_SEARCH_ENGINE_ID") || "",
    ebayAppId: Deno.env.get("EBAY_APP_ID") || "",
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") || "",
    timeout: {
      scraping: 30000,
      total: 60000,
      request: 15000,
      search: 10000,
    },
    limits: {
      maxResults: 50,
      maxQueries: 6,
      maxPrice: 50000,
      maxSearchResults: 20,
    },
    search: {
      enabled: true,
      fallbackToDirectScraping: true,
      maxSearchQueries: 3,
    },
  };

  if (!config.supabaseUrl || !config.supabaseAnonKey || !config.googleSearchApiKey || !config.googleSearchEngineId) {
    throw new ConfigurationError("Missing required Supabase or Google Search configuration");
  }
  
  if (config.googleVisionApiKey) {
    console.log('✅ Google Vision API configured successfully');
  } else {
    console.warn('Google Vision API key not configured - image processing will be disabled');
  }
  
  if (config.openaiApiKey) {
    console.log('✅ OpenAI API configured successfully');
  } else {
    console.warn('OpenAI API key not configured - AI features may be limited');
  }

  if (config.ebayAppId) {
    console.log('✅ eBay Finding API configured successfully');
  } else {
    console.warn('eBay App ID not configured - eBay Finding API will be disabled');
  }

  return config;
}

export const config = loadConfiguration();

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
