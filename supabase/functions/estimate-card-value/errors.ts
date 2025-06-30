
// Custom error classes for better error handling and debugging
export class CardProcessingError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 500) {
    super(message);
    this.name = 'CardProcessingError';
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
