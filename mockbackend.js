const http = require("http");

const loginHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Login Page</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #1a1a2e, #16213e, #0f3460);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 40px;
      width: 380px;
      box-shadow: 0 25px 50px rgba(0,0,0,0.5);
    }
    h2 { color: #38bdf8; text-align: center; margin-bottom: 8px; font-size: 1.6rem; }
    p.sub { color: #94a3b8; text-align: center; font-size: 0.85rem; margin-bottom: 28px; }
    label { display: block; color: #94a3b8; font-size: 0.8rem; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    input { width: 100%; padding: 12px 16px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #e2e8f0; font-size: 0.95rem; margin-bottom: 18px; outline: none; }
    input:focus { border-color: #38bdf8; }
    button { width: 100%; padding: 13px; background: linear-gradient(90deg, #0ea5e9, #6366f1); color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    #msg { margin-top: 16px; text-align: center; font-size: 0.85rem; min-height: 20px; }
    .success { color: #4ade80; }
    .error   { color: #f87171; }
    .footer  { margin-top: 24px; text-align: center; color: #475569; font-size: 0.75rem; }
  </style>
</head>
<body>
<div class="card">
  <h2>🔐 Secure Login</h2>
  <p class="sub">Protected by Reverse Proxy & Rate Limiter</p>
  <label>Username</label>
  <input type="text" id="user" placeholder="admin" />
  <label>Password</label>
  <input type="password" id="pass" placeholder="••••••••" />
  <button onclick="doLogin()">Sign In</button>
  <div id="msg"></div>
  <div class="footer">Rate limited to 5 requests/min per IP via proxy</div>
</div>
<script>
let count = 0;
async function doLogin() {
  count++;
  const msg = document.getElementById('msg');
  msg.textContent = 'Sending request #' + count + '...';
  msg.className = '';
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('user').value,
        password: document.getElementById('pass').value
      })
    });
    const data = await res.json();
    if (res.status === 429) {
      msg.textContent = 'BLOCKED! 429 Too Many Requests — Rate limit hit!';
      msg.className = 'error';
    } else if (res.ok) {
      msg.textContent = 'Login OK! Token: ' + (data.token || 'received');
      msg.className = 'success';
    } else {
      msg.textContent = 'Error ' + res.status + ': ' + (data.error || 'Failed');
      msg.className = 'error';
    }
  } catch(e) {
    msg.textContent = 'Connection error: ' + e.message;
    msg.className = 'error';
  }
}
document.addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const { method, url } = req;
  console.log("[BACKEND]", method, url);

  if (url === "/" || (url === "/login" && method === "GET")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(loginHTML);
  }

  if (url === "/login" && method === "POST") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const { username, password } = JSON.parse(body);
        if (username === "admin" && password === "admin123") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ token: "jwt-abc123", message: "Login successful" }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid credentials" }));
        }
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bad request" }));
      }
    });
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Backend OK", path: url }));
});

server.listen(8080, () => {
  console.log("Mock backend running on http://localhost:8080");
  console.log("Login credentials: admin / admin123");
});
