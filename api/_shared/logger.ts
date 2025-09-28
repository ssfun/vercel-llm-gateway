/**
 * 统一日志系统
 */

import type { LogLevel } from './types';
import { ENV } from './config';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const LOG_COLORS = {
  DEBUG: '\x1b[36m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  RESET: '\x1b[0m',
};

class Logger {
  private level: number;
  
  constructor() {
    this.level = LOG_LEVELS[ENV.LOG_LEVEL as LogLevel] || LOG_LEVELS.INFO;
  }
  
  private formatTime(): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false,
    });
    return formatter.format(now).replace(/\//g, '-');
  }
  
  private log(level: LogLevel, message: string, context?: any) {
    if (LOG_LEVELS[level] < this.level) return;
    
    const time = this.formatTime();
    const color = LOG_COLORS[level];
    const reset = LOG_COLORS.RESET;
    
    let logStr = `[${time}]`;
    if (context?.reqId) logStr += ` [${context.reqId}]`;
    logStr += ` ${color}[${level}]${reset} ${message}`;
    
    if (context) {
      const { reqId, ...rest } = context;
      if (Object.keys(rest).length > 0) {
        const contextStr = Object.entries(rest)
          .map(([k, v]) => {
            if (v === undefined || v === null) return null;
            if (typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
            return `${k}=${v}`;
          })
          .filter(Boolean)
          .join(' ');
        if (contextStr) logStr += ` | ${contextStr}`;
      }
    }
    
    console.log(logStr);
  }
  
  debug(message: string, context?: any) {
    this.log('DEBUG', message, context);
  }
  
  info(message: string, context?: any) {
    this.log('INFO', message, context);
  }
  
  warn(message: string, context?: any) {
    this.log('WARN', message, context);
  }
  
  error(message: string, context?: any) {
    this.log('ERROR', message, context);
  }
}

export const logger = new Logger();
