/**
 * Edge Gateway - 主入口
 * 处理请求路由和流式响应
 */

// Edge Runtime 配置
export const config = {
  runtime: 'edge',
};

import { logger } from './_shared/logger';
import { loadProxyConfig, ENV } from './_shared/config';
import { 
  getRequestId, 
  sanitizePath, 
  buildUpstreamURL,
  shouldForwardToBackground,
  buildForwardHeaders,
  createCorsHeaders,
  parseQueryParams,
  getClientIp
} from './_shared/utils';
import { 
  createErrorResponse, 
  categorizeError 
} from './_shared/errors';
import { 
  fetchWithRetry, 
  createSizeLimitedStream,
  processResponseHeaders,
  createStreamingResponse
} from './_shared/middleware';
import type { RequestContext, ProxyConfig } from './_shared/types';

// 加载代理配置
const PROXIES = loadProxyConfig();

/**
 * Edge 内部处理
 */
async function handleInEdge(
  req: Request,
  context: RequestContext,
  proxy: ProxyConfig,
  userPath: string,
  search: string
): Promise<Response> {
  const upstreamURL = buildUpstreamURL(
    proxy.host,
    proxy.basePath,
    userPath,
    search
  );
  
  logger.debug('Edge 处理请求', {
    reqId: context.reqId,
    service: context.service,
    upstream: upstreamURL,
  });
  
  const forwardHeaders = buildForwardHeaders(req.headers, proxy);
  const timeout = Math.min(proxy.timeout || ENV.DEFAULT_TIMEOUT, 20000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  const upstreamRequest = new Request(upstreamURL, {
    method: context.method,
    headers: forwardHeaders,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : null,
    redirect: 'follow',
    signal: controller.signal,
  });
  
  try {
    const upstreamResponse = await fetchWithRetry(upstreamRequest, {
      maxRetries: ENV.ENABLE_RETRY ? (proxy.maxRetries ?? 1) : 0,
      retryableMethods: proxy.retryableMethods,
      reqId: context.reqId,
    });
    
    clearTimeout(timeoutId);
    
    // 检查响应大小
    const contentLength = upstreamResponse.headers.get('content-length');
    const maxSize = proxy.maxResponseSize || ENV.MAX_RESPONSE_SIZE;
    
    if (contentLength && parseInt(contentLength) > maxSize) {
      return createErrorResponse(
        413,
        `Response size (${(parseInt(contentLength) / 1024 / 1024).toFixed(2)}MB) exceeds limit (${(maxSize / 1024 / 1024).toFixed(2)}MB)`,
        context.reqId
      );
    }
    
    // 处理响应头
    const responseHeaders = processResponseHeaders(
      upstreamResponse.headers,
      context.reqId,
      'edge'
    );
    
    // 添加性能信息
    const duration = performance.now() - context.startTime;
    responseHeaders.set('X-Processing-Time', duration.toFixed(2));
    
    // 处理响应体
    let responseBody = upstreamResponse.body;
    if (responseBody && !contentLength && maxSize > 0) {
      responseBody = responseBody.pipeThrough(
        createSizeLimitedStream(maxSize, context.reqId)
      );
    }
    
    logger.info('Edge 请求完成', {
      reqId: context.reqId,
      status: upstreamResponse.status,
      duration_ms: Math.round(duration),
      service: context.service,
    });
    
    return createStreamingResponse(
      responseBody,
      upstreamResponse.status,
      upstreamResponse.statusText,
      responseHeaders
    );
    
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * 转发到 Background Function
 */
async function forwardToBackground(
  req: Request,
  context: RequestContext,
  proxy: ProxyConfig
): Promise<Response> {
  try {
    logger.info('转发到 Background', {
      reqId: context.reqId,
      service: context.service,
    });
    
    const url = new URL(req.url);
    
    // 构建 Background URL
    const protocol = url.protocol;
    const host = url.host;
    const pathname = url.pathname.replace('/gateway', '');
    const backgroundUrl = `${protocol}//${host}/api/background${pathname}${url.search}`;
    
    // 准备请求头
    const headers = new Headers(req.headers);
    headers.set('X-Request-Id', context.reqId);
    headers.set('X-Service-Config', JSON.stringify({
      serviceAlias: context.service,
      proxyConfig: proxy,
    }));
    headers.set('X-Original-IP', context.ip || 'unknown');
    
    // 处理请求体
    let body: BodyInit | null = null;
    if (req.body && ['POST', 'PUT', 'PATCH'].includes(context.method)) {
      const clonedReq = req.clone();
      const arrayBuffer = await clonedReq.arrayBuffer();
      body = arrayBuffer;
      headers.set('Content-Length', arrayBuffer.byteLength.toString());
    }
    
    // 创建超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    
    try {
      const backgroundResponse = await fetch(backgroundUrl, {
        method: context.method,
        headers,
        body,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      const duration = performance.now() - context.startTime;
      logger.info('Background 转发完成', {
        reqId: context.reqId,
        status: backgroundResponse.status,
        duration_ms: Math.round(duration),
      });
      
      // 处理响应头
      const responseHeaders = new Headers(backgroundResponse.headers);
      responseHeaders.set('X-Request-Id', context.reqId);
      responseHeaders.set('X-Processing-Mode', 'background');
      responseHeaders.set('X-Processing-Time', duration.toFixed(2));
      
      // 确保 CORS 头
      const corsHeaders = createCorsHeaders();
      corsHeaders.forEach((value, key) => {
        responseHeaders.set(key, value);
      });
      
      return new Response(backgroundResponse.body, {
        status: backgroundResponse.status,
        statusText: backgroundResponse.statusText,
        headers: responseHeaders,
      });
      
    } finally {
      clearTimeout(timeoutId);
    }
    
  } catch (error) {
    const duration = performance.now() - context.startTime;
    
    if ((error as Error).name === 'AbortError') {
      logger.error('Background 转发超时', {
        reqId: context.reqId,
        duration_ms: Math.round(duration),
      });
      return createErrorResponse(504, 'Background processing timeout', context.reqId);
    }
    
    logger.error('Background 转发失败', {
      reqId: context.reqId,
      error: (error as Error).message,
      duration_ms: Math.round(duration),
    });
    
    // 降级处理
    if (proxy.allowFallback !== false && ENV.ENABLE_FALLBACK) {
      logger.info('降级到 Edge 处理', { reqId: context.reqId });
      const url = new URL(req.url);
      const segments = url.pathname.replace('/gateway', '').split('/').filter(Boolean);
      const userPath = sanitizePath(segments.slice(1));
      return handleInEdge(req, context, proxy, userPath, url.search);
    }
    
    return createErrorResponse(500, 'Background processing failed', context.reqId);
  }
}

/**
 * 主处理函数
 */
export default async function handler(req: Request): Promise<Response> {
  const startTime = performance.now();
  const reqId = getRequestId(req.headers);
  const clientIp = getClientIp(req.headers);
  
  const context: RequestContext = {
    reqId,
    service: '',
    method: req.method,
    path: '',
    startTime,
    ip: clientIp,
  };
  
  try {
    const url = new URL(req.url);
    const { pathname, search } = url;
    
    context.path = pathname;
    
    // 健康检查端点
    if (pathname === '/gateway/health' || pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'api-gateway',
        mode: 'edge',
        version: '1.0.0',
        env: ENV.VERCEL_ENV,
      }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...Object.fromEntries(createCorsHeaders()),
        },
      });
    }
    
    logger.info('Gateway 收到请求', {
      reqId,
      method: context.method,
      path: pathname,
      ip: context.ip,
    });
    
    // CORS 预检请求
    if (context.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: createCorsHeaders(),
      });
    }
    
    // 路径解析
    const cleanedPathname = pathname.startsWith('/gateway')
      ? pathname.replace('/gateway', '')
      : pathname;
    
    const segments = cleanedPathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return createErrorResponse(
        400,
        'Invalid path format. Expected: /gateway/{service}/{path}',
        reqId,
        { 
          availableServices: Object.keys(PROXIES),
          example: '/gateway/openai/v1/chat/completions'
        }
      );
    }
    
    const [serviceAlias, ...pathSegments] = segments;
    context.service = serviceAlias;
    
    const proxy = PROXIES[serviceAlias];
    if (!proxy) {
      logger.warn('服务未找到', { reqId, service: serviceAlias });
      return createErrorResponse(
        404,
        `Service '${serviceAlias}' not found`,
        reqId,
        { availableServices: Object.keys(PROXIES) }
      );
    }
    
    // 决策：Edge 还是 Background
    const decision = await shouldForwardToBackground(req, proxy, context);
    logger.debug('路由决策', {
      reqId,
      decision: decision.shouldForward ? 'background' : 'edge',
      reason: decision.reason,
    });
    
    if (decision.shouldForward) {
      return await forwardToBackground(req, context, proxy);
    }
    
    // Edge 处理
    const userPath = sanitizePath(pathSegments);
    return await handleInEdge(req, context, proxy, userPath, search);
    
  } catch (error) {
    const duration = performance.now() - startTime;
    logger.error('Gateway 请求处理失败', {
      reqId,
      error: (error as Error).message,
      stack: (error as Error).stack,
      duration_ms: Math.round(duration),
    });
    
    const errorInfo = categorizeError(error as Error);
    return createErrorResponse(
      errorInfo.status,
      errorInfo.message,
      reqId,
      { type: errorInfo.type }
    );
  }
}
