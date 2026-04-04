const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const rateLimiter = require("./middleware/rateLimiter");
const security = require("./middleware/security");

const app = express();

// Apply rate limiting
app.use(rateLimiter);
app.use(express.json());
app.use(security);

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