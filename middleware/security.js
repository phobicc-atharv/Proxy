module.exports = function (req, res, next) {
  const data = JSON.stringify(req.body) + req.url;

  const attackPatterns = [
    "DROP TABLE",
    "SELECT *",
    "INSERT INTO",
    "<script>",
    "OR 1=1",
    "--",
  ];

  for (let pattern of attackPatterns) {
    if (data.toLowerCase().includes(pattern.toLowerCase())) {
      console.log("Blocked malicious request:", pattern);
      return res.status(403).send("Malicious request blocked!");
    }
  }

  next();
};