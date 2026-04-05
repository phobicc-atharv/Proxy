# 🛡️ ORCHATHON — Next-Gen Reverse Proxy Demo

> A live, interactive demonstration of a production-grade reverse proxy with WAF, rate limiting, circuit breaking, and real-time security monitoring — built for hackathon judges and recruiters.

---

## 🚀 Quick Start (Windows)

```
1. Double-click  →  start.bat
2. Open browser  →  http://localhost:3000
```

That's it. All 4 servers spin up automatically.

---

## 🖥️ Manual Start (4 Terminals)

```bash
# Terminal 1 — Target website (the victim)
node website.js

# Terminal 2 — OrchProxy + Live Dashboard
node proxy.js

# Terminal 3 — Demo Presentation Controller
node demo_controller.js

# Open in browser
http://localhost:3000
```

---

## 🗺️ Port Map

| Port | Service | Role |
|------|---------|------|
| **3000** | Demo Controller | Presentation UI — open on projector |
| **8080** | ShopSecure | Target website / backend API |
| **9090** | OrchProxy | The invisible middleman |
| **9091** | Dashboard | Live security monitoring (SSE) |

---

## 🎯 Demo Flow — Step by Step

### Step 1 — Show the Unprotected Site
- Open `http://localhost:3000` on the projector
- The **LEFT panel** shows ShopSecure running directly on `:8080`
- Header displays **⚠ UNPROTECTED**

### Step 2 — Run Attacks WITHOUT the Proxy
| Attack | What Happens |
|--------|-------------|
| **DDoS Flood** | All 30 requests reach the backend |
| **Brute Force** | All login attempts hit the server |
| **SQL Inject** | Malicious queries reach the database layer |
> ⚠️ Without protection, the site would crash or get compromised.

### Step 3 — Enable the Proxy *(the moment of truth)*
- Click **🛡 Enable Proxy** in the bottom bar
- Header switches to **🛡 PROTECTED**
- All traffic now routes through `:9090`

### Step 4 — Run the SAME Attacks WITH the Proxy
| Attack | Result |
|--------|--------|
| **DDoS Flood** | ⚡ All requests blocked with `429 Too Many Requests` |
| **Brute Force** | ⚡ Blocked after 5 attempts |
| **SQL Inject** | 🛡️ WAF intercepts all payloads |
| **XSS Attack** | 🛡️ WAF intercepts all payloads |
| **Blacklisted IP** | ⛔ Instant `403 Forbidden` |

### Step 5 — Show Legit Traffic Still Works
- Click **✅ Legit User** → all 4 requests pass through cleanly
- Proves the proxy doesn't block normal usage

### Step 6 — Show the Live Dashboard
- **RIGHT panel** shows the OrchProxy monitoring dashboard
- Displays: blocked request count, RPS, top attackers, security event log
- All data streams in **real-time via SSE**

---

## ⚙️ Features

- 🔁 **Reverse Proxy** — Transparent request forwarding to the backend
- 🚦 **Rate Limiting** — Per-route configurable request limits
- 🧱 **WAF (Web Application Firewall)** — Blocks SQLi, XSS, path traversal, command injection
- ⚡ **Circuit Breaker** — Auto-trips on backend failures, self-heals after timeout
- 🌐 **IP Blacklisting** — Instant block for known bad actors
- 📊 **Live Dashboard** — Real-time security events via Server-Sent Events (SSE)
- 🔄 **Hot Config Reload** — Edit `config.json` without restarting

---

## 📁 File Structure

```
orchathon/
├── proxy.js             # Core reverse proxy — rate limiter, WAF, circuit breaker
├── website.js           # ShopSecure — target e-commerce site (the victim)
├── demo_controller.js   # 3-panel presentation UI with attack buttons
├── config.json          # Proxy configuration (hot-reloaded)
├── start.bat            # One-click Windows launcher
└── README.md
```

---

## 🔧 Configuration (`config.json`)

```json
{
  "server": { "listen_port": 9090, "backend_url": "http://localhost:8080" },
  "rate_limits": [
    { "path": "/login", "method": "POST", "limit": 5, "window_seconds": 60 }
  ],
  "security": {
    "block_sql_injection": true,
    "block_xss": true,
    "blacklisted_ips": ["203.0.113.42"]
  },
  "circuit_breaker": { "enabled": true, "failure_threshold": 5 }
}
```

Modify this file at runtime — changes apply instantly without restart.

---

## 🛠️ Tech Stack

- **Runtime:** Node.js (no external dependencies)
- **Architecture:** Reverse proxy pattern with middleware pipeline
- **Real-time:** Server-Sent Events (SSE) for dashboard streaming
- **Frontend:** Vanilla HTML/CSS/JS (zero framework overhead)

---

## 👥 Team

**Team Vision Coders** — Built for ORCHATHON Hackathon

---

## 📄 License

MIT — free to use, modify, and build upon.