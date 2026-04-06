/**
 * ShopSecure — Target Website (port 8080)
 * A realistic e-commerce backend that serves HTML pages.
 * This is the "victim" that gets attacked, then protected by the proxy.
 */

'use strict';

const http = require('http');
const url  = require('url');

// ── Simulated DB ──────────────────────────────────────────────────────────────
let users = [
  { id: 1, name: 'Alice Sharma',  email: 'alice@shop.io', role: 'admin',    orders: 14 },
  { id: 2, name: 'Bob Mehta',     email: 'bob@shop.io',   role: 'customer', orders: 7  },
  { id: 3, name: 'Carol Nair',    email: 'carol@shop.io', role: 'customer', orders: 3  },
  { id: 4, name: 'Dev Kapoor',    email: 'dev@shop.io',   role: 'customer', orders: 21 },
  { id: 5, name: 'Eva Krishnan',  email: 'eva@shop.io',   role: 'staff',    orders: 0  },
];

let loginAttempts = {};
let sessionTokens = {};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, status, content) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(content);
}

// ── Homepage HTML ─────────────────────────────────────────────────────────────
function homePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ShopSecure — Premium Store</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root { --gold:#c9a84c; --dark:#0a0a0f; --card:#12121a; --border:#222233; --text:#e8e4d4; --muted:#7a7a9a; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--dark); color:var(--text); font-family:'DM Sans',sans-serif; min-height:100vh; }
  
  /* Nav */
  nav { display:flex; align-items:center; justify-content:space-between; padding:20px 48px; border-bottom:1px solid var(--border); }
  .logo { font-family:'Playfair Display',serif; font-size:22px; color:var(--gold); letter-spacing:1px; }
  .nav-links { display:flex; gap:32px; font-size:14px; color:var(--muted); }
  .nav-links a { color:var(--muted); text-decoration:none; transition:.2s; }
  .nav-links a:hover { color:var(--text); }
  .nav-btn { background:var(--gold); color:#000; border:none; padding:9px 22px; border-radius:6px; font-size:13px; font-weight:500; cursor:pointer; font-family:'DM Sans',sans-serif; }

  /* Hero */
  .hero { text-align:center; padding:80px 48px 60px; }
  .hero-tag { display:inline-block; border:1px solid var(--gold); color:var(--gold); font-size:11px; letter-spacing:3px; padding:5px 16px; border-radius:20px; margin-bottom:24px; text-transform:uppercase; }
  .hero h1 { font-family:'Playfair Display',serif; font-size:clamp(40px,6vw,72px); line-height:1.1; margin-bottom:16px; }
  .hero h1 span { color:var(--gold); }
  .hero p { color:var(--muted); font-size:16px; max-width:480px; margin:0 auto 36px; line-height:1.7; }
  .hero-btns { display:flex; gap:12px; justify-content:center; }
  .btn-primary { background:var(--gold); color:#000; border:none; padding:14px 32px; border-radius:8px; font-size:15px; font-weight:500; cursor:pointer; font-family:'DM Sans',sans-serif; transition:.2s; }
  .btn-primary:hover { opacity:.9; transform:translateY(-1px); }
  .btn-outline { background:transparent; color:var(--text); border:1px solid var(--border); padding:14px 32px; border-radius:8px; font-size:15px; cursor:pointer; font-family:'DM Sans',sans-serif; transition:.2s; }
  .btn-outline:hover { border-color:var(--gold); color:var(--gold); }

  /* Stats bar */
  .stats-bar { display:flex; justify-content:center; gap:64px; padding:32px 48px; border-top:1px solid var(--border); border-bottom:1px solid var(--border); }
  .stat { text-align:center; }
  .stat-num { font-family:'Playfair Display',serif; font-size:32px; color:var(--gold); }
  .stat-label { font-size:12px; color:var(--muted); margin-top:4px; letter-spacing:1px; text-transform:uppercase; }

  /* Products */
  .section { padding:60px 48px; }
  .section-title { font-family:'Playfair Display',serif; font-size:28px; margin-bottom:32px; }
  .products { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:20px; }
  .product-card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:24px; transition:.2s; cursor:pointer; }
  .product-card:hover { border-color:var(--gold); transform:translateY(-2px); }
  .product-icon { font-size:36px; margin-bottom:12px; }
  .product-name { font-size:16px; font-weight:500; margin-bottom:6px; }
  .product-price { color:var(--gold); font-size:20px; font-family:'Playfair Display',serif; margin-bottom:8px; }
  .product-desc { font-size:13px; color:var(--muted); line-height:1.6; }
  .add-btn { width:100%; margin-top:16px; background:transparent; border:1px solid var(--gold); color:var(--gold); padding:9px; border-radius:6px; font-size:13px; cursor:pointer; transition:.2s; font-family:'DM Sans',sans-serif; }
  .add-btn:hover { background:var(--gold); color:#000; }

  /* Login form */
  .login-section { max-width:420px; margin:0 auto; padding:60px 48px; }
  .form-card { background:var(--card); border:1px solid var(--border); border-radius:16px; padding:40px; }
  .form-title { font-family:'Playfair Display',serif; font-size:26px; margin-bottom:8px; }
  .form-sub { color:var(--muted); font-size:14px; margin-bottom:32px; }
  .form-group { margin-bottom:20px; }
  label { display:block; font-size:13px; color:var(--muted); margin-bottom:8px; letter-spacing:.5px; }
  input { width:100%; background:#0d0d15; border:1px solid var(--border); color:var(--text); padding:12px 16px; border-radius:8px; font-size:14px; font-family:'DM Sans',sans-serif; transition:.2s; }
  input:focus { outline:none; border-color:var(--gold); }
  .login-btn { width:100%; background:var(--gold); color:#000; border:none; padding:14px; border-radius:8px; font-size:15px; font-weight:500; cursor:pointer; font-family:'DM Sans',sans-serif; margin-top:8px; transition:.2s; }
  .login-btn:hover { opacity:.9; }
  .form-msg { margin-top:12px; font-size:13px; text-align:center; min-height:20px; }
  .form-msg.error { color:#ff6677; }
  .form-msg.success { color:#44ff99; }

  /* Users table */
  .users-section { padding:0 48px 60px; }
  .table-wrap { background:var(--card); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
  table { width:100%; border-collapse:collapse; }
  th { background:#0d0d15; padding:14px 20px; text-align:left; font-size:11px; color:var(--muted); letter-spacing:2px; text-transform:uppercase; font-weight:400; border-bottom:1px solid var(--border); }
  td { padding:14px 20px; font-size:14px; border-bottom:1px solid var(--border); }
  tr:last-child td { border-bottom:none; }
  .role-badge { display:inline-block; font-size:11px; padding:2px 10px; border-radius:20px; font-weight:500; }
  .role-admin    { background:rgba(201,168,76,.15); color:var(--gold); }
  .role-staff    { background:rgba(100,180,255,.1); color:#64b4ff; }
  .role-customer { background:rgba(100,255,150,.08); color:#64ff96; }

  /* Footer */
  footer { text-align:center; padding:40px; color:var(--muted); font-size:13px; border-top:1px solid var(--border); }
</style>
</head>
<body>
<nav>
  <div class="logo">ShopSecure ◆</div>
  <div class="nav-links">
    <a href="#">Store</a><a href="#">Collections</a><a href="#">About</a><a href="#">Contact</a>
  </div>
  <button class="nav-btn">Sign In</button>
</nav>

<div class="hero">
  <div class="hero-tag">Premium Collection 2026</div>
  <h1>Luxury Goods,<br><span>Secured.</span></h1>
  <p>The world's finest marketplace for premium products. Trusted by 50,000+ customers worldwide.</p>
  <div class="hero-btns">
    <button class="btn-primary">Shop Now</button>
    <button class="btn-outline">View Catalogue</button>
  </div>
</div>

<div class="stats-bar">
  <div class="stat"><div class="stat-num" id="stat-users">—</div><div class="stat-label">Members</div></div>
  <div class="stat"><div class="stat-num">4.9★</div><div class="stat-label">Rating</div></div>
  <div class="stat"><div class="stat-num">50K+</div><div class="stat-label">Orders</div></div>
  <div class="stat"><div class="stat-num">24/7</div><div class="stat-label">Support</div></div>
</div>

<div class="section">
  <div class="section-title">Featured Products</div>
  <div class="products">
    <div class="product-card">
      <div class="product-icon">⌚</div>
      <div class="product-name">Chronograph Elite</div>
      <div class="product-price">₹89,999</div>
      <div class="product-desc">Swiss movement, sapphire crystal, 5-year warranty.</div>
      <button class="add-btn">Add to Cart</button>
    </div>
    <div class="product-card">
      <div class="product-icon">💎</div>
      <div class="product-name">Diamond Pendant</div>
      <div class="product-price">₹1,24,000</div>
      <div class="product-desc">18K white gold, certified diamond, handcrafted.</div>
      <button class="add-btn">Add to Cart</button>
    </div>
    <div class="product-card">
      <div class="product-icon">👜</div>
      <div class="product-name">Leather Tote Pro</div>
      <div class="product-price">₹34,500</div>
      <div class="product-desc">Full-grain Italian leather, hand-stitched edges.</div>
      <button class="add-btn">Add to Cart</button>
    </div>
    <div class="product-card">
      <div class="product-icon">🥃</div>
      <div class="product-name">Crystal Decanter Set</div>
      <div class="product-price">₹18,200</div>
      <div class="product-desc">Lead-free crystal, 6-piece set, gift-boxed.</div>
      <button class="add-btn">Add to Cart</button>
    </div>
  </div>
</div>

<div class="login-section">
  <div class="form-card">
    <div class="form-title">Member Login</div>
    <div class="form-sub">Access your exclusive account</div>
    <div class="form-group"><label>Email Address</label><input type="text" id="email" placeholder="you@shop.io" value="admin"></div>
    <div class="form-group"><label>Password</label><input type="password" id="password" placeholder="••••••••" value="secret123"></div>
    <button class="login-btn" onclick="doLogin()">Sign In</button>
    <div class="form-msg" id="form-msg"></div>
  </div>
</div>

<div class="users-section">
  <div class="section-title">Member Directory</div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Orders</th></tr></thead>
      <tbody id="users-tbody"><tr><td colspan="5" style="text-align:center;color:var(--muted);padding:32px">Loading members…</td></tr></tbody>
    </table>
  </div>
</div>

<footer>© 2026 ShopSecure. All rights reserved. Protected by OrchProxy™.</footer>

<script>
// Detect if going through proxy or directly
const BASE = window.location.port === '9090' ? 'http://localhost:9090' : 'http://localhost:8080';

async function loadUsers() {
  try {
    const r = await fetch(BASE + '/getAllUsers');
    const data = await r.json();
    document.getElementById('stat-users').textContent = data.total || data.users.length;
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = data.users.map((u,i) => \`
      <tr>
        <td style="color:var(--muted)">\${u.id}</td>
        <td style="font-weight:500">\${u.name}</td>
        <td style="color:var(--muted)">\${u.email}</td>
        <td><span class="role-badge role-\${u.role}">\${u.role}</span></td>
        <td>\${u.orders}</td>
      </tr>\`).join('');
  } catch(e) {
    document.getElementById('users-tbody').innerHTML = 
      '<tr><td colspan="5" style="text-align:center;color:#ff6677;padding:32px">⚠ Server unreachable</td></tr>';
  }
}

async function doLogin() {
  const email    = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const msg      = document.getElementById('form-msg');
  msg.textContent = 'Signing in…';
  msg.className   = 'form-msg';
  try {
    const r = await fetch(BASE + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password })
    });
    const data = await r.json();
    if (r.ok) {
      msg.textContent = '✓ Welcome back, ' + (data.user?.name || email) + '!';
      msg.className   = 'form-msg success';
    } else if (r.status === 429) {
      msg.textContent = '⚡ Too many attempts — blocked by proxy!';
      msg.className   = 'form-msg error';
    } else {
      msg.textContent = '✗ Invalid credentials';
      msg.className   = 'form-msg error';
    }
  } catch(e) {
    msg.textContent = '✗ Server unreachable — site may be down!';
    msg.className   = 'form-msg error';
  }
}

loadUsers();
</script>
</body>
</html>`;
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const reqPath = parsed.pathname;
  const method  = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' });
    return res.end();
  }

  console.log(`[Backend] ${method} ${reqPath}`);

  // Health
  if (reqPath === '/health') return json(res, 200, { status: 'ok', ts: new Date().toISOString() });

  // Serve homepage
  if (reqPath === '/' || reqPath === '/index.html') return html(res, 200, homePage());

  // Get all users
  if (reqPath === '/getAllUsers' && method === 'GET') {
    return json(res, 200, { users, total: users.length });
  }

  // Login (with intentional no rate-limit — proxy handles that)
  if (reqPath === '/login' && method === 'POST') {
    const body = await getBody(req);
    const ip   = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    loginAttempts[ip] = (loginAttempts[ip] || 0) + 1;
    console.log(`[Backend] Login attempt #${loginAttempts[ip]} from ${ip}`);

    if (body.username === 'admin' && body.password === 'secret123') {
      const token = Math.random().toString(36).slice(2);
      sessionTokens[token] = { user: users[0], created: Date.now() };
      return json(res, 200, { token, user: users[0], message: 'Login successful' });
    }
    await new Promise(r => setTimeout(r, 80));
    return json(res, 401, { error: 'Invalid credentials' });
  }

  // Stats
  if (reqPath === '/stats') {
    return json(res, 200, {
      users: users.length, loginAttempts,
      activeSessions: Object.keys(sessionTokens).length
    });
  }

  json(res, 404, { error: 'Not found', path: reqPath });
});

server.listen(8080, () => {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  ShopSecure Backend running on port 8080      ║');
  console.log('║  Visit: http://localhost:8080                 ║');
  console.log('║  (Direct — NO protection)                    ║');
  console.log('║  Via Proxy: http://localhost:9090             ║');
  console.log('║  (Protected by OrchProxy)                    ║');
  console.log('╚═══════════════════════════════════════════════╝');
});
