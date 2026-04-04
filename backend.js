const express = require("express");
const app = express();

app.get("/test", (req, res) => {
  res.send("Backend is working!");
});

app.listen(8080, () => {
  console.log("Backend running on port 8080");
});