const requests = {};

module.exports = function (req, res, next) {
  const ip = req.ip;
  const currentTime = Date.now();

  if (!requests[ip]) {
    requests[ip] = [];
  }

  // keep only last 60 seconds
  requests[ip] = requests[ip].filter(
    (timestamp) => currentTime - timestamp < 60000
  );

  // limit = 10 requests per minute
  if (requests[ip].length >= 10) {
    return res.status(429).send("Too many requests!");
  }

  requests[ip].push(currentTime);
  next();
};
