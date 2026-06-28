import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.js';
import { Router } from './router/index.js';
import { AdminAPI } from './api/index.js';
import { parseBody, sendJSON, sendError, handleCORS } from './utils/http.js';
import { initDB, closeDB } from './state/db.js';
import { setGlobalProxy as initProxyPool } from './proxy/pool.js';
import { MCPServer } from './mcp/index.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS = new Map();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

function generateSessionId() {
  return randomBytes(32).toString('hex');
}

function getSession(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/nanoroute_session=([^;]+)/);
  if (!match) return null;
  const sid = match[1];
  const session = SESSIONS.get(sid);
  if (!session) return null;
  if (Date.now() - session.created > SESSION_TTL) {
    SESSIONS.delete(sid);
    return null;
  }
  return session;
}

function setSessionCookie(res, sid) {
  res.setHeader('Set-Cookie', `nanoroute_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL/1000}`);
}

function normalizeResponsesInput(input) {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  if (Array.isArray(input)) {
    if (input.length > 0 && input[0].role) {
      return input;
    }
    return [{ role: 'user', content: input }];
  }
  return [];
}

initDB();
console.log('[NanoRoute] Database initialized');

let config;
try {
  config = loadConfig('./config.yml');
  // Override with environment variables for Docker
  if (process.env.ADMIN_PASSWORD && !config.admin_password) {
    config.admin_password = process.env.ADMIN_PASSWORD;
  }
  if (process.env.PORT) {
    config.port = parseInt(process.env.PORT, 10);
  }
  console.log(`[NanoRoute] Config loaded: ${config.providers.length} providers`);
  if (config.admin_password) {
    console.log('[NanoRoute] Admin password protection enabled');
  }

  const hasProxiesArray = Array.isArray(config.proxies) && config.proxies.length > 0;
  const proxyConfig = hasProxiesArray ? config.proxies : config.proxy;
  initProxyPool(proxyConfig);
} catch (err) {
  console.error('[NanoRoute] Failed to load config:', err.message);
  process.exit(1);
}

const routerRef = { router: new Router(config) };
const api = new AdminAPI(config, routerRef);
const mcp = new MCPServer(routerRef.router);

const server = createServer(async (req, res) => {
  try {
    if (handleCORS(req, res)) return;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // Login page
    if (path === '/login' || path === '/login.html') {
      const loginPage = join(__dirname, 'dashboard', 'login.html');
      if (existsSync(loginPage)) {
        const html = readFileSync(loginPage, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
    }

    // Login API
    if (req.method === 'POST' && path === '/api/login') {
      if (!config.admin_password) {
        sendJSON(res, { ok: true });
        return;
      }
      const body = await parseBody(req);
      const password = body.password || '';
      if (password === config.admin_password) {
        const sid = generateSessionId();
        SESSIONS.set(sid, { created: Date.now() });
        setSessionCookie(res, sid);
        sendJSON(res, { ok: true });
        return;
      }
      sendError(res, 401, '密码错误');
      return;
    }

    // Admin authentication for dashboard and API
    const adminPassword = config.admin_password || process.env.ADMIN_PASSWORD || '123456';
    const isAdminPath = path === '/' || path === '/index.html' || path === '/config' || path === '/config.html' || (path.startsWith('/api/') && path !== '/api/login');
    if (adminPassword && isAdminPath) {
      const session = getSession(req);
      if (!session) {
        if (path.startsWith('/api/')) {
          sendError(res, 401, '未登录，请先登录');
        } else {
          res.writeHead(302, { 'Location': '/login' });
          res.end();
        }
        return;
      }
    }

    if (path === '/healthz' || path === '/health') {
      sendJSON(res, {
        status: 'ok',
        version: '0.2.0',
        uptime_s: Math.floor(process.uptime()),
        memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        providers: api._config.providers ? api._config.providers.length : 0,
        strategy: api._config.routing ? (api._config.routing.default_strategy || 'priority') : 'priority',
      });
      return;
    }

    if (path.startsWith('/api/')) {
      await api.handle(req, res);
      return;
    }

    if (path === '/mcp' || path === '/mcp/') {
      mcp.handleSSE(req, res);
      return;
    }

    if (path === '/mcp/message') {
      await mcp.handleMessage(req, res);
      return;
    }

    if (path === '/v1/chat/completions' || path === '/v1/messages') {
      const body = await parseBody(req);
      const needsModel = path !== '/v1/messages';
      if (needsModel && !body.model) {
        sendError(res, 400, 'model is required');
        return;
      }
      if (body.stream === undefined) body.stream = true;
      if (path === '/v1/messages') body._is_anthropic = true;

      await routerRef.router.handleRequest(req, res, body);
      return;
    }

    if (path === '/v1/responses') {
      const body = await parseBody(req);
      if (!body.model) {
        sendError(res, 400, 'model is required');
        return;
      }
      if (body.stream === undefined) body.stream = true;
      body._api_mode = 'responses';
      if (body.input && !body.messages) {
        body.messages = normalizeResponsesInput(body.input);
      }
      await routerRef.router.handleRequest(req, res, body);
      return;
    }

    if (path === '/v1/embeddings') {
      const body = await parseBody(req);
      if (!body.model) {
        sendError(res, 400, 'model is required');
        return;
      }
      if (!body.input) {
        sendError(res, 400, 'input is required');
        return;
      }
      await routerRef.router.handleEmbeddings(req, res, body);
      return;
    }

    if (path === '/v1/models') {
      const providers = api._config.providers || [];
      const combos = api._config.combos || [];
      const aliases = api._config.aliases || {};

      const modelMap = new Map();

      providers
        .filter(p => p.enabled !== false)
        .forEach(p => {
          if (!modelMap.has(p.model)) {
            modelMap.set(p.model, {
              id: p.model,
              object: 'model',
              created: 0,
              owned_by: p.vendor_type || p.type,
              capabilities: p.capabilities || [],
              nano_meta: {
                provider_count: providers.filter(x => x.model === p.model && x.enabled !== false).length,
                type: p.vendor_type || p.type
              }
            });
          }
        });

      combos.forEach(c => {
        if (c.id && !modelMap.has(c.id)) {
          modelMap.set(c.id, {
            id: c.id,
            object: 'model',
            created: 0,
            owned_by: 'combo',
            capabilities: [],
            nano_meta: { type: 'combo', members: (c.members || []).map(m => m.group) }
          });
        }
      });

      Object.entries(aliases).forEach(([alias, target]) => {
        if (!modelMap.has(alias)) {
          modelMap.set(alias, {
            id: alias,
            object: 'model',
            created: 0,
            owned_by: 'alias',
            capabilities: [],
            nano_meta: { type: 'alias', target }
          });
        }
      });

      const data = Array.from(modelMap.values());
      sendJSON(res, { object: 'list', data });
      return;
    }

    if (path === '/config' || path === '/config.html') {
      const configPage = join(__dirname, 'dashboard', 'config.html');
      if (existsSync(configPage)) {
        const html = readFileSync(configPage, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
    }

    if (path === '/' || path === '/index.html') {
      const indexPage = join(__dirname, 'dashboard', 'index.html');
      if (existsSync(indexPage)) {
        const html = readFileSync(indexPage, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
    }

    sendError(res, 404, 'Not Found');

  } catch (err) {
    console.error('[Server] Error:', err);
    if (!res.headersSent) sendError(res, 500, err.message || 'Internal Server Error');
  }
});

const port = config.port || 30128;
server.listen(port, () => {
  const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`
╔════════════════════════════════════════════════════╗
║  🚀 NanoRoute v0.2.0  Lightweight AI Gateway       ║
║                                                    ║
║  Dashboard  →  http://localhost:${port}/          ║
║  Config UI  →  http://localhost:${port}/config    ║
║  API        →  http://localhost:${port}/v1/...    ║
║                                                    ║
║  Providers: ${String(config.providers.length).padEnd(4)}  Memory: ~${mem}MB              ║
║  Strategy:  ${(config.routing && config.routing.default_strategy || 'priority').padEnd(16)}  Port: ${port}        ║
╚════════════════════════════════════════════════════╝`);

  const PEAK_THRESHOLD_MB = 150;
  const IDLE_THRESHOLD_MB = 110;
  const IDLE_DURATION_MS = 30_000;
  const SAMPLE_INTERVAL_MS = 5_000;
  let highMemSince = 0;

  const memoryTimer = setInterval(() => {
    try {
      const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const now = Date.now();

      if (memMB > PEAK_THRESHOLD_MB) {
        console.log(`[MemoryGuard] Peak ${memMB}MB > ${PEAK_THRESHOLD_MB}MB, clearing provider cache`);
        if (routerRef.router?.providerCache) {
          routerRef.router.providerCache.clear();
        }
        highMemSince = 0;
        if (global.gc) {
          try { global.gc(); } catch {}
        }
        return;
      }

      if (memMB > IDLE_THRESHOLD_MB) {
        if (!highMemSince) {
          highMemSince = now;
        } else if (now - highMemSince >= IDLE_DURATION_MS) {
          console.log(`[MemoryGuard] Memory ${memMB}MB > ${IDLE_THRESHOLD_MB}MB for ${Math.round((now - highMemSince)/1000)}s, clearing provider cache`);
          if (routerRef.router?.providerCache) {
            routerRef.router.providerCache.clear();
          }
          highMemSince = 0;
        }
      } else {
        highMemSince = 0;
      }
    } catch (err) {
      console.error('[MemoryGuard] Error:', err.message);
    }
  }, SAMPLE_INTERVAL_MS);
  memoryTimer.unref();
});

function shutdown() {
  console.log('\n[NanoRoute] Shutting down...');
  mcp.shutdown();
  server.close(() => {
    closeDB();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (process.platform !== 'win32') {
  process.on('SIGHUP', async () => {
    console.log('[NanoRoute] SIGHUP received, reloading...');
    try {
      await api._cfgAPI._reload(null);
    } catch (err) {
      console.error('[NanoRoute] Reload failed:', err.message);
    }
  });
}

process.on('uncaughtException', err => {
  console.error('[NanoRoute] uncaughtException:', err);
});
process.on('unhandledRejection', err => {
  console.error('[NanoRoute] unhandledRejection:', err);
});
