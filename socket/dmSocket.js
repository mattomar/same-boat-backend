// Direct messages run on their own "/dm" namespace so the anonymous random-chat
// events on the default namespace are untouched.
const jwt = require("jsonwebtoken");
const { User } = require("../models");
const dm = require("../services/dmService");

let nsp = null;
const userRoom = (id) => `dm:user:${id}`;
const convRoom = (id) => `dm:conv:${id}`;

// Called by REST routes and socket handlers AFTER the DB write succeeded.
const emitters = {
  messageCreated(conversation, message) {
    if (!nsp) return;
    nsp.to(convRoom(conversation.id)).emit("dm:message", message);
    nsp
      .to(userRoom(conversation.user1Id))
      .to(userRoom(conversation.user2Id))
      .emit("dm:conversation:updated", { conversationId: conversation.id, lastMessage: message });
  },
  requestCreated(request) {
    if (!nsp) return;
    nsp.to(userRoom(request.receiverId)).emit("dm:request:new", request);
  },
  requestAccepted({ request, conversation, message }) {
    if (!nsp) return;
    nsp
      .to(userRoom(request.senderId))
      .to(userRoom(request.receiverId))
      .emit("dm:request:accepted", {
        requestId: request.id,
        conversationId: conversation.id,
        message,
      });
  },
  requestDeclined(request) {
    if (!nsp) return;
    nsp.to(userRoom(request.senderId)).emit("dm:request:declined", { requestId: request.id });
  },
};

function setupDirectMessages(io) {
  if (nsp) return nsp; // never register twice
  nsp = io.of("/dm");

  // Same JWT scheme as authenticateToken (payload.userId, JWT_SECRET)
  nsp.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error("unauthorized"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.userId, { attributes: ["id"] });
      if (!user) return next(new Error("unauthorized"));
      socket.data.userId = user.id;
      next();
    } catch (err) {
      next(new Error("unauthorized"));
    }
  });

  nsp.on("connection", (socket) => {
    const me = socket.data.userId;
    socket.join(userRoom(me));

    socket.on("dm:join", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const conv = await dm.getParticipantConversation(payload && payload.conversationId, me);
        await socket.join(convRoom(conv.id));
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false, error: err.status ? err.message : "Could not join conversation." });
      }
    });

    socket.on("dm:leave", (payload) => {
      const id = Number(payload && payload.conversationId);
      if (Number.isInteger(id)) socket.leave(convRoom(id));
    });

    socket.on("dm:send", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const { conversation, message } = await dm.sendMessage(
          me,
          payload && payload.conversationId,
          payload && payload.text,
        );
        emitters.messageCreated(conversation, message);
        reply({ ok: true, message });
      } catch (err) {
        if (!err.status) console.error("dm:send error:", err);
        reply({ ok: false, error: err.status ? err.message : "Could not send message." });
      }
    });
  });

  return nsp;
}

module.exports = { setupDirectMessages, emitters };
