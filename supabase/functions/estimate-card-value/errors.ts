
// Custom error classes for better error handling and debugging
export class CardProcessingError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 500) {
    super(message);
    this.name = 'CardProcessingError';
  }
}

export class CardEstimationError extends CardProcessingError {
  constructor(message: string, code: string, public traceId?: string) {
    super(message, code, 400);
    this.name = 'CardEstimationError';
  }
}

export class ImageParsingError extends CardProcessingError {
  constructor(message: string, public details?: any) {
    super(message, 'IMAGE_PARSING_ERROR', 400);
    this.name = 'ImageParsingError';
  }
}

export class ScrapingError extends CardProcessingError {
  constructor(message: string, public source: string, public details?: any) {
    super(message, 'SCRAPING_ERROR', 500);
    this.name = 'ScrapingError';
  }
}

export class ValidationError extends CardProcessingError {
  constructor(message: string, public field: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class ConfigurationError extends CardProcessingError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', 500);
    this.name = 'ConfigurationError';
  }
}

export class TimeoutError extends CardProcessingError {
  constructor(message: string, public operation: string) {
    super(message, 'TIMEOUT_ERROR', 408);
    this.name = 'TimeoutError';
  }
}

export function handleError(error: any, traceId: string, logger?: any) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (logger) {
    logger.error('Request failed', error, { traceId });
  }

  // Handle specific error types
  if (error instanceof CardEstimationError) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      code: error.code,
      traceId: error.traceId || traceId
    }), {
      status: error.statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  if (error instanceof CardProcessingError) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      code: error.code,
      traceId
    }), {
      status: error.statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Handle generic errors
  return new Response(JSON.stringify({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    traceId
  }), {
    status: 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
