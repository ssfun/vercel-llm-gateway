/**
 * 错误处理模块
 */

import type { ErrorInfo } from './types';
import { ENV } from './config';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public type: string = 'api_error',
    public detail?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function categorizeError(error: Error): ErrorInfo {
  const msg = error.message.toLowerCase();
  
  if (error.name === 'AbortError' || msg.includes('timeout')) {
    return {
      type: 'TIMEOUT',
      status: 504,
      message: '请求超时 - 上游服务响应时间过长',
    };
  }
  
  if (msg.includes('network') || msg.includes('fetch failed')) {
    return {
      type: 'NETWORK',
      status: 502,
      message: '网络错误 - 无法连接到上游服务',
    };
  }
  
  if (msg.includes('dns') || msg.includes('getaddrinfo')) {
    return {
      type: 'DNS',
      status: 502,
      message: 'DNS 解析失败 - 无法解析上游主机',
    };
  }
  
  if (msg.includes('connection refused') || msg.includes('econnrefused')) {
    return {
      type: 'CONNECTION',
      status: 503,
      message: '连接被拒绝 - 上游服务不可用',
    };
  }
  
  if (msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate')) {
    return {
      type: 'SSL',
      status: 502,
      message: 'SSL/TLS 错误 - 证书验证失败',
    };
  }
  
  if (msg.includes('size') || msg.includes('413')) {
    return {
      type: 'SIZE_LIMIT',
      status: 413,
      message: '响应大小超过限制',
    };
  }
  
  return {
    type: 'UNKNOWN',
    status: 500,
    message: `未知错误: ${error.message}`,
  };
}

export function createErrorResponse(
  status: number,
  message: string,
  reqId: string,
  detail?: any
): Response {
  const errorBody = {
    error: {
      message,
      type: 'api_error',
      request_id: reqId,
    },
    status,
    timestamp: new Date().toISOString(),
    ...detail,
  };
  
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-Id': reqId,
    'Access-Control-Allow-Origin': ENV.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  
  return new Response(JSON.stringify(errorBody, null, 2), {
    status,
    headers,
  });
}
