// Direct messages run on their own "/dm" namespace so the anonymous random-chat
// events on the default namespace are untouched.

const jwt = require("jsonwebtoken");

const { User, Block, Conversation } = require("../models");

const { Op } = require("sequelize");
const dm = require("../services/dmService");

let nsp = null;

const userRoom = (id) => `dm:user:${id}`;
const convRoom = (id) => `dm:conv:${id}`;

// --------------------------------------------------
// BLOCK CHECK
// --------------------------------------------------

const isBlocked = async (userA, userB) => {
  if (!userA || !userB || String(userA) === String(userB)) {
    return false;
  }

  const block = await Block.findOne({
    where: {
      [Op.or]: [
        {
          blockerId: userA,
          blockedUserId: userB,
        },
        {
          blockerId: userB,
          blockedUserId: userA,
        },
      ],
    },
  });

  return Boolean(block);
};

// --------------------------------------------------
// SOCKET EMITTERS
// Called by REST routes AFTER the DB write succeeded.
// --------------------------------------------------

const emitters = {
  messageCreated(conversation, message) {
    if (!nsp) return;

    nsp.to(convRoom(conversation.id)).emit("dm:message", message);

    nsp
      .to(userRoom(conversation.user1Id))
      .to(userRoom(conversation.user2Id))
      .emit("dm:conversation:updated", {
        conversationId: conversation.id,
        lastMessage: message,
      });
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

    nsp.to(userRoom(request.senderId)).emit("dm:request:declined", {
      requestId: request.id,
    });
  },

  messageDeleted(conversation, message) {
    if (!nsp) return;

    nsp.to(convRoom(conversation.id)).emit("dm:message:deleted", message);

    nsp
      .to(userRoom(conversation.user1Id))
      .to(userRoom(conversation.user2Id))
      .emit("dm:conversation:updated", {
        conversationId: conversation.id,
        lastMessage: message,
      });
  },

  conversationDeleted(conversationId, userId) {
    if (!nsp) return;

    nsp.to(userRoom(userId)).emit("dm:conversation:deleted", {
      conversationId,
    });
  },

  // --------------------------------------------------
  // BLOCK USERS
  // Remove both users from their existing DM room.
  // --------------------------------------------------

  async usersBlocked(userA, userB) {
    if (!nsp) return;

    try {
      const conversations = await Conversation.findAll({
        where: {
          [Op.or]: [
            {
              user1Id: userA,
              user2Id: userB,
            },
            {
              user1Id: userB,
              user2Id: userA,
            },
          ],
        },
        attributes: ["id"],
      });

      if (!conversations.length) return;

      // Get every active socket belonging to either user.
      const [socketsA, socketsB] = await Promise.all([
        nsp.in(userRoom(userA)).fetchSockets(),
        nsp.in(userRoom(userB)).fetchSockets(),
      ]);

      const allSockets = [...socketsA, ...socketsB];

      // Remove all their active sockets from each conversation room.
      for (const conversation of conversations) {
        const room = convRoom(conversation.id);

        for (const socket of allSockets) {
          await socket.leave(room);
        }

        // Tell both users that the conversation is no longer available.
        nsp
          .to(userRoom(userA))
          .to(userRoom(userB))
          .emit("dm:conversation:deleted", {
            conversationId: conversation.id,
          });
      }
    } catch (error) {
      console.error("usersBlocked socket error:", error);
    }
  },
};

// --------------------------------------------------
// SETUP DIRECT MESSAGES
// --------------------------------------------------

function setupDirectMessages(io) {
  if (nsp) return nsp;

  nsp = io.of("/dm");

  // Authenticate socket using the same JWT scheme as REST.
  nsp.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;

      if (!token) {
        return next(new Error("unauthorized"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await User.findByPk(decoded.userId, {
        attributes: ["id"],
      });

      if (!user) {
        return next(new Error("unauthorized"));
      }

      socket.data.userId = user.id;

      next();
    } catch (error) {
      next(new Error("unauthorized"));
    }
  });

  nsp.on("connection", (socket) => {
    const me = socket.data.userId;

    // Every connected device joins this user's private room.
    socket.join(userRoom(me));

    // --------------------------------------------------
    // JOIN CONVERSATION
    // --------------------------------------------------

    socket.on("dm:join", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};

      try {
        const conv = await dm.getParticipantConversation(
          payload && payload.conversationId,
          me,
        );

        // Extra socket-level block check.
        const otherUserId =
          String(conv.user1Id) === String(me) ? conv.user2Id : conv.user1Id;

        if (await isBlocked(me, otherUserId)) {
          await socket.leave(convRoom(conv.id));

          return reply({
            ok: false,
            error: "Conversation not found.",
          });
        }

        await socket.join(convRoom(conv.id));

        reply({ ok: true });
      } catch (error) {
        reply({
          ok: false,
          error: error.status ? error.message : "Could not join conversation.",
        });
      }
    });

    // --------------------------------------------------
    // LEAVE CONVERSATION
    // --------------------------------------------------

    socket.on("dm:leave", (payload) => {
      const id = Number(payload && payload.conversationId);

      if (Number.isInteger(id)) {
        socket.leave(convRoom(id));
      }
    });

    // --------------------------------------------------
    // SEND MESSAGE
    // --------------------------------------------------

    socket.on("dm:send", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};

      try {
        // Validate conversation membership.
        const conv = await dm.getParticipantConversation(
          payload && payload.conversationId,
          me,
        );

        const otherUserId =
          String(conv.user1Id) === String(me) ? conv.user2Id : conv.user1Id;

        // Reject messages if either user has blocked the other.
        if (await isBlocked(me, otherUserId)) {
          await socket.leave(convRoom(conv.id));

          return reply({
            ok: false,
            error: "Conversation not found.",
          });
        }

        const { conversation, message } = await dm.sendMessage(
          me,
          payload && payload.conversationId,
          payload && payload.text,
        );

        emitters.messageCreated(conversation, message);

        reply({
          ok: true,
          message,
        });
      } catch (error) {
        if (!error.status) {
          console.error("dm:send error:", error);
        }

        reply({
          ok: false,
          error: error.status ? error.message : "Could not send message.",
        });
      }
    });
  });

  return nsp;
}

module.exports = {
  setupDirectMessages,
  emitters,
};
