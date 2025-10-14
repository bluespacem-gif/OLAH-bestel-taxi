const express = require("express");
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("ESP8266 Server is alive!");
});

app.post("/req", (req, res) => {
  console.log(req.body);
  res.send("Data received OK");
});

app.listen(3000, () => console.log("Server running on port 3000"));
