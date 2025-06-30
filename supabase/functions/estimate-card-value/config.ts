
import { ConfigurationError } from './errors.ts';

// Centralized configuration management with validation
export interface AppConfig {
  googleVisionApiKey: string;
  openaiApiKey: string;
  googleSearchApiKey: string;
  googleSearchEngineId: string;
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
    // Match the actual secret names in Supabase
    googleVisionApiKey: Deno.env.get('Google API Key') || '',
    openaiApiKey: Deno.env.get('OPEN AI KEY') || '',
    googleSearchApiKey: Deno.env.get('Google Search API Key') || '',
    googleSearchEngineId: Deno.env.get('Google Search ENGINE ID') || '',
    supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
    supabaseAnonKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
    timeout: {
      scraping: 30000, // 30 seconds
      total: 60000,    // 60 seconds (increased for search+scraping)
      request: 15000,  // 15 seconds
      search: 10000    // 10 seconds for search requests
    },
    limits: {
      maxResults: 50,
      maxQueries: 6,   // Increased for search-driven approach
      maxPrice: 50000,
      maxSearchResults: 20
    },
    search: {
      enabled: true,
      fallbackToDirectScraping: true,
      maxSearchQueries: 3
    }
  };

  // Only validate critical configuration - allow some to be missing for graceful degradation
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new ConfigurationError('Missing required Supabase configuration');
  }

  if (!config.googleSearchApiKey || !config.googleSearchEngineId) {
    throw new ConfigurationError('Missing required Google Search configuration');
  }

  // Log confirmation for successful configurations instead of warnings
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

  if (config.googleSearchApiKey) {
    console.log('✅ Google Search API configured successfully - enhanced discovery enabled');
  } else {
    console.warn('Google Search API key not configured - search-driven discovery will be disabled');
  }

  return config;
}

export const config = loadConfiguration();
