/**
 * 配置管理模块
 */

import type { ProxyConfig } from './types';

// 环境变量配置
export const ENV = {
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || '*',
  DEFAULT_TIMEOUT: parseInt(process.env.DEFAULT_TIMEOUT || '20000', 10),
  BACKGROUND_TIMEOUT: parseInt(process.env.BACKGROUND_TIMEOUT || '240000', 10),
  MAX_RESPONSE_SIZE: parseInt(process.env.MAX_RESPONSE_SIZE || '6291456', 10),
  ENABLE_RETRY: process.env.ENABLE_RETRY !== 'false',
  ENABLE_FALLBACK: process.env.ENABLE_FALLBACK !== 'false',
  LOG_LEVEL: process.env.LOG_LEVEL || 'INFO',
  IS_VERCEL: process.env.VERCEL === '1',
  VERCEL_ENV: process.env.VERCEL_ENV || 'development',
  VERCEL_URL: process.env.VERCEL_URL || 'localhost:3000',
};

// 内置代理配置
export const BUILTIN_PROXIES: Record<string, ProxyConfig> = {
  azure: { 
    host: "models.inference.ai.azure.com",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST", "PUT"]
  },
  cerebras: { 
    host: "api.cerebras.ai",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  chutes: { 
    host: "llm.chutes.ai",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"] 
  },
  claude: { 
    host: "api.anthropic.com",
    defaultHeaders: {
      "anthropic-version": "2023-06-01"
    },
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  cohere: { 
    host: "api.cohere.ai",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  discord: { 
    host: "discord.com", 
    basePath: "api" 
  },
  dmxcn: { 
    host: "www.dmxapi.cn" 
  },
  dmxcom: { 
    host: "www.dmxapi.com" 
  },
  fireworks: { 
    host: "api.fireworks.ai", 
    basePath: "inference",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  friendli: { 
    host: "api.friendli.ai", 
    basePath: "serverless",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"] 
  },
  gemini: { 
    host: "generativelanguage.googleapis.com",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  github: { 
    host: "models.github.ai",
    defaultHeaders: {
      "Accept": "application/vnd.github+json"
    },
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  gmi: { 
    host: "api.gmi-serving.com",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"] 
  },
  groq: { 
    host: "api.groq.com", 
    basePath: "openai",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  huggingface: { 
    host: "api-inference.huggingface.co",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  meta: { 
    host: "www.meta.ai", 
    basePath: "api",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"] 
  },
  modelscope: { 
    host: "api-inference.modelscope.cn",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"] 
  },
  novita: { 
    host: "api.novita.ai",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  openai: { 
    host: "api.openai.com",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"],
    timeout: 120000,
    maxResponseSize: 10485760
  },
  openrouter: { 
    host: "openrouter.ai", 
    basePath: "api",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  poe: { 
    host: "api.poe.com",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"] 
  },
  portkey: { 
    host: "api.portkey.ai",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  pplx: { 
    host: "api.perplexity.ai",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  siliconflow: { 
    host: "api.siliconflow.cn",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  targon: { 
    host: "api.targon.com",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"] 
  },
  telegram: { 
    host: "api.telegram.org",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"] 
  },
  together: { 
    host: "api.together.xyz",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  xai: { 
    host: "api.x.ai",
    retryable: true,
    retryableMethods: ["GET", "HEAD", "OPTIONS", "POST"]
  },
  httpbin: { 
    host: "httpbin.org",
    retryable: true 
  },
};

// 加载自定义配置
export function loadProxyConfig(): Record<string, ProxyConfig> {
  const customConfig = process.env.PROXY_CONFIG;
  if (!customConfig) return BUILTIN_PROXIES;
  
  try {
    const parsed = JSON.parse(customConfig);
    const merged = { ...BUILTIN_PROXIES };
    
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'object' && value !== null) {
        merged[key] = { ...BUILTIN_PROXIES[key], ...value as ProxyConfig };
      }
    }
    
    return merged;
  } catch (error) {
    console.error('Invalid PROXY_CONFIG:', error);
    return BUILTIN_PROXIES;
  }
}

// 请求头白名单
export const ALLOWED_REQUEST_HEADERS = new Set([
  'content-type',
  'content-length',
  'accept',
  'accept-encoding',
  'accept-language',
  'authorization',
  'user-agent',
  'referer',
  'origin',
  // API Keys
  'x-api-key',
  'x-goog-api-key',
  'api-key',
  // 服务特定
  'anthropic-version',
  'anthropic-beta',
  'openai-beta',
  'openai-organization',
  'x-stainless-arch',
  'x-stainless-lang',
  'x-stainless-os',
  'x-stainless-package-version',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
]);

// 请求头黑名单
export const BLOCKED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'cf-connecting-ip',
  'cf-ray',
  'x-forwarded-for',
  'x-real-ip',
  'cookie',
  'set-cookie',
]);

// 长时间运行的 API 路径
export const LONG_RUNNING_PATHS = [
  '/v1/audio/transcriptions',
  '/v1/audio/translations',
  '/v1/images/generations',
  '/v1/images/edits',
  '/v1/images/variations',
  '/v1/embeddings',
  '/v1/fine-tunes',
  '/v1/fine_tuning/jobs',
  '/v1/files',
  '/v1/batches',
];

// 流式 API 路径
export const STREAMING_PATHS = [
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/messages',
  '/v1/realtime',
  '/v1/engines',
  '/v1/responses',
];
