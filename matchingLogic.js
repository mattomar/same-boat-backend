const jwt = require("jsonwebtoken");
const { User } = require("./models");

let waitingUser = null;

// Reveal state for every active random-chat room.
// room -> { a, b, status: "none" | "pending" | "revealed" | "declined", requester }
const rooms = new Map();

const canReveal = (entry) =>
  Boolean(
    entry.a.userId && entry.b.userId && entry.a.userId !== entry.b.userId,
  );

const partnerOf = (entry, socket) => (entry.a === socket ? entry.b : entry.a);

// Only the two sockets that were matched into a room may touch it.
const getEntry = (socket, room) => {
  const entry = typeof room === "string" ? rooms.get(room) : null;
  return entry && (entry.a === socket || entry.b === socket) ? entry : null;
};

// Names always come from the database, never from anything the client sends.
const loadPublicUser = async (id) => {
  const u = await User.findByPk(id, {
    attributes: ["id", "username", "firstName", "lastName", "avatarUrl"],
  });
  return u
    ? {
        id: u.id,
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        avatarUrl: u.avatarUrl,
      }
    : null;
};

const stateFor = async (entry, socket) => {
  if (!canReveal(entry)) return { available: false };
  if (entry.status === "pending") {
    return {
      available: true,
      status:
        entry.requester === socket ? "requested_by_me" : "requested_by_them",
    };
  }
  if (entry.status === "revealed") {
    return {
      available: true,
      status: "revealed",
      partner: await loadPublicUser(partnerOf(entry, socket).userId),
    };
  }
  return { available: true, status: entry.status };
};

const addRevealListeners = (clientSocket) => {
  clientSocket.on("reveal:state", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    try {
      const entry = getEntry(clientSocket, payload && payload.room);
      reply(entry ? await stateFor(entry, clientSocket) : { available: false });
    } catch (err) {
      reply({ available: false });
    }
  });

  clientSocket.on("reveal:request", (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    const room = payload && payload.room;
    const entry = getEntry(clientSocket, room);
    if (!entry || !canReveal(entry)) {
      return reply({
        ok: false,
        error: "Reveal isn't available in this chat.",
      });
    }
    if (entry.status === "revealed")
      return reply({ ok: false, error: "Names are already revealed." });
    if (entry.status === "declined")
      return reply({ ok: false, error: "Your partner declined to reveal." });
    if (entry.status === "pending") {
      return reply({
        ok: false,
        error:
          entry.requester === clientSocket
            ? "Request already sent."
            : "Your partner already asked. Respond to their request.",
      });
    }
    entry.status = "pending";
    entry.requester = clientSocket;
    partnerOf(entry, clientSocket).emit("reveal:requested", { room });
    reply({ ok: true });
  });

  clientSocket.on("reveal:respond", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    try {
      const room = payload && payload.room;
      const entry = getEntry(clientSocket, room);
      if (
        !entry ||
        !canReveal(entry) ||
        entry.status !== "pending" ||
        entry.requester === clientSocket
      ) {
        return reply({ ok: false, error: "There's no request to respond to." });
      }

      if (!(payload && payload.accept === true)) {
        entry.status = "declined";
        entry.requester.emit("reveal:declined", { room });
        return reply({ ok: true });
      }

      entry.status = "revealed"; // set first so a double-click can't run this twice
      const [userA, userB] = await Promise.all([
        loadPublicUser(entry.a.userId),
        loadPublicUser(entry.b.userId),
      ]);
      if (!userA || !userB) {
        entry.status = "none";
        return reply({ ok: false, error: "Could not load profiles." });
      }
      entry.a.emit("reveal:accepted", { room, partner: userB });
      entry.b.emit("reveal:accepted", { room, partner: userA });
      reply({ ok: true });
    } catch (err) {
      console.error("reveal:respond error:", err);
      reply({ ok: false, error: "Something went wrong." });
    }
  });
};

module.exports = function (io) {
  // Optional login: a valid JWT marks the socket as a known user.
  // No token / bad token => the socket simply stays anonymous (never rejected).
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.userId, {
          attributes: ["id"],
        });
        if (user) socket.userId = user.id;
      }
    } catch (err) {
      // invalid or expired token: treat as anonymous
    }
    next();
  });

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    if (waitingUser && waitingUser.connected) {
      const room = `room-${waitingUser.id}-${socket.id}`;
      waitingUser.join(room);
      socket.join(room);

      rooms.set(room, {
        a: waitingUser,
        b: socket,
        status: "none",
        requester: null,
      });

      waitingUser.emit("matched", { room });
      socket.emit("matched", { room });

      const addChatListeners = (clientSocket) => {
        // Broadcast chat messages to the room (only members may post)
        clientSocket.on("chat message", ({ room, message }) => {
          if (!getEntry(clientSocket, room)) return;
          io.to(room).emit("chat message", {
            message,
            sender: clientSocket.id,
          });
        });

        // Broadcast typing status
        clientSocket.on("typing", ({ room }) => {
          if (!getEntry(clientSocket, room)) return;
          clientSocket
            .to(room)
            .emit("partner-typing", { sender: clientSocket.id });
        });

        // Handle end of session
        clientSocket.on("end session", ({ room }) => {
          if (!getEntry(clientSocket, room)) return;
          clientSocket.leave(room);
          clientSocket.to(room).emit("session ended");
          rooms.delete(room);
        });

        // Handle disconnection
        clientSocket.on("disconnect", () => {
          console.log(`User disconnected: ${clientSocket.id}`);
          clientSocket.to(room).emit("session ended");
          rooms.delete(room);
        });

        addRevealListeners(clientSocket);
      };

      addChatListeners(waitingUser);
      addChatListeners(socket);

      waitingUser = null;
    } else {
      waitingUser = socket;
      socket.emit("waiting");

      socket.on("disconnect", () => {
        console.log(`Waiting user disconnected: ${socket.id}`);
        if (waitingUser === socket) {
          waitingUser = null;
        }
      });
    }
  });
};
