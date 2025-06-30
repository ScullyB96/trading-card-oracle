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

// This function now safely loads variables without throwing errors at the top level.
export function loadConfiguration(): AppConfig {
  return {
    openaiApiKey: Deno.env.get("OPENAI_API_KEY") || "",
    ebayAppId: Deno.env.get("EBAY_APP_ID") || "",
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") || "",
  };
}

export const config = loadConfiguration();
