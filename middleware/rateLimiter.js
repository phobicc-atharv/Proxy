// middleware/rateLimiter.js

const store = new Map(); // key: "IP::METHOD::PATH" → [timestamps]
let rules = [];          // loaded from config.json

function loadRules(config) {
  rules = config.rate_limits || [];
}

function getRuleFor(method, path) {
  return rules.find(r => r.method === method && r.path === path) || null;
}

function isAllowed(ip, method, path) {
  const rule = getRuleFor(method, path);
  if (!rule) return { allowed: true };  // no rule = allow

  const key = `${ip}::${method}::${path}`;
  const now = Date.now();
  const windowMs = rule.window_seconds * 1000;

  const timestamps = (store.get(key) || []).filter(t => now - t < windowMs);
  
  if (timestamps.length >= rule.limit) {
    return { allowed: false, reason: `Exceeded ${rule.method} ${rule.path} rate limit` };
  }

  timestamps.push(now);
  store.set(key, timestamps);
  return { allowed: true };
}

// For dashboard stats exposure
function getBlockedIPs() { /* return blocked list */ }
function getStats() { /* return req/sec counters */ }

module.exports = { loadRules, isAllowed, getBlockedIPs, getStats };
