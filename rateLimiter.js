/**
 * Sliding Window Log Rate Limiter
 * Per-IP, per-endpoint, per-method tracking
 */
class RateLimiter {
  constructor(rules) {
    this.rules = rules || [];
    // Map: `${ip}:${method}:${path}` => array of timestamps
    this.store = new Map();

    // Clean up old entries every 60s to prevent memory leak
    setInterval(() => this._cleanup(), 60_000);
  }

  reload(rules) {
    this.rules = rules || [];
    this.store.clear();
    console.log(`[RATE LIMITER] Reloaded ${this.rules.length} rules`);
  }

  check(ip, method, url) {
    const pathname = url.split("?")[0]; // strip query string
    const rule = this._matchRule(method, pathname);

    if (!rule) {
      // No rule → allow freely
      return { allowed: true, remaining: 999, limit: 999 };
    }

    const key = `${ip}:${method}:${rule.path}`;
    const now = Date.now();
    const windowMs = (rule.window_seconds || 60) * 1000;
    const limit = rule.limit;

    // Get or init the window log
    if (!this.store.has(key)) this.store.set(key, []);
    const log = this.store.get(key);

    // Remove timestamps outside the current window
    const cutoff = now - windowMs;
    while (log.length > 0 && log[0] < cutoff) log.shift();

    if (log.length >= limit) {
      const oldestInWindow = log[0];
      const retryAfter = Math.ceil((oldestInWindow + windowMs - now) / 1000);
      return { allowed: false, limit, remaining: 0, retryAfter };
    }

    log.push(now);
    return { allowed: true, limit, remaining: limit - log.length };
  }

  _matchRule(method, pathname) {
    return this.rules.find(
      (r) =>
        r.path === pathname &&
        r.method.toUpperCase() === method.toUpperCase()
    ) || this.rules.find(
      (r) => r.path === "*" // wildcard fallback
    ) || null;
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, log] of this.store.entries()) {
      // Find the rule's window for this key
      const parts = key.split(":");
      const method = parts[1];
      const rulePath = parts.slice(2).join(":");
      const rule = this.rules.find(r => r.path === rulePath && r.method === method);
      const windowMs = ((rule?.window_seconds) || 60) * 1000;
      const cutoff = now - windowMs;
      while (log.length > 0 && log[0] < cutoff) log.shift();
      if (log.length === 0) this.store.delete(key);
    }
  }
}

module.exports = { RateLimiter };
