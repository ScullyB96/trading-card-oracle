import { ConfigurationError } from './errors.ts';

// **CENTRALIZED CORS HEADERS**
// This is the definitive set of headers to allow requests from your web app.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Centralized configuration management with validation
export interface AppConfig {
  openaiApiKey: string;
  ebayAppId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export function loadConfiguration(): AppConfig {
  const config: AppConfig = {
    openaiApiKey: Deno.env.get("OPENAI_API_KEY") || "",
    ebayAppId: Deno.env.get("EBAY_APP_ID") || "",
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") || "",
  };

  // The function will fail gracefully if keys are missing, but we'll log warnings.
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error("CRITICAL: Missing Supabase configuration.");
    throw new ConfigurationError("Missing required Supabase configuration");
  }

  if (!config.openaiApiKey) {
    console.warn('⚠️ OpenAI API key not configured - AI features will be disabled.');
  } else {
    console.log('✅ OpenAI API configured successfully');
  }

  if (!config.ebayAppId) {
    console.warn('⚠️ eBay App ID not configured - eBay Finding API will be disabled.');
  } else {
    console.log('✅ eBay Finding API configured successfully');
  }

  return config;
}

export const config = loadConfiguration();
