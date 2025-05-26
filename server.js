require("dotenv").config(); // load env variables once, at top

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const sessionMiddleware = require("./middlewares/sessionMiddleware");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoute");
const profileRoutes = require("./routes/profileRoute");
const setupMatching = require("./matchingLogic");
const postRoutes = require("./routes/postRoute");
const authenticateToken = require("./middlewares/auth");
const db = require("./models"); // ✅ import models

const app = express();
const server = http.createServer(app);

// Middleware setup
app.use(cors({
  origin: "http://localhost:30056",
  credentials: true,
}));

app.use(sessionMiddleware);
app.use(express.json());
app.use("/user", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/profile", profileRoutes);
app.use("/posts", postRoutes);

app.get("/protected", authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: "http://localhost:30056",
    credentials: true,
  },
});

// Session for sockets
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

setupMatching(io);

// Export app and server separately for testing
module.exports = { app, server };

// ✅ Sync and seed before starting server
if (process.env.NODE_ENV !== "test") {
  db.sequelize.sync({ alter: true }).then(async () => {
    const categories = ["TV/Movies", "Books", "Brainrot", "General", "Cooking"];
    for (const name of categories) {
      await db.Category.findOrCreate({ where: { name } });
    }

    server.listen(3008, () => {
      console.log("🚀 Server running on http://localhost:3004");
    });
  }).catch((err) => {
    console.error("❌ Failed to sync DB:", err);
  });
}