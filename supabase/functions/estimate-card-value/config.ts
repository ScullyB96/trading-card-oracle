
import { ConfigurationError } from './errors.ts';

// Centralized configuration management with validation
export interface AppConfig {
  googleVisionApiKey: string;
  openaiApiKey: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  timeout: {
    scraping: number;
    total: number;
    request: number;
  };
  limits: {
    maxResults: number;
    maxQueries: number;
    maxPrice: number;
  };
}

export function loadConfiguration(): AppConfig {
  const config: AppConfig = {
    // Match the actual secret names in Supabase
    googleVisionApiKey: Deno.env.get('Google API Key') || '',
    openaiApiKey: Deno.env.get('OPEN AI KEY') || '',
    supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
    supabaseAnonKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
    timeout: {
      scraping: 30000, // 30 seconds
      total: 45000,    // 45 seconds
      request: 10000   // 10 seconds
    },
    limits: {
      maxResults: 50,
      maxQueries: 4,
      maxPrice: 50000
    }
  };

  // Only validate critical configuration - allow some to be missing for graceful degradation
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new ConfigurationError('Missing required Supabase configuration');
  }

  // Log warnings for missing optional configs instead of throwing errors
  if (!config.googleVisionApiKey) {
    console.warn('Google Vision API key not configured - image processing will be disabled');
  }
  
  if (!config.openaiApiKey) {
    console.warn('OpenAI API key not configured - AI features may be limited');
  }

  return config;
}

export const config = loadConfiguration();
