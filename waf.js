/**
 * WAF - Web Application Firewall
 * Blocks: blacklisted IPs, SQL injection, XSS
 */

const SQL_PATTERNS = [
  /(\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b)/i,
  /(\bSELECT\b.+\bFROM\b)/i,
  /(\bINSERT\b.+\bINTO\b)/i,
  /(\bUNION\b.+\bSELECT\b)/i,
  /(OR\s+1\s*=\s*1)/i,
  /(AND\s+1\s*=\s*1)/i,
  /(';\s*--)/,
  /(xp_cmdshell)/i,
];

const XSS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/i,
  /javascript\s*:/i,
  /on\w+\s*=\s*["'][^"']*["']/i,
  /<iframe/i,
  /<img[^>]+onerror/i,
];

class WAF {
  constructor(securityConfig) {
    this.config = securityConfig || {};
  }

  reload(securityConfig) {
    this.config = securityConfig || {};
    console.log("[WAF] Reloaded security config");
  }

  inspect(req, clientIP) {
    // 1. IP Blacklist check
    const blacklist = this.config.blacklisted_ips || [];
    if (blacklist.includes(clientIP)) {
      return { allowed: false, status: 403, reason: "IP blacklisted" };
    }

    // 2. SQL Injection check (URL + query string)
    if (this.config.block_sql_injection !== false) {
      const target = decodeURIComponent(req.url);
      for (const pattern of SQL_PATTERNS) {
        if (pattern.test(target)) {
          return { allowed: false, status: 403, reason: "SQL injection detected in URL" };
        }
      }
    }

    // 3. XSS check (URL)
    if (this.config.block_xss !== false) {
      const target = decodeURIComponent(req.url);
      for (const pattern of XSS_PATTERNS) {
        if (pattern.test(target)) {
          return { allowed: false, status: 403, reason: "XSS detected in URL" };
        }
      }
    }

    // 4. Body inspection (for POST/PUT/PATCH)
    // Body is streamed; we buffer it here and re-attach for the proxy
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      return this._inspectBody(req);
    }

    return { allowed: true };
  }

  _inspectBody(req) {
    // Synchronous check on already-buffered body string if attached
    // Full async body buffering is handled in server.js for WAF middleware
    // Here we check headers for obvious issues
    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("text/html")) {
      return { allowed: false, status: 403, reason: "HTML content-type blocked" };
    }

    return { allowed: true };
  }

  // Static helper: check a raw body string
  static checkBody(body, config) {
    if (!config) return { allowed: true };

    if (config.block_sql_injection !== false) {
      for (const p of SQL_PATTERNS) {
        if (p.test(body)) return { allowed: false, status: 403, reason: "SQL injection in body" };
      }
    }

    if (config.block_xss !== false) {
      for (const p of XSS_PATTERNS) {
        if (p.test(body)) return { allowed: false, status: 403, reason: "XSS in body" };
      }
    }

    return { allowed: true };
  }
}

module.exports = { WAF };