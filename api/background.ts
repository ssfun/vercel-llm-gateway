/**
 * Background Function - 长时间任务处理器
 * 使用 Node.js 运行时，支持最长 5 分钟执行
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from './_shared/logger';
import { ENV } from './_shared/config';
import { 
  buildUpstreamURL, 
  buildForwardHeaders,
  sanitizePath 
} from './_shared/utils';
import { categorizeError } from './_shared/errors';
import type { ServiceConfig } from './_shared/types';

export const config = {
  maxDuration: 300, // 5 分钟
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false,
  },
};

/**
 * 解析服务配置
 */
function parseServiceConfig(headers: any): ServiceConfig | null {
  const configHeader = headers['x-service-config'];
  if (!configHeader) return null;
  
  try {
    return JSON.parse(configHeader);
  } catch (error) {
    logger.error('解析服务配置失败', { error: (error as Error).message });
    return null;
  }
}

/**
 * 执行上游请求
 */
async function executeUpstreamRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: any,
  timeout: number,
  reqId: string
): Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: any;
  contentType?: string;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    logger.debug('发起上游请求', {
      reqId,
      url,
      method,
      timeout,
    });
    
    const response = await fetch(url, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    // 获取响应头
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    
    // 读取响应体
    const contentType = response.headers.get('content-type') || '';
    let data;
    
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        // JSON 解析失败，回退到文本
        data = await response.text();
      }
    } else if (contentType.includes('text/')) {
      data = await response.text();
    } else if (contentType.includes('application/octet-stream') || contentType.includes('audio/') || contentType.includes('image/')) {
      // 二进制数据
      const buffer = await response.arrayBuffer();
      data = Buffer.from(buffer);
      responseHeaders['x-binary-response'] = 'true';
    } else {
      // 默认作为文本处理
      data = await response.text();
    }
    
    logger.debug('上游响应', {
      reqId,
      status: response.status,
      contentType,
      dataSize: typeof data === 'string' ? data.length : data.byteLength,
    });
    
    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      data,
      contentType,
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * 主处理函数
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const startTime = Date.now();
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  const originalIp = req.headers['x-original-ip'] as string || 'unknown';
  
  logger.info('Background 收到请求', {
    reqId,
    method: req.method,
    path: req.url,
    contentLength: req.headers['content-length'],
    ip: originalIp,
  });
  
  try {
    // 解析服务配置
    const serviceConfig = parseServiceConfig(req.headers);
    if (!serviceConfig) {
      logger.error('缺少服务配置', { reqId });
      res.status(400).json({
        error: {
          message: 'Missing service configuration',
          request_id: reqId,
        },
      });
      return;
    }
    
    const { serviceAlias, proxyConfig } = serviceConfig;
    
    // 构建上游 URL
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const pathname = url.pathname.replace('/api/background', '');
    const segments = pathname.split('/').filter(Boolean);
    
    if (segments.length < 2) {
      res.status(400).json({
        error: {
          message: 'Invalid path format',
          request_id: reqId,
        },
      });
      return;
    }
    
    const [service, ...pathSegments] = segments;
    const userPath = sanitizePath(pathSegments);
    const upstreamURL = buildUpstreamURL(
      proxyConfig.host,
      proxyConfig.basePath,
      userPath,
      url.search
    );
    
    logger.info('Background 转发请求', {
      reqId,
      service: serviceAlias,
      upstream: upstreamURL,
    });
    
    // 准备请求头
    const clientHeaders = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
      if (typeof value === 'string' && !key.startsWith('x-service')) {
        clientHeaders.set(key, value);
      }
    });

    const forwardHeaders = buildForwardHeaders(clientHeaders, proxyConfig);
    const headersObject: Record<string, string> = {};
    forwardHeaders.forEach((value, key) => {
      headersObject[key] = value;
    });
    
    // 准备请求体
    let body = null;
    if (!['GET', 'HEAD'].includes(req.method!)) {
      const contentType = req.headers['content-type'] as string;
      
      if (contentType?.includes('application/json')) {
        body = JSON.stringify(req.body);
      } else if (contentType?.includes('text/')) {
        body = req.body;
      } else if (contentType?.includes('multipart/form-data')) {
        // 处理 multipart/form-data
        body = req.body;
      } else {
        // 默认 JSON
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        if (!headersObject['content-type']) {
          headersObject['content-type'] = 'application/json';
        }
      }
    }
    
    // 执行请求
    const timeout = proxyConfig.timeout || ENV.BACKGROUND_TIMEOUT;
    const result = await executeUpstreamRequest(
      upstreamURL,
      req.method!,
      headersObject,
      body,
      timeout,
      reqId
    );
    
    const duration = Date.now() - startTime;
    
    logger.info('Background 请求完成', {
      reqId,
      status: result.status,
      duration_ms: duration,
      service: serviceAlias,
    });
    
    // 设置响应头
    res.setHeader('X-Request-Id', reqId);
    res.setHeader('X-Processing-Time', duration.toString());
    res.setHeader('X-Processing-Mode', 'background');
    res.setHeader('Access-Control-Allow-Origin', ENV.ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    // 复制上游响应头（排除某些）
    const excludeHeaders = [
      'content-encoding',
      'transfer-encoding',
      'connection',
      'keep-alive',
      'server',
    ];
    
    Object.entries(result.headers).forEach(([key, value]) => {
      if (!excludeHeaders.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    
    // 设置状态码
    res.status(result.status);
    
    // 返回响应
    if (result.headers['x-binary-response'] === 'true') {
      // 二进制数据
      res.send(result.data);
    } else if (result.contentType?.includes('application/json')) {
      // JSON 数据
      if (typeof result.data === 'string') {
        try {
          res.json(JSON.parse(result.data));
        } catch {
          res.send(result.data);
        }
      } else {
        res.json(result.data);
      }
    } else {
      // 文本或其他
      res.send(result.data);
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorInfo = categorizeError(error as Error);
    
    logger.error('Background 请求失败', {
      reqId,
      error: (error as Error).message,
      stack: (error as Error).stack,
      errorType: errorInfo.type,
      duration_ms: duration,
    });
    
    // 设置错误响应头
    res.setHeader('X-Request-Id', reqId);
    res.setHeader('X-Processing-Time', duration.toString());
    res.setHeader('X-Processing-Mode', 'background');
    res.setHeader('Access-Control-Allow-Origin', ENV.ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    res.status(errorInfo.status).json({
      error: {
        message: errorInfo.message,
        type: errorInfo.type,
        request_id: reqId,
        duration_ms: duration,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
