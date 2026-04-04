let blockedRequests = 0;

function rateLimiter(req, res, next) {
  const ip = req.ip;
  const currentTime = Date.now();

  if (!global.requests) {
    global.requests = {};
  }

  if (!global.requests[ip]) {
    global.requests[ip] = [];
  }

  global.requests[ip] = global.requests[ip].filter(
    (t) => currentTime - t < 60000
  );

  if (global.requests[ip].length >= 10) {
    blockedRequests++;
    return res.status(429).send("Too many requests! Blocked.");
  }

  global.requests[ip].push(currentTime);
  next();
}

rateLimiter.getBlocked = () => blockedRequests;

module.exports = rateLimiter;