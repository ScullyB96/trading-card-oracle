import { corsHeaders } from './config.ts'; // This import is now safe.

// A simpler, more focused set of custom errors for the new architecture.
export class CardProcessingError extends Error {
  constructor(public message: string, public code: string, public statusCode: number = 500) {
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

// Centralized error handler to ensure all responses are CORS-compliant.
export function handleError(error: any, traceId: string, logger?: any) {
  if (logger) {
    logger.error('Request failed', error, { traceId });
  }

  let statusCode = 500;
  let responseBody = {
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    traceId
  };

  if (error instanceof CardProcessingError) {
    statusCode = error.statusCode;
    responseBody = {
      success: false,
      error: error.message,
      code: error.code,
      traceId
    };
  }

  return new Response(JSON.stringify(responseBody), {
    status: statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
