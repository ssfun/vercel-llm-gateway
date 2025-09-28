/**
 * 共享类型定义
 */

export interface ProxyConfig {
  host: string;
  basePath?: string;
  timeout?: number;
  maxRetries?: number;
  maxResponseSize?: number;
  retryableMethods?: string[];
  defaultHeaders?: Record<string, string>;
  supportsStreaming?: boolean;
  allowFallback?: boolean;
  retryable?: boolean;  // 添加这个属性
}

export interface RequestContext {
  reqId: string;
  service: string;
  method: string;
  path: string;
  startTime: number;
  ip?: string;
}

export interface ErrorInfo {
  type: 'TIMEOUT' | 'NETWORK' | 'DNS' | 'CONNECTION' | 'SSL' | 'SIZE_LIMIT' | 'UNKNOWN';
  status: number;
  message: string;
  detail?: any;
}

export interface ServiceConfig {
  serviceAlias: string;
  proxyConfig: ProxyConfig;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface ForwardDecision {
  shouldForward: boolean;
  reason?: string;
  estimatedDuration?: number;
}
