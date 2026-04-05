/**
 * ╔══════════════════════════════════════════════════════╗
 * ║   ORCHATHON — Next-Gen Reverse Proxy & API Gateway  ║
 * ║   Full Production Model                             ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Architecture:
 *   Client → [IP Blacklist] → [WAF] → [Rate Limiter] → [Circuit Breaker] → Backend
 *
 * Features:
 *   • Dynamic config hot-reload (no restart)
 *   • Sliding Window Log rate limiting per IP per endpoint
 *   • Full WAF: SQL injection, XSS, path traversal, command injection
 *   • IP blacklisting with 403 Forbidden
 *   • Circuit breaker pattern (auto-recovers from backend failures)
 *   • Backend health checks
 *   • Real-time WebSocket dashboard (separate port 9091)
 *   • Structured JSON logging
 *   • Request ID tracing
 */

'use strict';

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const url     = require('url');
const crypto  = require('crypto');

// ─── Dashboard Clients (declared early — used by log() before full init) ──────
const dashboardClients = new Set();

// ─── Config Manager ───────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = {};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(raw);
    log('INFO', 'Config', 'Config loaded/reloaded');
  } catch (e) {
    log('ERROR', 'Config', `Failed to load config: ${e.message}`);
    if (!config.server) process.exit(1);
  }
}
loadConfig();

// Hot reload every 5 seconds
fs.watch(CONFIG_PATH, () => {
  setTimeout(loadConfig, 100); // small delay for write completion
});

// ─── Structured Logger ────────────────────────────────────────────────────────
function log(level, component, message, meta = {}) {
  const entry = {
    ts:        new Date().toISOString(),
    level,
    component,
    message,
    ...meta
  };
  console.log(JSON.stringify(entry));
  broadcastLog(entry);
}

// ─── Stats Engine ─────────────────────────────────────────────────────────────
const stats = {
  startTime:       Date.now(),
  totalRequests:   0,
  blockedRequests: 0,
  successRequests: 0,
  errorRequests:   0,
  totalLatencyMs:  0,
  blockedLog:      [],       // last 200 blocks
  requestWindow:   [],       // timestamps for RPS calc
  statusCodes:     {},
  topEndpoints:    {},
  topAttackers:    {}
};

function recordRequest() {
  stats.totalRequests++;
  const now = Date.now();
  stats.requestWindow.push(now);
  stats.requestWindow = stats.requestWindow.filter(t => now - t < 10000);
}

function recordBlock(ip, reason, reqPath) {
  stats.blockedRequests++;
  const entry = { ip, reason, path: reqPath, ts: new Date().toISOString() };
  stats.blockedLog.unshift(entry);
  if (stats.blockedLog.length > 200) stats.blockedLog.pop();
  stats.topAttackers[ip] = (stats.topAttackers[ip] || 0) + 1;
  log('WARN', 'Security', `Blocked: ${reason}`, { ip, path: reqPath });
  broadcastEvent('block', entry);
}

function recordSuccess(latencyMs, statusCode, reqPath) {
  stats.successRequests++;
  stats.totalLatencyMs += latencyMs;
  stats.statusCodes[statusCode] = (stats.statusCodes[statusCode] || 0) + 1;
  stats.topEndpoints[reqPath] = (stats.topEndpoints[reqPath] || 0) + 1;
}

function recordError() { stats.errorRequests++; }

function getRPS() {
  const now = Date.now();
  return stats.requestWindow.filter(t => now - t < 1000).length;
}

function getAvgLatency() {
  if (stats.successRequests === 0) return 0;
  return Math.round(stats.totalLatencyMs / stats.successRequests);
}

function getSnapshot() {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  const topEndpoints = Object.entries(stats.topEndpoints)
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topAttackers = Object.entries(stats.topAttackers)
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    uptime,
    totalRequests:   stats.totalRequests,
    blockedRequests: stats.blockedRequests,
    successRequests: stats.successRequests,
    errorRequests:   stats.errorRequests,
    rps:             getRPS(),
    avgLatencyMs:    getAvgLatency(),
    statusCodes:     stats.statusCodes,
    topEndpoints,
    topAttackers,
    blockedLog:      stats.blockedLog.slice(0, 50),
    backendStatus:   circuitBreaker.state,
    backendHealthy:  healthStatus.healthy,
    rateLimitKeys:   requestLog.size
  };
}

// ─── Sliding Window Log Rate Limiter ──────────────────────────────────────────
const requestLog = new Map();

function isRateLimited(ip, reqPath, method) {
  const rules = config.rate_limits || [];
  const rule = rules.find(r =>
    reqPath.startsWith(r.path) &&
    (r.method === '*' || r.method.toUpperCase() === method.toUpperCase())
  );
  if (!rule) return { limited: false };

  const key   = `${ip}:${rule.path}:${rule.method}`;
  const now   = Date.now();
  const winMs = rule.window_seconds * 1000;

  const prev = requestLog.get(key) || [];
  const hits  = prev.filter(t => now - t < winMs);
  hits.push(now);
  requestLog.set(key, hits);

  if (hits.length > rule.limit) {
    const retryAfter = Math.ceil((hits[0] + winMs - now) / 1000);
    return { limited: true, retryAfter, rule };
  }
  return { limited: false };
}

// Cleanup stale entries
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of requestLog.entries()) {
    if (ts.every(t => now - t > 120000)) requestLog.delete(key);
  }
}, 60000);

// ─── WAF Engine ───────────────────────────────────────────────────────────────
const WAF_RULES = [
  // SQL Injection
  { name: 'SQL_UNION',    pattern: /UNION\s+(ALL\s+)?SELECT/i,          category: 'sql_injection' },
  { name: 'SQL_DROP',     pattern: /;\s*(DROP|TRUNCATE|DELETE)\s+/i,    category: 'sql_injection' },
  { name: 'SQL_OR_1',     pattern: /\bOR\b\s+['"]?\w+['"]?\s*=\s*['"]?\w+['"]?/i, category: 'sql_injection' },
  { name: 'SQL_COMMENT',  pattern: /--\s*$|#\s*$/m,                    category: 'sql_injection' },
  { name: 'SQL_INSERT',   pattern: /\bINSERT\s+INTO\b/i,               category: 'sql_injection' },
  { name: 'SQL_EXEC',     pattern: /\bEXEC\s*\(/i,                     category: 'sql_injection' },
  { name: 'SQL_XPCMD',    pattern: /xp_cmdshell/i,                     category: 'sql_injection' },
  // XSS
  { name: 'XSS_SCRIPT',   pattern: /<script[\s\S]*?>/i,                category: 'xss' },
  { name: 'XSS_JS_URI',   pattern: /javascript\s*:/i,                  category: 'xss' },
  { name: 'XSS_EVENT',    pattern: /\bon\w+\s*=\s*["'`]?[^"'`>]+/i,  category: 'xss' },
  { name: 'XSS_IFRAME',   pattern: /<iframe/i,                         category: 'xss' },
  { name: 'XSS_EVAL',     pattern: /eval\s*\(/i,                       category: 'xss' },
  // Path Traversal
  { name: 'PATH_TRAV',    pattern: /\.\.\//,                           category: 'path_traversal' },
  { name: 'PATH_ENC',     pattern: /%2e%2e%2f/i,                      category: 'path_traversal' },
  // Command Injection
  { name: 'CMD_PIPE',     pattern: /[|;&`]\s*(ls|cat|rm|wget|curl|bash|sh|python)\b/i, category: 'cmd_injection' },
  { name: 'CMD_SUBSHELL', pattern: /\$\([^)]*\)/,                     category: 'cmd_injection' }
];

function runWAF(text) {
  const sec = config.security || {};
  for (const rule of WAF_RULES) {
    if (rule.category === 'sql_injection'  && !sec.block_sql_injection)  continue;
    if (rule.category === 'xss'            && !sec.block_xss)            continue;
    if (rule.category === 'path_traversal' && !sec.block_path_traversal) continue;
    if (rule.category === 'cmd_injection'  && !sec.block_command_injection) continue;
    if (rule.pattern.test(text)) {
      return { blocked: true, rule: rule.name, category: rule.category };
    }
  }
  return { blocked: false };
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
const circuitBreaker = {
  state:       'CLOSED', // CLOSED, OPEN, HALF_OPEN
  failures:    0,
  lastFailure: 0,

  recordSuccess() {
    this.failures = 0;
    if (this.state !== 'CLOSED') {
      this.state = 'CLOSED';
      log('INFO', 'CircuitBreaker', 'Circuit CLOSED — backend recovered');
      broadcastEvent('circuit', { state: 'CLOSED' });
    }
  },

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    const threshold = (config.circuit_breaker || {}).failure_threshold || 5;
    if (this.failures >= threshold && this.state === 'CLOSED') {
      this.state = 'OPEN';
      log('ERROR', 'CircuitBreaker', `Circuit OPEN after ${this.failures} failures`);
      broadcastEvent('circuit', { state: 'OPEN' });
    }
  },

  isOpen() {
    if (this.state === 'CLOSED') return false;
    const timeout = (config.circuit_breaker || {}).recovery_timeout_ms || 30000;
    if (this.state === 'OPEN' && Date.now() - this.lastFailure > timeout) {
      this.state = 'HALF_OPEN';
      log('INFO', 'CircuitBreaker', 'Circuit HALF_OPEN — trying recovery');
      broadcastEvent('circuit', { state: 'HALF_OPEN' });
      return false;
    }
    return this.state === 'OPEN';
  }
};

// ─── Health Checker ───────────────────────────────────────────────────────────
const healthStatus = { healthy: false, lastCheck: null, latencyMs: 0 };

function checkHealth() {
  if (!(config.health_check || {}).enabled) return;
  const backendURL = new URL(config.server.backend_url);
  const start = Date.now();
  const req = http.request({
    hostname: backendURL.hostname,
    port:     backendURL.port || 80,
    path:     (config.health_check || {}).path || '/health',
    method:   'GET',
    timeout:  3000
  }, (res) => {
    const ms = Date.now() - start;
    const wasHealthy = healthStatus.healthy;
    healthStatus.healthy   = res.statusCode < 500;
    healthStatus.latencyMs = ms;
    healthStatus.lastCheck = new Date().toISOString();
    if (!wasHealthy && healthStatus.healthy) {
      log('INFO', 'HealthCheck', `Backend healthy (${ms}ms)`);
    }
    res.resume();
  });
  req.on('error', () => {
    const wasHealthy = healthStatus.healthy;
    healthStatus.healthy   = false;
    healthStatus.lastCheck = new Date().toISOString();
    if (wasHealthy) log('WARN', 'HealthCheck', 'Backend unhealthy');
  });
  req.end();
}

const healthInterval = (config.health_check || {}).interval_ms || 5000;
setInterval(checkHealth, healthInterval);
checkHealth();

// ─── WebSocket Dashboard Server ───────────────────────────────────────────────
function broadcastEvent(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  dashboardClients.forEach(ws => { try { ws.write(msg + '\n'); } catch (_) {} });
}

function broadcastLog(entry) {
  const msg = JSON.stringify({ type: 'log', data: entry, ts: Date.now() });
  dashboardClients.forEach(ws => { try { ws.write(msg + '\n'); } catch (_) {} });
}

// SSE (Server-Sent Events) Dashboard — works in all browsers without WS library
const dashboardServer = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // SSE stream for live events
  if (parsedUrl.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const write = (data) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };

    // Send initial snapshot
    write({ type: 'snapshot', data: getSnapshot() });

    const client = { write };
    dashboardClients.add(client);

    // Heartbeat snapshot every 2s
    const interval = setInterval(() => {
      write({ type: 'snapshot', data: getSnapshot() });
    }, 2000);

    req.on('close', () => {
      clearInterval(interval);
      dashboardClients.delete(client);
    });
    return;
  }

  // API endpoint for snapshot
  if (parsedUrl.pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getSnapshot(), null, 2));
  }

  // Serve the dashboard HTML
  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(getDashboardHTML());
  }

  res.writeHead(404); res.end('Not found');
});

// ─── Helper: Get Client IP ────────────────────────────────────────────────────
function getClientIP(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    '0.0.0.0'
  );
}

// ─── Proxy Core ───────────────────────────────────────────────────────────────
const proxyServer = http.createServer((req, res) => {
  const requestId = crypto.randomBytes(6).toString('hex');
  const clientIP  = getClientIP(req);
  const parsedURL = url.parse(req.url, true);
  const reqPath   = parsedURL.pathname;
  const startTime = Date.now();

  recordRequest();

  function reject(statusCode, reason, detail = '') {
    recordBlock(clientIP, reason, reqPath);
    res.writeHead(statusCode, {
      'Content-Type':    'application/json',
      'X-Request-Id':    requestId,
      'X-Blocked-By':    'OrchProxy',
      ...(statusCode === 429 ? { 'Retry-After': '60' } : {})
    });
    res.end(JSON.stringify({
      error:     http.STATUS_CODES[statusCode],
      reason,
      detail,
      requestId
    }));
  }

  // 1. IP Blacklist
  const blacklist = (config.security || {}).blacklisted_ips || [];
  if (blacklist.includes(clientIP)) {
    return reject(403, 'IP Blacklisted', `${clientIP} is on the deny list`);
  }

  // 2. Circuit Breaker
  if (circuitBreaker.isOpen()) {
    recordError();
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Service Unavailable',
      reason: 'Circuit breaker OPEN — backend is down',
      requestId
    }));
  }

  // 3. Rate Limiting
  const rateResult = isRateLimited(clientIP, reqPath, req.method);
  if (rateResult.limited) {
    return reject(429, `Rate limit exceeded on ${req.method} ${rateResult.rule.path}`,
      `Limit: ${rateResult.rule.limit} req/${rateResult.rule.window_seconds}s`);
  }

  // 4. WAF — scan URL + query string
  const fullURL = req.url;
  const wafURL = runWAF(decodeURIComponent(fullURL));
  if (wafURL.blocked) {
    return reject(400, `WAF: ${wafURL.rule}`, `Category: ${wafURL.category}`);
  }

  // 5. Collect body then WAF scan body
  const maxBody = (config.server || {}).max_body_size_bytes || 1048576;
  let body = Buffer.alloc(0);

  req.on('data', chunk => {
    body = Buffer.concat([body, chunk]);
    if (body.length > maxBody) {
      req.destroy();
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload Too Large' }));
    }
  });

  req.on('end', () => {
    if (res.writableEnded) return;

    const bodyStr = body.toString('utf8');
    const wafBody = runWAF(bodyStr);
    if (wafBody.blocked) {
      return reject(400, `WAF: ${wafBody.rule}`, `Category: ${wafBody.category}`);
    }

    // 6. Forward to Backend
    const backendURL = new URL(config.server.backend_url);
    const timeout    = (config.server || {}).request_timeout_ms || 10000;

    const proxyOptions = {
      hostname: backendURL.hostname,
      port:     Number(backendURL.port) || 80,
      path:     req.url,
      method:   req.method,
      headers:  {
        ...req.headers,
        host:               backendURL.host,
        'x-forwarded-for':  clientIP,
        'x-forwarded-proto':'http',
        'x-request-id':     requestId,
        'x-real-ip':        clientIP
      },
      timeout
    };

    const proxyReq = http.request(proxyOptions, (proxyRes) => {
      const latency = Date.now() - startTime;
      circuitBreaker.recordSuccess();
      recordSuccess(latency, proxyRes.statusCode, reqPath);

      log('INFO', 'Proxy', `${req.method} ${reqPath} → ${proxyRes.statusCode} (${latency}ms)`, {
        ip: clientIP, requestId, statusCode: proxyRes.statusCode, latencyMs: latency
      });

      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        'x-request-id': requestId,
        'x-proxy':      'OrchProxy/1.0',
        'x-latency-ms': latency
      });
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.setTimeout(timeout, () => {
      proxyReq.destroy();
      circuitBreaker.recordFailure();
      recordError();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gateway Timeout', requestId }));
      }
    });

    proxyReq.on('error', (err) => {
      circuitBreaker.recordFailure();
      recordError();
      log('ERROR', 'Proxy', `Backend error: ${err.message}`, { requestId });
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway', reason: err.message, requestId }));
      }
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });

  req.on('error', () => { if (!res.headersSent) { res.writeHead(400); res.end(); } });
});

// ─── Dashboard HTML ───────────────────────────────────────────────────────────
function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OrchProxy — Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:        #080c10;
    --surface:   #0d1117;
    --border:    #1e2733;
    --border2:   #253040;
    --accent:    #00d4ff;
    --accent2:   #0088aa;
    --green:     #00ff88;
    --red:       #ff4466;
    --yellow:    #ffcc00;
    --purple:    #b388ff;
    --text:      #c9d5e0;
    --muted:     #4a6070;
    --mono:      'Space Mono', monospace;
    --sans:      'DM Sans', sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: var(--sans); overflow-x: hidden; }

  /* Grid scan-line texture */
  body::before {
    content: '';
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,212,255,0.015) 2px, rgba(0,212,255,0.015) 4px);
  }

  .layout { display: grid; grid-template-rows: 56px 1fr; grid-template-columns: 220px 1fr; min-height: 100vh; position: relative; z-index: 1; }

  /* Header */
  header {
    grid-column: 1 / -1;
    display: flex; align-items: center; gap: 16px;
    padding: 0 24px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .logo { font-family: var(--mono); font-size: 13px; font-weight: 700; color: var(--accent); letter-spacing: 2px; }
  .logo span { color: var(--muted); }
  .live-pill {
    display: flex; align-items: center; gap: 6px;
    background: rgba(0,255,136,0.08); border: 1px solid rgba(0,255,136,0.25);
    border-radius: 20px; padding: 3px 10px; font-size: 11px; color: var(--green); font-family: var(--mono);
  }
  .live-pill::before { content: ''; width: 6px; height: 6px; background: var(--green); border-radius: 50%; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.3)} }
  .header-right { margin-left: auto; display: flex; align-items: center; gap: 20px; font-size: 12px; color: var(--muted); font-family: var(--mono); }
  .circuit-badge {
    padding: 4px 12px; border-radius: 4px; font-size: 11px; font-weight: 700; font-family: var(--mono); letter-spacing: 1px;
  }
  .circuit-CLOSED  { background: rgba(0,255,136,0.1); color: var(--green); border: 1px solid rgba(0,255,136,0.3); }
  .circuit-OPEN    { background: rgba(255,68,102,0.1); color: var(--red); border: 1px solid rgba(255,68,102,0.3); }
  .circuit-HALF_OPEN { background: rgba(255,204,0,0.1); color: var(--yellow); border: 1px solid rgba(255,204,0,0.3); }

  /* Sidebar */
  .sidebar {
    background: var(--surface); border-right: 1px solid var(--border);
    padding: 20px 0; overflow-y: auto;
  }
  .sidebar-section { padding: 0 16px; margin-bottom: 24px; }
  .sidebar-label { font-size: 10px; font-family: var(--mono); color: var(--muted); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; padding: 0 8px; }
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 8px; border-radius: 6px; font-size: 13px; cursor: pointer;
    color: var(--muted); transition: all .15s; margin-bottom: 2px;
  }
  .nav-item:hover, .nav-item.active { background: rgba(0,212,255,0.08); color: var(--accent); }
  .nav-item .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

  /* Mini stats in sidebar */
  .mini-stat { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; font-size: 12px; }
  .mini-stat .label { color: var(--muted); }
  .mini-stat .val { font-family: var(--mono); font-size: 11px; color: var(--text); }

  /* Main content */
  main { overflow-y: auto; padding: 24px; }

  /* Stat cards */
  .cards-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 18px 20px;
    position: relative; overflow: hidden; transition: border-color .2s;
  }
  .card:hover { border-color: var(--border2); }
  .card::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--card-accent, var(--accent)); border-radius: 10px 10px 0 0; }
  .card.green  { --card-accent: var(--green); }
  .card.red    { --card-accent: var(--red); }
  .card.yellow { --card-accent: var(--yellow); }
  .card.purple { --card-accent: var(--purple); }
  .card-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; font-family: var(--mono); margin-bottom: 10px; }
  .card-value { font-size: 32px; font-weight: 700; font-family: var(--mono); color: var(--text); line-height: 1; }
  .card-sub { font-size: 11px; color: var(--muted); margin-top: 6px; }

  /* Panels row */
  .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
  .panel {
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
  }
  .panel-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); }
  .panel-title { font-size: 12px; font-family: var(--mono); color: var(--accent); letter-spacing: 1px; text-transform: uppercase; }
  .panel-body { padding: 14px 18px; max-height: 240px; overflow-y: auto; }

  /* Block feed */
  .block-entry {
    display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: start;
    padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px;
    animation: slideIn .3s ease;
  }
  @keyframes slideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
  .block-entry:last-child { border-bottom: none; }
  .block-ip { font-family: var(--mono); color: var(--red); font-size: 11px; }
  .block-reason { color: var(--text); }
  .block-time { font-family: var(--mono); font-size: 10px; color: var(--muted); }

  /* Log stream */
  .log-stream { font-family: var(--mono); font-size: 11px; max-height: 240px; overflow-y: auto; }
  .log-line { padding: 3px 0; display: flex; gap: 10px; border-bottom: 1px solid rgba(30,39,51,0.5); }
  .log-level-INFO  { color: var(--accent); }
  .log-level-WARN  { color: var(--yellow); }
  .log-level-ERROR { color: var(--red); }
  .log-ts   { color: var(--muted); flex-shrink: 0; font-size: 10px; }
  .log-msg  { color: var(--text); flex: 1; word-break: break-all; }

  /* Full-width block table */
  .full-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  thead { background: rgba(0,212,255,0.04); }
  th { padding: 10px 16px; text-align: left; font-size: 10px; font-family: var(--mono); color: var(--muted); text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid var(--border); font-weight: 400; }
  td { padding: 9px 16px; font-size: 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(0,212,255,0.03); }
  .tag {
    display: inline-block; font-family: var(--mono); font-size: 10px; font-weight: 700;
    padding: 2px 7px; border-radius: 3px; letter-spacing: 0.5px;
  }
  .tag-sql  { background: rgba(255,68,102,.1); color: var(--red); border: 1px solid rgba(255,68,102,.2); }
  .tag-xss  { background: rgba(179,136,255,.1); color: var(--purple); border: 1px solid rgba(179,136,255,.2); }
  .tag-rate { background: rgba(255,204,0,.1); color: var(--yellow); border: 1px solid rgba(255,204,0,.2); }
  .tag-bl   { background: rgba(255,68,102,.15); color: var(--red); border: 1px solid rgba(255,68,102,.3); }
  .tag-waf  { background: rgba(255,68,102,.08); color: #ff8899; border: 1px solid rgba(255,68,102,.2); }
  .tag-ok   { background: rgba(0,255,136,.1); color: var(--green); border: 1px solid rgba(0,255,136,.2); }

  /* Chart bar */
  .bar-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 12px; }
  .bar-label { width: 130px; color: var(--muted); font-family: var(--mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
  .bar-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width .5s ease; }
  .bar-count { font-family: var(--mono); font-size: 11px; color: var(--text); width: 40px; text-align: right; }

  /* RPS graph */
  .rps-graph { height: 60px; margin: 8px 0; }
  canvas { width: 100% !important; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  /* Status colors */
  .healthy   { color: var(--green); }
  .unhealthy { color: var(--red); }
</style>
</head>
<body>
<div class="layout">

  <!-- Header -->
  <header>
    <div class="logo">ORCH<span>/</span>PROXY</div>
    <div class="live-pill">LIVE</div>
    <div id="circuit-badge" class="circuit-badge circuit-CLOSED">CLOSED</div>
    <div class="header-right">
      <span>Uptime: <span id="h-uptime" style="color:var(--text)">0s</span></span>
      <span>Backend: <span id="h-backend" class="healthy">●</span></span>
      <span id="h-time" style="color:var(--text)"></span>
    </div>
  </header>

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-label">Live Stats</div>
      <div class="mini-stat"><span class="label">Total Req</span> <span class="val" id="s-total">0</span></div>
      <div class="mini-stat"><span class="label">Blocked</span>   <span class="val" id="s-blocked" style="color:var(--red)">0</span></div>
      <div class="mini-stat"><span class="label">RPS</span>        <span class="val" id="s-rps" style="color:var(--green)">0</span></div>
      <div class="mini-stat"><span class="label">Avg Latency</span><span class="val" id="s-lat">0ms</span></div>
      <div class="mini-stat"><span class="label">Active Rules</span><span class="val" id="s-rules">0</span></div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Proxy Config</div>
      <div class="mini-stat"><span class="label">Listen Port</span><span class="val">${config.server.listen_port}</span></div>
      <div class="mini-stat"><span class="label">Backend</span>    <span class="val" style="font-size:10px">${config.server.backend_url}</span></div>
      <div class="mini-stat"><span class="label">WAF Rules</span>  <span class="val">${WAF_RULES.length}</span></div>
      <div class="mini-stat"><span class="label">Rate Limits</span><span class="val">${(config.rate_limits||[]).length}</span></div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Status Codes</div>
      <div id="status-codes"></div>
    </div>
  </aside>

  <!-- Main -->
  <main>
    <!-- Metric cards -->
    <div class="cards-grid">
      <div class="card">
        <div class="card-label">Total Requests</div>
        <div class="card-value" id="c-total">0</div>
        <div class="card-sub">Since startup</div>
      </div>
      <div class="card green">
        <div class="card-label">Req / sec</div>
        <div class="card-value" id="c-rps">0</div>
        <div class="card-sub">1-second window</div>
      </div>
      <div class="card red">
        <div class="card-label">Blocked</div>
        <div class="card-value" id="c-blocked">0</div>
        <div class="card-sub" id="c-block-pct">0% of traffic</div>
      </div>
      <div class="card yellow">
        <div class="card-label">Avg Latency</div>
        <div class="card-value" id="c-lat">0<span style="font-size:16px;color:var(--muted)">ms</span></div>
        <div class="card-sub">Backend response</div>
      </div>
    </div>

    <!-- Panels row -->
    <div class="panels">
      <!-- Block Feed -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Block Feed</span>
          <span id="block-count" style="font-size:11px;font-family:var(--mono);color:var(--muted)">0 total</span>
        </div>
        <div class="panel-body" id="block-feed">
          <div style="color:var(--muted);font-size:12px;text-align:center;padding:20px">Awaiting blocked requests…</div>
        </div>
      </div>

      <!-- Log Stream -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Log Stream</span>
          <span style="font-size:11px;font-family:var(--mono);color:var(--muted)">live</span>
        </div>
        <div class="panel-body log-stream" id="log-stream">
          <div class="log-line"><span class="log-ts">--:--:--</span><span class="log-level-INFO">INFO</span><span class="log-msg">Connecting to proxy…</span></div>
        </div>
      </div>
    </div>

    <!-- Top endpoints + attackers -->
    <div class="panels" style="margin-bottom:24px">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Top Endpoints</span></div>
        <div class="panel-body" id="top-endpoints">
          <div style="color:var(--muted);font-size:12px">No traffic yet</div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Top Attackers</span></div>
        <div class="panel-body" id="top-attackers">
          <div style="color:var(--muted);font-size:12px">None so far — system secure</div>
        </div>
      </div>
    </div>

    <!-- Full block table -->
    <div class="full-panel">
      <div class="panel-header">
        <span class="panel-title">Security Event Log</span>
        <span id="sec-count" style="font-size:11px;font-family:var(--mono);color:var(--muted)"></span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>IP Address</th>
            <th>Type</th>
            <th>Reason</th>
            <th>Path</th>
          </tr>
        </thead>
        <tbody id="sec-table">
          <tr><td colspan="5" style="color:var(--muted);text-align:center;padding:24px">No security events yet</td></tr>
        </tbody>
      </table>
    </div>
  </main>
</div>

<script>
const evtSource = new EventSource('/events');

let snap = null;
let logLines = [];

function fmt(n) { return n >= 1000 ? (n/1000).toFixed(1)+'k' : n; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString() : '--'; }

function tagHTML(reason) {
  const r = reason.toLowerCase();
  if (r.includes('blacklist') || r.includes('blacklisted')) return '<span class="tag tag-bl">BLACKLIST</span>';
  if (r.includes('rate'))  return '<span class="tag tag-rate">RATE LIMIT</span>';
  if (r.includes('sql'))   return '<span class="tag tag-sql">SQL INJECT</span>';
  if (r.includes('xss'))   return '<span class="tag tag-xss">XSS</span>';
  if (r.includes('waf') || r.includes('cmd') || r.includes('path')) return '<span class="tag tag-waf">WAF</span>';
  return '<span class="tag tag-ok">OTHER</span>';
}

evtSource.onmessage = (e) => {
  const msg = JSON.parse(e.data);

  if (msg.type === 'snapshot') {
    snap = msg.data;
    updateDashboard(snap);
  } else if (msg.type === 'log') {
    addLog(msg.data);
  } else if (msg.type === 'block') {
    // already in next snapshot
  } else if (msg.type === 'circuit') {
    const badge = document.getElementById('circuit-badge');
    badge.textContent = msg.data.state;
    badge.className = 'circuit-badge circuit-' + msg.data.state;
  }
};

evtSource.onerror = () => {
  addLog({ level: 'ERROR', component: 'Dashboard', message: 'SSE connection lost — reconnecting…' });
};

function updateDashboard(s) {
  // Header
  document.getElementById('h-uptime').textContent = formatUptime(s.uptime);
  document.getElementById('h-backend').className   = s.backendHealthy ? 'healthy' : 'unhealthy';
  document.getElementById('h-time').textContent    = new Date().toLocaleTimeString();

  // Circuit badge
  const badge = document.getElementById('circuit-badge');
  badge.textContent = s.backendStatus;
  badge.className = 'circuit-badge circuit-' + s.backendStatus;

  // Cards
  document.getElementById('c-total').textContent   = fmt(s.totalRequests);
  document.getElementById('c-rps').textContent     = s.rps;
  document.getElementById('c-blocked').textContent = fmt(s.blockedRequests);
  document.getElementById('c-lat').innerHTML       = s.avgLatencyMs + '<span style="font-size:16px;color:var(--muted)">ms</span>';

  const pct = s.totalRequests > 0 ? Math.round(s.blockedRequests / s.totalRequests * 100) : 0;
  document.getElementById('c-block-pct').textContent = pct + '% of traffic';

  // Sidebar
  document.getElementById('s-total').textContent   = fmt(s.totalRequests);
  document.getElementById('s-blocked').textContent = fmt(s.blockedRequests);
  document.getElementById('s-rps').textContent     = s.rps;
  document.getElementById('s-lat').textContent     = s.avgLatencyMs + 'ms';
  document.getElementById('s-rules').textContent   = s.rateLimitKeys;

  // Status codes
  const scEl = document.getElementById('status-codes');
  const codes = Object.entries(s.statusCodes).sort((a,b) => b[1]-a[1]);
  scEl.innerHTML = codes.map(([code, count]) => {
    const color = code < 300 ? 'var(--green)' : code < 400 ? 'var(--accent)' : code < 500 ? 'var(--yellow)' : 'var(--red)';
    return \`<div class="mini-stat"><span class="label" style="font-family:var(--mono);color:\${color}">\${code}</span><span class="val">\${count}</span></div>\`;
  }).join('') || '<div class="mini-stat"><span class="label">—</span></div>';

  // Block feed
  document.getElementById('block-count').textContent = s.blockedRequests + ' total';
  const feed = document.getElementById('block-feed');
  const blocks = s.blockedLog.slice(0, 10);
  if (blocks.length > 0) {
    feed.innerHTML = blocks.map(b => \`
      <div class="block-entry">
        <span class="block-ip">\${b.ip}</span>
        <div>
          <div class="block-reason">\${b.reason}</div>
          <div class="block-time">\${fmtTime(b.ts)} · \${b.path || '/'}</div>
        </div>
      </div>\`).join('');
  }

  // Top endpoints
  const epEl = document.getElementById('top-endpoints');
  const eps = s.topEndpoints || [];
  const maxEp = eps[0] ? eps[0][1] : 1;
  epEl.innerHTML = eps.length ? eps.map(([ep, cnt]) => \`
    <div class="bar-row">
      <span class="bar-label" title="\${ep}">\${ep}</span>
      <div class="bar-track"><div class="bar-fill" style="width:\${Math.round(cnt/maxEp*100)}%"></div></div>
      <span class="bar-count">\${fmt(cnt)}</span>
    </div>\`).join('') : '<div style="color:var(--muted);font-size:12px">No traffic yet</div>';

  // Top attackers
  const atEl = document.getElementById('top-attackers');
  const ats = s.topAttackers || [];
  const maxAt = ats[0] ? ats[0][1] : 1;
  atEl.innerHTML = ats.length ? ats.map(([ip, cnt]) => \`
    <div class="bar-row">
      <span class="bar-label" style="color:var(--red)" title="\${ip}">\${ip}</span>
      <div class="bar-track"><div class="bar-fill" style="width:\${Math.round(cnt/maxAt*100)}%;background:var(--red)"></div></div>
      <span class="bar-count" style="color:var(--red)">\${cnt}</span>
    </div>\`).join('') : '<div style="color:var(--muted);font-size:12px">None — system secure ✓</div>';

  // Security table
  const tbody = document.getElementById('sec-table');
  const events = s.blockedLog.slice(0, 30);
  document.getElementById('sec-count').textContent = s.blockedRequests + ' events';
  tbody.innerHTML = events.length ? events.map(b => \`
    <tr>
      <td style="font-family:var(--mono);font-size:11px;color:var(--muted)">\${fmtTime(b.ts)}</td>
      <td style="font-family:var(--mono);color:var(--red)">\${b.ip}</td>
      <td>\${tagHTML(b.reason)}</td>
      <td style="color:var(--text);font-size:12px">\${b.reason}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--muted)">\${b.path || '/'}</td>
    </tr>\`).join('')
    : '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:24px">No security events yet</td></tr>';
}

function addLog(entry) {
  const stream = document.getElementById('log-stream');
  const ts   = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '';
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = \`<span class="log-ts">\${ts}</span><span class="log-level-\${entry.level}">\${entry.level}</span><span class="log-msg">[\${entry.component}] \${entry.message}</span>\`;
  stream.insertBefore(line, stream.firstChild);
  if (stream.children.length > 80) stream.removeChild(stream.lastChild);
}

function formatUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
}
</script>
</body>
</html>`;
}

// ─── Start Servers ────────────────────────────────────────────────────────────
const PROXY_PORT     = config.server.listen_port    || 9090;
const DASHBOARD_PORT = config.server.dashboard_port || 9091;

proxyServer.listen(PROXY_PORT, () => {
  log('INFO', 'Proxy', `Proxy listening on port ${PROXY_PORT}`);
});

dashboardServer.listen(DASHBOARD_PORT, () => {
  log('INFO', 'Dashboard', `Dashboard at http://localhost:${DASHBOARD_PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('INFO', 'System', 'Shutting down gracefully…');
  proxyServer.close(() => {
    dashboardServer.close(() => process.exit(0));
  });
});