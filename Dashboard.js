const fs = require("fs");
const path = require("path");

class Dashboard {
  constructor() {
    this.stats = {
      totalRequests: 0,
      requestsPerSecond: 0,
      blockedIPs: [], // { ip, reason, time }
      recentRequests: [], // last 50
    };
    this._requestBucket = [];

    // Compute RPS every second
    setInterval(() => {
      const now = Date.now();
      const cutoff = now - 1000;
      this._requestBucket = this._requestBucket.filter((t) => t > cutoff);
      this.stats.requestsPerSecond = this._requestBucket.length;
    }, 1000);
  }

  recordRequest(ip, url, method) {
    this.stats.totalRequests++;
    this._requestBucket.push(Date.now());
    this.stats.recentRequests.unshift({ ip, url, method, time: new Date().toISOString() });
    if (this.stats.recentRequests.length > 50) this.stats.recentRequests.pop();
  }

  recordBlock(ip, reason) {
    this.stats.blockedIPs.unshift({ ip, reason, time: new Date().toISOString() });
    if (this.stats.blockedIPs.length > 100) this.stats.blockedIPs.pop();
  }

  handleRequest(req, res) {
    if (req.url === "/__dashboard/api") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(this.stats));
    }

    // Serve HTML dashboard
    const html = this._buildHTML();
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  }

  _buildHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Proxy Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
  header{background:#1e293b;padding:20px 32px;border-bottom:1px solid #334155;display:flex;align-items:center;gap:12px}
  header h1{font-size:1.4rem;font-weight:700;color:#38bdf8}
  .badge{background:#0ea5e9;color:#fff;font-size:.7rem;padding:3px 10px;border-radius:20px;font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;padding:24px 32px}
  .card{background:#1e293b;border-radius:12px;padding:20px;border:1px solid #334155}
  .card .label{font-size:.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}
  .card .value{font-size:2rem;font-weight:700;margin-top:6px;color:#38bdf8}
  .section{padding:0 32px 24px}
  .section h2{font-size:1rem;font-weight:600;color:#94a3b8;margin-bottom:12px;text-transform:uppercase}
  table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:12px;overflow:hidden}
  th{background:#334155;padding:10px 14px;text-align:left;font-size:.75rem;color:#94a3b8;text-transform:uppercase}
  td{padding:10px 14px;font-size:.82rem;border-bottom:1px solid #1e293b}
  tr:last-child td{border-bottom:none}
  .blocked-ip{color:#f87171}
  .tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.7rem;font-weight:600}
  .tag-block{background:#7f1d1d;color:#fca5a5}
  .tag-ok{background:#14532d;color:#86efac}
  .rps-bar{height:8px;background:#0ea5e9;border-radius:4px;transition:width .5s;max-width:100%}
</style>
</head>
<body>
<header>
  <span>🛡️</span>
  <h1>Reverse Proxy Dashboard</h1>
  <span class="badge">LIVE</span>
</header>

<div class="grid">
  <div class="card">
    <div class="label">Total Requests</div>
    <div class="value" id="total">—</div>
  </div>
  <div class="card">
    <div class="label">Requests / sec</div>
    <div class="value" id="rps">—</div>
    <div style="margin-top:8px"><div class="rps-bar" id="rps-bar" style="width:0%"></div></div>
  </div>
  <div class="card">
    <div class="label">Blocks (session)</div>
    <div class="value" id="blocks" style="color:#f87171">—</div>
  </div>
</div>

<div class="section">
  <h2>🚫 Blocked IPs (live feed)</h2>
  <table>
    <thead><tr><th>IP Address</th><th>Reason</th><th>Time</th></tr></thead>
    <tbody id="blocked-body"><tr><td colspan="3" style="color:#64748b">No blocks yet</td></tr></tbody>
  </table>
</div>

<div class="section">
  <h2>📋 Recent Requests</h2>
  <table>
    <thead><tr><th>IP</th><th>Method</th><th>URL</th><th>Time</th></tr></thead>
    <tbody id="req-body"></tbody>
  </table>
</div>

<script>
async function refresh(){
  const d=await fetch('/__dashboard/api').then(r=>r.json());
  document.getElementById('total').textContent=d.totalRequests;
  document.getElementById('rps').textContent=d.requestsPerSecond;
  document.getElementById('blocks').textContent=d.blockedIPs.length;
  const rpsW=Math.min(d.requestsPerSecond*5,100);
  document.getElementById('rps-bar').style.width=rpsW+'%';

  // Blocked IPs
  const bt=document.getElementById('blocked-body');
  if(d.blockedIPs.length===0){
    bt.innerHTML='<tr><td colspan="3" style="color:#64748b">No blocks yet</td></tr>';
  } else {
    bt.innerHTML=d.blockedIPs.slice(0,20).map(b=>
      \`<tr><td class="blocked-ip">\${b.ip}</td><td><span class="tag tag-block">\${b.reason}</span></td><td style="color:#64748b">\${b.time.replace('T',' ').slice(0,19)}</td></tr>\`
    ).join('');
  }

  // Recent requests
  const rt=document.getElementById('req-body');
  rt.innerHTML=d.recentRequests.slice(0,20).map(r=>
    \`<tr><td>\${r.ip}</td><td><span class="tag tag-ok">\${r.method}</span></td><td>\${r.url}</td><td style="color:#64748b">\${r.time.replace('T',' ').slice(0,19)}</td></tr>\`
  ).join('');
}
refresh();
setInterval(refresh,1500);
</script>
</body>
</html>`;
  }
}

module.exports = { Dashboard };
