/**
 * 通用工具函数
 */

import type { ProxyConfig, ForwardDecision, RequestContext } from './types';
import { 
  ALLOWED_REQUEST_HEADERS, 
  BLOCKED_REQUEST_HEADERS,
  LONG_RUNNING_PATHS,
  STREAMING_PATHS,
  ENV
} from './config';

export function getRequestId(headers: Headers): string {
  return (
    headers.get('x-request-id') ||
    headers.get('x-correlation-id') ||
    headers.get('x-trace-id') ||
    crypto.randomUUID()
  );
}

export function sanitizePath(parts: string[]): string {
  return parts
    .filter(seg => seg && seg !== '.' && seg !== '..')
    .map(seg => {
      return seg
        .split('/')
        .map(s => encodeURIComponent(s).replace(/%3A/gi, ':'))
        .join('/');
    })
    .join('/');
}

export function buildUpstreamURL(
  host: string,
  basePath: string | undefined,
  userPath: string,
  search: string
): string {
  const cleanBase = basePath?.replace(/^\/|\/$/g, '') || '';
  const cleanUser = userPath.replace(/^\/|\/$/g, '');
  const fullPath = [cleanBase, cleanUser].filter(Boolean).join('/');
  return `https://${host}${fullPath ? '/' + fullPath : ''}${search}`;
}

export function isAllowedHeader(headerName: string): boolean {
  const lower = headerName.toLowerCase();
  
  if (BLOCKED_REQUEST_HEADERS.has(lower)) return false;
  if (ALLOWED_REQUEST_HEADERS.has(lower)) return true;
  
  // 允许 x-* 自定义头（除了被阻止的）
  return lower.startsWith('x-') && !lower.startsWith('x-forwarded') && !lower.startsWith('x-real');
}

export function buildForwardHeaders(
  clientHeaders: Headers,
  proxy: ProxyConfig
): Headers {
  const headers = new Headers();
  
  // 添加默认头
  if (proxy.defaultHeaders) {
    Object.entries(proxy.defaultHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }
  
  // 过滤并转发客户端头
  for (const [key, value] of clientHeaders.entries()) {
    if (isAllowedHeader(key)) {
      headers.set(key, value);
    }
  }
  
  // 设置默认 User-Agent
  if (!headers.has('user-agent')) {
    headers.set('User-Agent', 'Mozilla/5.0 (compatible; API Gateway/1.0)');
  }
  
  // 删除可能导致问题的头
  headers.delete('host');
  headers.delete('connection');
  
  return headers;
}

export async function isStreamingRequest(req: Request): Promise<boolean> {
  const url = new URL(req.url);
  
  // 检查 URL 参数
  if (url.searchParams.get('stream') === 'true') {
    return true;
  }
  
  // 检查是否是 SSE 请求
  const accept = req.headers.get('accept');
  if (accept?.includes('text/event-stream')) {
    return true;
  }
  
  // 检查路径
  const isStreamingPath = STREAMING_PATHS.some(path => 
    url.pathname.includes(path)
  );
  
  if (!isStreamingPath) {
    return false;
  }
  
  // 检查请求体中的 stream 参数
  if (req.method === 'POST' && req.body) {
    try {
      const cloned = req.clone();
      const contentType = req.headers.get('content-type');
      
      if (contentType?.includes('application/json')) {
        const body = await cloned.json();
        return body.stream === true;
      }
    } catch {
      // 解析失败，继续其他检查
    }
  }
  
  return false;
}

export async function shouldForwardToBackground(
  req: Request,
  proxy: ProxyConfig,
  context: RequestContext
): Promise<ForwardDecision> {
  // GET/HEAD/OPTIONS 始终在 Edge
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return { shouldForward: false, reason: 'Method suitable for Edge' };
  }
  
  // 流式请求在 Edge
  if (await isStreamingRequest(req)) {
    return { shouldForward: false, reason: 'Streaming request' };
  }
  
  // 检查是否长时间运行的 API
  const url = new URL(req.url);
  const isLongRunning = LONG_RUNNING_PATHS.some(path => 
    url.pathname.includes(path)
  );
  
  if (isLongRunning) {
    return { 
      shouldForward: true, 
      reason: 'Long-running API',
      estimatedDuration: 60000
    };
  }
  
  // 检查请求大小
  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength);
    // 大于 1MB 的非流式请求转发到 Background
    if (size > 1048576) {
      return { 
        shouldForward: true, 
        reason: `Large request body: ${(size / 1024 / 1024).toFixed(2)}MB`,
        estimatedDuration: 30000
      };
    }
  }
  
  // 特定服务的特殊处理
  if (context.service === 'openai' && url.pathname.includes('/v1/embeddings')) {
    return {
      shouldForward: true,
      reason: 'OpenAI embeddings API',
      estimatedDuration: 20000
    };
  }
  
  return { shouldForward: false, reason: 'Default to Edge' };
}

export function createCorsHeaders(): Headers {
  const headers = new Headers();
  
  headers.set('Access-Control-Allow-Origin', ENV.ALLOWED_ORIGIN);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
  headers.set('Access-Control-Allow-Headers', '*');
  headers.set('Access-Control-Expose-Headers', 'Content-Type, Content-Length, X-Request-Id, X-Processing-Mode, X-Processing-Time');
  headers.set('Access-Control-Max-Age', '86400');
  
  return headers;
}

export function parseQueryParams(searchParams: URLSearchParams): Record<string, string> {
  const params: Record<string, string> = {};
  
  // 白名单参数
  const allowedParams = ['alt', 'key', 'access_token', 'upload_protocol', 'prettyPrint', 'fields'];
  
  for (const [key, value] of searchParams.entries()) {
    if (allowedParams.includes(key) || key.startsWith('$')) {
      params[key] = value;
    }
  }
  
  return params;
}

export function getClientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    headers.get('x-client-ip') ||
    'unknown'
  );
}
