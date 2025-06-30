
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
    googleVisionApiKey: Deno.env.get('GOOGLE_API_KEY') || '',
    openaiApiKey: Deno.env.get('OPENAI_API_KEY') || '',
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

  // Validate required configuration
  const requiredFields: Array<keyof AppConfig> = ['googleVisionApiKey', 'openaiApiKey', 'supabaseUrl', 'supabaseAnonKey'];
  
  for (const field of requiredFields) {
    if (!config[field]) {
      throw new ConfigurationError(`Missing required configuration: ${field}`);
    }
  }

  return config;
}

export const config = loadConfiguration();
