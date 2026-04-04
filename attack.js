const axios = require("axios");

for (let i = 0; i < 50; i++) {
  axios.get("http://localhost:9090/test").catch(() => {});
}