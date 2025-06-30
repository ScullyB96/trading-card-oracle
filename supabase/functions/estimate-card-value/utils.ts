
import { TimeoutError } from './errors.ts';

// Generate a unique trace ID for request tracking
export function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Wrap a promise with a timeout
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(`Operation '${operation}' timed out after ${timeoutMs}ms`, operation));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

// Rate-limited executor to prevent overwhelming APIs
export function rateLimitedExecutor(delayMs: number) {
  let lastExecution = 0;

  return async function<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastExecution = now - lastExecution;
    
    if (timeSinceLastExecution < delayMs) {
      const waitTime = delayMs - timeSinceLastExecution;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastExecution = Date.now();
    return await fn();
  };
}

// Retry function with exponential backoff
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// Sanitize and validate URLs
export function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

// Clean and normalize text
export function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-#.()]/g, '')
    .slice(0, 200);
}

// Safe number parsing
export function safeParseFloat(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

// Safe date parsing
export function safeParseDateString(dateStr: string): string | null {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    
    // Validate date range (not too far in past or future)
    const now = new Date();
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    const oneWeekFuture = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    if (date < twoYearsAgo || date > oneWeekFuture) {
      return null;
    }
    
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}
