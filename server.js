const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const rateLimiter = require("./middleware/rateLimiter");
const security = require("./middleware/security");

const app = express();

let totalRequests = 0;

// Count all requests
app.use((req, res, next) => {
  totalRequests++;
  next();
});

// Middlewares
app.use(rateLimiter);
app.use(express.json());
app.use(security);

// ✅ Dashboard API (ADD THIS)
app.get("/dashboard", (req, res) => {
  const blocked = rateLimiter.getBlocked();

  res.json({
    totalRequests,
    blockedRequests: blocked,
    allowedRequests: totalRequests - blocked,
  });
});

// Proxy
app.use(
  "/",
  createProxyMiddleware({
    target: "http://localhost:8080",
    changeOrigin: true,
  })
);

app.listen(9090, () => {
  console.log("Proxy running on port 9090");
});