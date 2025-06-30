
import { TimeoutError } from './errors.ts';

// Utility functions for common operations
export async function withTimeout<T>(
  promise: Promise<T>, 
  timeoutMs: number, 
  operation: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`, operation)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

export function sanitizeString(str: string): string {
  return str.trim().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ');
}

export function validatePrice(price: number): boolean {
  return price > 0 && price < 50000 && !isNaN(price) && isFinite(price);
}

export function validateTitle(title: string): boolean {
  return title && title.length >= 10 && title.length <= 200;
}

export function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

export function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function normalizeDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime()) || date.getFullYear() < 2020) {
      return new Date().toISOString().split('T')[0];
    }
    return date.toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

export function rateLimitedExecutor(intervalMs: number = 1000) {
  let lastExecution = 0;
  
  return async function<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastExecution = now - lastExecution;
    
    if (timeSinceLastExecution < intervalMs) {
      const waitTime = intervalMs - timeSinceLastExecution;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastExecution = Date.now();
    return await fn();
  };
}
