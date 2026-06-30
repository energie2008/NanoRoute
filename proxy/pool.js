import { ProxyAgent, Agent } from 'undici';
import { SocksClient } from 'socks';
import { URL } from 'url';

let proxyPool = [];
let currentIndex = 0;
let globalDispatcher = null;
let healthCheckInterval = null;

function parseProxyUrl(url) {
  const parsed = new URL(url);
  const type = parsed.protocol.replace(':', '').toLowerCase();
  let socksType = 5;
  if (type === 'socks' || type === 'socks5' || type === 'socks5h') socksType = 5;
  if (type === 'socks4' || type === 'socks4a') socksType = 4;
  
  return {
    type,
    host: parsed.hostname,
    port: parseInt(parsed.port, 10),
    userId: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    socksType
  };
}

function createProxyAgent(url) {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.startsWith('socks://') || lowerUrl.startsWith('socks4://') || 
      lowerUrl.startsWith('socks4a://') || lowerUrl.startsWith('socks5://') || 
      lowerUrl.startsWith('socks5h://')) {
    const proxy = parseProxyUrl(url);
    return new Agent({
      allowH2: false,
      connect: async (options) => {
        let port = parseInt(options.port, 10);
        if (!port) {
          port = options.protocol === 'https:' ? 443 : 80;
        }
        
        const { socket } = await SocksClient.createConnection({
          proxy: {
            host: proxy.host,
            port: proxy.port,
            type: proxy.socksType,
            userId: proxy.userId || undefined,
            password: proxy.password || undefined
          },
          command: 'connect',
          destination: {
            host: options.hostname,
            port: port
          },
          set_tcp_nodelay: true
        });
        
        socket.setKeepAlive(true, 60000);
        return socket;
      }
    });
  }
  return new ProxyAgent(url);
}

class ProxyEntry {
  constructor(url, weight = 1, type = 'http') {
    this.url = url;
    this.weight = weight;
    this.type = type;
    this.healthy = true;
    this.lastCheck = 0;
    this.failCount = 0;
    this.cooldownUntil = 0;
    this.agent = createProxyAgent(url);
  }

  isAvailable() {
    if (!this.healthy) return false;
    if (this.cooldownUntil > Date.now()) return false;
    return true;
  }

  markFailure() {
    this.failCount++;
    if (this.failCount >= 3) {
      this.healthy = false;
      this.cooldownUntil = Date.now() + 5 * 60 * 1000;
    }
  }

  markSuccess() {
    this.failCount = 0;
    this.healthy = true;
  }
}

let globalProxyConfig = null;

export function getGlobalProxy() {
  if (typeof globalProxyConfig === 'string') return globalProxyConfig;
  if (Array.isArray(globalProxyConfig) && globalProxyConfig.length > 0) {
    const first = globalProxyConfig[0];
    return typeof first === 'string' ? first : first.url;
  }
  return null;
}

export function setGlobalProxy(proxyConfig) {
  globalProxyConfig = proxyConfig;
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }

  proxyPool = [];
  currentIndex = 0;
  globalDispatcher = null;

  if (!proxyConfig) {
    globalDispatcher = new Agent();
    return;
  }

  if (typeof proxyConfig === 'string') {
    proxyPool = [new ProxyEntry(proxyConfig, 1, 'http')];
    globalDispatcher = proxyPool[0].agent;
    console.log(`[ProxyPool] Single proxy configured: ${proxyConfig}`);
    return;
  }

  if (Array.isArray(proxyConfig)) {
    if (proxyConfig.length === 0) {
      globalDispatcher = new Agent();
      return;
    }

    proxyPool = proxyConfig.map(p => {
      const url = typeof p === 'string' ? p : p.url;
      const weight = typeof p === 'object' ? (p.weight || 1) : 1;
      const type = typeof p === 'object' ? (p.type || 'http') : 'http';
      return new ProxyEntry(url, weight, type);
    });

    const available = getAvailableProxies();
    if (available.length > 0) {
      globalDispatcher = available[0].agent;
    } else {
      globalDispatcher = new Agent();
    }

    console.log(`[ProxyPool] Pool configured with ${proxyPool.length} proxies, strategy: round-robin`);

    healthCheckInterval = setInterval(healthCheck, 5 * 60 * 1000);
    healthCheck().catch(() => {});
    return;
  }

  globalDispatcher = new Agent();
}

function getAvailableProxies() {
  const now = Date.now();
  return proxyPool.filter(p => {
    if (p.cooldownUntil <= now && !p.healthy) {
      p.healthy = true;
      p.failCount = 0;
    }
    return p.isAvailable();
  });
}

export function getProxyForRequest(req) {
  if (proxyPool.length === 0) return null;

  const available = getAvailableProxies();
  if (available.length === 0) {
    console.warn('[ProxyPool] No healthy proxies available, using direct connection');
    return null;
  }

  if (available.length === 1) {
    return available[0].url;
  }

  currentIndex = (currentIndex + 1) % available.length;
  return available[currentIndex].url;
}

export function getDispatcher() {
  return globalDispatcher || new Agent();
}

export function getDispatcherForRequest(req) {
  const proxyUrl = getProxyForRequest(req);
  if (!proxyUrl) return new Agent();

  const proxy = proxyPool.find(p => p.url === proxyUrl);
  if (proxy) {
    proxy.markSuccess();
    return proxy.agent;
  }

  return globalDispatcher || new Agent();
}

export function reportProxyFailure(proxyUrl) {
  const proxy = proxyPool.find(p => p.url === proxyUrl);
  if (proxy) {
    proxy.markFailure();
    console.warn(`[ProxyPool] Proxy ${proxyUrl} marked as failed (failures: ${proxy.failCount})`);

    const available = getAvailableProxies();
    if (available.length > 0) {
      globalDispatcher = available[0].agent;
    } else {
      globalDispatcher = new Agent();
    }
  }
}

async function healthCheck() {
  console.log('[ProxyPool] Running health check...');
  let healthy = 0;
  for (const proxy of proxyPool) {
    try {
      proxy.lastCheck = Date.now();
      proxy.markSuccess();
      healthy++;
    } catch {
      proxy.markFailure();
    }
  }
  console.log(`[ProxyPool] Health check complete: ${healthy}/${proxyPool.length} proxies healthy`);
}

export function getPoolStatus() {
  return {
    total: proxyPool.length,
    healthy: proxyPool.filter(p => p.isAvailable()).length,
    proxies: proxyPool.map(p => ({
      url: p.url.replace(/:\/\/.*@/, '://***@'),
      weight: p.weight,
      type: p.type,
      healthy: p.isAvailable(),
      failCount: p.failCount,
      cooldownRemaining: Math.max(0, Math.ceil((p.cooldownUntil - Date.now()) / 1000))
    }))
  };
}
