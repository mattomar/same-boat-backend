require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sessionMiddleware = require("./middlewares/sessionMiddleware");
const userRoutes = require("./routes/userRoutes");
const setupMatching = require("./matchingLogic"); // <-- the file with the io logic

const app = express();
const server = http.createServer(app); // use http for socket.io
const io = new Server(server);

// Apply session middleware to Express
app.use(sessionMiddleware);
app.use(express.json());
app.use("/user", userRoutes);

// Apply session middleware to Socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Start the matching logic
setupMatching(io);

// Start the server
server.listen(3000, () => {
  console.log("Server running on port 3000");
});
