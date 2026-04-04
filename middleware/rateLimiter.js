const requests = {};

module.exports = function (req, res, next) {
  const ip = req.ip;
  const currentTime = Date.now();

  if (!requests[ip]) {
    requests[ip] = [];
  }

  // Keep only last 60 seconds requests
  requests[ip] = requests[ip].filter(
    (timestamp) => currentTime - timestamp < 60000
  );

  // Limit: 10 requests per minute
  if (requests[ip].length >= 10) {
    console.log(`Blocked IP: ${ip}`);
    return res.status(429).send("Too many requests! Blocked.");
  }

  requests[ip].push(currentTime);
  next();
};