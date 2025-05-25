require("dotenv").config(); // load env variables once, at top

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const sessionMiddleware = require("./middlewares/sessionMiddleware");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoute");
const profileRoutes = require("./routes/profileRoute"); // adjust path
const setupMatching = require("./matchingLogic");
const { sequelize } = require("./config/db");
const authenticateToken = require("./middlewares/auth");

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

// Start server only if NOT in test environment
if (process.env.NODE_ENV !== "test") {
  server.listen(3004, () => {
    console.log("🚀 Server running on http://localhost:3003");
  });
}