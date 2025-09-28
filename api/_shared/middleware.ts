/**
 * 中间件函数
 */

import { logger } from './logger';
import { createCorsHeaders } from './utils';
import { ENV } from './config';

export async function fetchWithRetry(
  request: Request,
  options: {
    maxRetries: number;
    retryableMethods?: string[];
    reqId: string;
  }
): Promise<Response> {
  const { maxRetries, retryableMethods = ['GET', 'HEAD', 'OPTIONS'], reqId } = options;
  
  // 不重试或方法不支持重试
  if (maxRetries <= 0 || !retryableMethods.includes(request.method)) {
    return fetch(request);
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        logger.warn('重试请求', {
          reqId,
          attempt,
          maxRetries,
          url: request.url,
          method: request.method,
        });
      }
      
      const response = await fetch(request.clone());
      
      // 5xx 错误且还有重试机会
      if (response.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`Server error: ${response.status} ${response.statusText}`);
        
        // 指数退避
        const baseDelay = Math.min(100 * Math.pow(2, attempt), 5000);
        const jitter = baseDelay * 0.3 * (Math.random() - 0.5);
        const delay = Math.max(baseDelay + jitter, 100);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      return response;
      
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) break;
      
      // 判断是否应该重试
      const errorMsg = lastError.message.toLowerCase();
      const retryableErrors = ['timeout', 'network', 'connection', 'fetch', 'econnreset', 'etimedout'];
      
      if (!retryableErrors.some(e => errorMsg.includes(e))) {
        break;
      }
      
      // 指数退避
      const baseDelay = Math.min(100 * Math.pow(2, attempt), 5000);
      const jitter = baseDelay * 0.3 * (Math.random() - 0.5);
      const delay = Math.max(baseDelay + jitter, 100);
      
      logger.debug(`等待 ${Math.round(delay)}ms 后重试`, { reqId, attempt });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError || new Error('Request failed after retries');
}

export function createSizeLimitedStream(
  maxSize: number,
  reqId: string
): TransformStream {
  let totalBytes = 0;
  let aborted = false;
  
  return new TransformStream({
    transform(chunk, controller) {
      if (aborted) return;
      
      totalBytes += chunk.byteLength;
      
      if (totalBytes > maxSize) {
        aborted = true;
        logger.warn('响应大小超过限制', {
          reqId,
          totalBytes,
          maxSize,
          limit_mb: (maxSize / 1024 / 1024).toFixed(2),
        });
        
        const errorJson = JSON.stringify({
          error: {
            message: `Response size (${(totalBytes / 1024 / 1024).toFixed(2)}MB) exceeds limit (${(maxSize / 1024 / 1024).toFixed(2)}MB)`,
            type: 'response_size_exceeded',
            code: 413,
            request_id: reqId,
          }
        });
        
        controller.error(new Error(errorJson));
        return;
      }
      
      controller.enqueue(chunk);
    },
    
    flush() {
      logger.debug('流传输完成', {
        reqId,
        totalBytes,
        total_mb: (totalBytes / 1024 / 1024).toFixed(2),
      });
    }
  });
}

export function processResponseHeaders(
  upstreamHeaders: Headers,
  reqId: string,
  mode: 'edge' | 'background' = 'edge'
): Headers {
  const headers = new Headers();
  
  // 复制上游头（排除某些）
  const excludeHeaders = new Set([
    'content-encoding',
    'transfer-encoding',
    'connection',
    'keep-alive',
    'server',
    'x-powered-by',
    'cf-ray',
    'cf-cache-status',
  ]);
  
  for (const [key, value] of upstreamHeaders.entries()) {
    if (!excludeHeaders.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  
  // 添加 CORS 头
  const corsHeaders = createCorsHeaders();
  for (const [key, value] of corsHeaders.entries()) {
    headers.set(key, value);
  }
  
  // 添加追踪信息
  headers.set('X-Request-Id', reqId);
  headers.set('X-Processing-Mode', mode);
  headers.set('X-Gateway-Version', '1.0.0');
  
  // 安全头
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  
  return headers;
}

export function createStreamingResponse(
  body: ReadableStream | null,
  status: number,
  statusText: string,
  headers: Headers
): Response {
  // 确保流式响应的正确头
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  headers.set('X-Accel-Buffering', 'no');
  
  return new Response(body, {
    status,
    statusText,
    headers,
  });
}
