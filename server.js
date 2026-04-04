const http = require("http");
const httpProxy = require("http-proxy");
const fs = require("fs");
const path = require("path");
const { RateLimiter } = require("./rateLimiter");
const { WAF } = require("./waf");
const { Dashboard } = require("./dashboard");

// ── Config loader with hot-reload ──────────────────────────────────────────
let config = loadConfig();
function loadConfig() {
  const raw = fs.readFileSync(path.join(__dirname, "config.json"), "utf8");
  return JSON.parse(raw);
}
fs.watch(path.join(__dirname, "config.json"), () => {
  try {
    config = loadConfig();
    rateLimiter.reload(config.rate_limits);
    waf.reload(config.security);
    console.log("[CONFIG] Hot-reloaded config.json ✅");
  } catch (e) {
    console.error("[CONFIG] Reload failed:", e.message);
  }
});

// ── Core modules ───────────────────────────────────────────────────────────
const rateLimiter = new RateLimiter(config.rate_limits);
const waf = new WAF(config.security);
const dashboard = new Dashboard();
const proxy = httpProxy.createProxyServer({ changeOrigin: true });

proxy.on("error", (err, req, res) => {
  console.error("[PROXY ERROR]", err.message);
  res.writeHead(502, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Bad Gateway", message: err.message }));
});

// ── Main server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const clientIP =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket.remoteAddress;

  dashboard.recordRequest(clientIP, req.url, req.method);

  // 1. Dashboard route
  if (req.url === "/__dashboard" || req.url.startsWith("/__dashboard")) {
    return dashboard.handleRequest(req, res);
  }

  // 2. WAF check
  const wafResult = waf.inspect(req, clientIP);
  if (!wafResult.allowed) {
    dashboard.recordBlock(clientIP, wafResult.reason);
    res.writeHead(wafResult.status, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: wafResult.reason }));
  }

  // 3. Rate limiting
  const rlResult = rateLimiter.check(clientIP, req.method, req.url);
  if (!rlResult.allowed) {
    dashboard.recordBlock(clientIP, "Rate limit exceeded: " + req.url);
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": rlResult.retryAfter,
      "X-RateLimit-Limit": rlResult.limit,
      "X-RateLimit-Remaining": 0,
    });
    return res.end(JSON.stringify({ error: "Too Many Requests", retryAfter: rlResult.retryAfter }));
  }

  // 4. Forward to backend
  res.setHeader("X-RateLimit-Remaining", rlResult.remaining);
  proxy.web(req, res, { target: config.server.backend_url });
});

const PORT = config.server.listen_port || 9090;
server.listen(PORT, () => {
  console.log(`\n🛡️  Proxy running on http://localhost:${PORT}`);
  console.log(`🔁  Forwarding to: ${config.server.backend_url}`);
  console.log(`📊  Dashboard: http://localhost:${PORT}/__dashboard\n`);
});
