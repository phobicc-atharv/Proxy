# ORCHATHON — Complete Hackathon Demo System

## 🚀 One-Click Start (Windows)

```
Double-click:  start.bat
Then open:     http://localhost:3000
```

## Manual Start (4 terminals)

```bash
# Terminal 1 — Target website
node website.js

# Terminal 2 — Proxy + dashboard  
node proxy.js

# Terminal 3 — Demo controller
node demo_controller.js

# Open in browser
http://localhost:3000
```

---

## 🎯 Demo Flow (for judges)

### Step 1 — Show the unprotected site
- Open `http://localhost:3000` on projector
- The LEFT panel shows ShopSecure running directly on :8080
- Header shows **⚠ UNPROTECTED**

### Step 2 — Run attacks WITHOUT proxy
- Click **DDoS Flood** → all 30 requests reach the backend
- Click **Brute Force** → all login attempts hit the server
- Click **SQL Inject** → malicious queries reach the backend
- Point at the site — it would crash or get compromised

### Step 3 — Enable the proxy (the moment of truth)
- Click **🛡 Enable Proxy** in the bottom bar
- Header switches to **🛡 PROTECTED**
- Website now routes through :9090

### Step 4 — Run the SAME attacks WITH proxy
- Click **DDoS Flood** → ⚡ all blocked with 429
- Click **Brute Force** → ⚡ blocked after 5 attempts  
- Click **SQL Inject** → 🛡 WAF blocks all payloads
- Click **XSS Attack** → 🛡 WAF blocks all payloads
- Click **Blacklist** → ⛔ banned IPs get instant 403

### Step 5 — Show legit traffic still works
- Click **✅ Legit User** → all 4 requests pass through cleanly

### Step 6 — Show the dashboard
- RIGHT panel shows the live OrchProxy dashboard
- Shows blocked count, RPS, top attackers, security event log
- All in real-time via SSE

---

## Port Map

| Port | Service | Purpose |
|------|---------|---------|
| 3000 | Demo Controller | Presentation UI — open on projector |
| 8080 | ShopSecure | Target website / backend API |
| 9090 | OrchProxy | The invisible middleman |
| 9091 | Dashboard | Live security monitoring |

---

## What each file does

| File | Purpose |
|------|---------|
| `website.js` | ShopSecure — beautiful e-commerce site (the victim) |
| `proxy.js` | The reverse proxy — rate limiter, WAF, circuit breaker |
| `demo_controller.js` | Presentation UI — 3-panel demo with attack buttons |
| `config.json` | Proxy configuration (hot-reloaded) |
| `start.bat` | One-click launcher for Windows |