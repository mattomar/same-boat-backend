require("dotenv").config(); // load env variables once, at top

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const sessionMiddleware = require("./middlewares/sessionMiddleware");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoute");
const setupMatching = require("./matchingLogic");
const { sequelize } = require("./config/db");
const authenticateToken = require("./middlewares/auth");


const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: "http://localhost:30056",
  credentials: true,
}));

app.use(sessionMiddleware);
app.use(express.json());
app.use("/user", userRoutes);
app.use("/api/auth", authRoutes);

app.get("/protected", authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

const io = new Server(server, {
  cors: {
    origin: "http://localhost:30056",
    credentials: true,
  },
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

setupMatching(io);

sequelize.sync({ alter: true })
  .then(() => {
    console.log("✅ DB synced");
    server.listen(3003, () => {
      console.log("🚀 Server running on http://localhost:3003");
    });
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err);
  });