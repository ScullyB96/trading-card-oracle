
// Centralized logging with structured output
export interface LogContext {
  traceId?: string;
  operation?: string;
  source?: string;
  duration?: number;
  [key: string]: any;
}

export class Logger {
  private traceId: string;

  constructor(traceId: string) {
    this.traceId = traceId;
  }

  private log(level: string, message: string, context?: LogContext) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      traceId: this.traceId,
      ...context
    };
    
    console.log(JSON.stringify(logEntry));
  }

  info(message: string, context?: LogContext) {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log('WARN', message, context);
  }

  error(message: string, error?: Error, context?: LogContext) {
    this.log('ERROR', message, {
      ...context,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }

  debug(message: string, context?: LogContext) {
    this.log('DEBUG', message, context);
  }

  performance(operation: string, duration: number, context?: LogContext) {
    this.log('PERF', `${operation} completed`, {
      ...context,
      operation,
      duration
    });
  }
}
