// All direct-message business rules live here so REST and Socket.IO share them.
const { Op, UniqueConstraintError } = require("sequelize");
const db = require("../models");

const { Conversation, Message, MessageRequest, FriendRequest, User } = db;

const USER_ATTRIBUTES = ["id", "username", "firstName", "lastName", "avatarUrl"];
const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
// After a decline, the sender must wait this long before asking again.
const REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---------- helpers ----------
const parseId = (value, label = "id") => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return n;
};

const cleanText = (text) => {
  if (typeof text !== "string") throw new HttpError(400, "Message text is required.");
  const trimmed = text.trim();
  if (!trimmed) throw new HttpError(400, "Message cannot be empty.");
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(400, `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
  }
  return trimmed;
};

const orderPair = (a, b) => (a < b ? [a, b] : [b, a]);
const makePairKey = (a, b) => orderPair(a, b).join(":");

const plainUser = (u) =>
  u && {
    id: u.id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    avatarUrl: u.avatarUrl,
  };

const toMessageJSON = (m) => ({
  id: m.id,
  conversationId: m.conversationId,
  senderId: m.senderId,
  text: m.text,
  createdAt: m.createdAt,
  readAt: m.readAt,
});

const toRequestJSON = (r) => ({
  id: r.id,
  senderId: r.senderId,
  receiverId: r.receiverId,
  status: r.status,
  initialMessage: r.initialMessage,
  conversationId: r.conversationId,
  createdAt: r.createdAt,
  respondedAt: r.respondedAt,
  sender: plainUser(r.sender),
  receiver: plainUser(r.receiver),
});

const requireUser = async (id) => {
  const user = await User.findByPk(id, { attributes: USER_ATTRIBUTES });
  if (!user) throw new HttpError(404, "User not found.");
  return user;
};



// Reuses the existing FriendRequest table: an "accepted" row in either direction.
const areFriends = async (a, b) =>
  !!(await FriendRequest.findOne({
    where: {
      status: "accepted",
      [Op.or]: [
        { senderId: a, receiverId: b },
        { senderId: b, receiverId: a },
      ],
    },
  }));

const findConversation = (a, b) => {
  const [user1Id, user2Id] = orderPair(a, b);
  return Conversation.findOne({ where: { user1Id, user2Id } });
};

const findOrCreateConversation = async (a, b, transaction) => {
  const [user1Id, user2Id] = orderPair(a, b);
  try {
    const [conv] = await Conversation.findOrCreate({
      where: { user1Id, user2Id },
      defaults: { user1Id, user2Id },
      transaction,
    });
    return conv;
  } catch (err) {
    if (err instanceof UniqueConstraintError && !transaction) return findConversation(a, b);
    throw err;
  }
};

// 404 for both "missing" and "not yours" so conversation ids can't be probed.
const getParticipantConversation = async (conversationId, userId) => {
  const id = parseId(conversationId, "conversation id");
  const conv = await Conversation.findByPk(id);
  if (!conv || (conv.user1Id !== userId && conv.user2Id !== userId)) {
    throw new HttpError(404, "Conversation not found.");
  }
  return conv;
};

const otherParticipantId = (conv, me) => (conv.user1Id === me ? conv.user2Id : conv.user1Id);

// ---------- relationship (drives the Message button) ----------
const getRelationship = async (me, otherIdRaw) => {
  const otherId = parseId(otherIdRaw, "user id");
  if (otherId === me) throw new HttpError(400, "You can't message yourself.");
  await requireUser(otherId);

  const base = { conversationId: null, requestId: null, canRequestAgain: false };

  const conv = await findConversation(me, otherId);
  if (conv) return { ...base, status: "conversation", conversationId: conv.id };

  if (await areFriends(me, otherId)) return { ...base, status: "friends" };

  const pending = await MessageRequest.findOne({
    where: { pairKey: makePairKey(me, otherId), status: "pending" },
  });
  if (pending) {
    if (pending.senderId === me) {
      return { ...base, status: "pending_sent", requestId: pending.id };
    }
    return {
      ...base,
      status: "pending_received",
      requestId: pending.id,
      initialMessage: pending.initialMessage,
    };
  }

  const declined = await MessageRequest.findOne({
    where: { senderId: me, receiverId: otherId, status: "declined" },
    order: [["respondedAt", "DESC"]],
  });
  if (declined) {
    const retryAt = new Date(new Date(declined.respondedAt).getTime() + REQUEST_COOLDOWN_MS);
    const canRequestAgain = retryAt <= new Date();
    return {
      ...base,
      status: "declined",
      requestId: declined.id,
      canRequestAgain,
      ...(canRequestAgain ? {} : { retryAt }),
    };
  }

  return { ...base, status: "none", canRequestAgain: true };
};

// ---------- conversations ----------
const getOrCreateConversation = async (me, otherIdRaw) => {
  const otherId = parseId(otherIdRaw, "user id");
  if (otherId === me) throw new HttpError(400, "You can't message yourself.");
  await requireUser(otherId);

  const existing = await findConversation(me, otherId);
  if (existing) return existing;

  if (await areFriends(me, otherId)) return findOrCreateConversation(me, otherId);

  throw new HttpError(403, "You need to send a message request first.", {
    code: "REQUEST_REQUIRED",
  });
};

const listConversations = async (me) => {
  const convs = await Conversation.findAll({
    where: { [Op.or]: [{ user1Id: me }, { user2Id: me }] },
    order: [
      ["lastMessageAt", "DESC NULLS LAST"],
      ["id", "DESC"],
    ],
    limit: 100,
  });

  const otherIds = convs.map((c) => otherParticipantId(c, me));
  const users = otherIds.length
    ? await User.findAll({ where: { id: otherIds }, attributes: USER_ATTRIBUTES })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const lastMessages = await Promise.all(
    convs.map((c) =>
      Message.findOne({ where: { conversationId: c.id }, order: [["id", "DESC"]] }),
    ),
  );

  const unreadCounts = await Promise.all(
    convs.map((c) =>
      Message.count({
        where: {
          conversationId: c.id,
          senderId: { [Op.ne]: me },
          readAt: null,
        },
      }),
    ),
  );

  return convs.map((c, i) => ({
    id: c.id,
    otherUser: plainUser(userMap.get(otherParticipantId(c, me))),
    lastMessage: lastMessages[i] ? toMessageJSON(lastMessages[i]) : null,
    lastMessageAt: c.lastMessageAt,
    unreadCount: unreadCounts[i],
  }));
};

// ---------- messages ----------
const getMessages = async (me, conversationId, { limit, before } = {}) => {
  const conv = await getParticipantConversation(conversationId, me);

  let pageSize = Number.parseInt(limit, 10);
  if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  pageSize = Math.min(pageSize, MAX_PAGE_SIZE);

  const where = { conversationId: conv.id };
  if (before !== undefined && before !== "") where.id = { [Op.lt]: parseId(before, "cursor") };

  const rows = await Message.findAll({
    where,
    order: [["id", "DESC"]],
    limit: pageSize + 1,
  });
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize).reverse();
  const other = await requireUser(otherParticipantId(conv, me));

  return {
    conversation: { id: conv.id, otherUser: plainUser(other) },
    messages: page.map(toMessageJSON),
    hasMore,
  };
};

// Persists first; callers broadcast only after this resolves.
const sendMessage = async (me, conversationId, text) => {
  const conv = await getParticipantConversation(conversationId, me);
  const body = cleanText(text);
  const message = await Message.create({ conversationId: conv.id, senderId: me, text: body });
  await conv.update({ lastMessageAt: message.createdAt });
  return { conversation: conv, message: toMessageJSON(message) };
};

// ---------- message requests ----------
const sendRequest = async (me, receiverIdRaw, text) => {
  const receiverId = parseId(receiverIdRaw, "user id");
  if (receiverId === me) throw new HttpError(400, "You can't message yourself.");
  const receiver = await requireUser(receiverId);
  const body = cleanText(text);

  const rel = await getRelationship(me, receiverId);
  if (rel.status === "conversation" || rel.status === "friends") {
    throw new HttpError(409, "You can message this user directly.", {
      code: "DIRECT_MESSAGE_ALLOWED",
      conversationId: rel.conversationId,
    });
  }
  if (rel.status === "pending_sent") {
    throw new HttpError(409, "You already have a pending request to this user.", {
      code: "REQUEST_PENDING",
      requestId: rel.requestId,
    });
  }
  if (rel.status === "pending_received") {
    throw new HttpError(409, "This user already sent you a request. Respond to it instead.", {
      code: "REQUEST_INCOMING",
      requestId: rel.requestId,
    });
  }
  if (rel.status === "declined" && !rel.canRequestAgain) {
    throw new HttpError(403, "Your last request was declined. Try again later.", {
      code: "REQUEST_COOLDOWN",
      retryAt: rel.retryAt,
    });
  }

  let request;
  try {
    request = await MessageRequest.create({
      senderId: me,
      receiverId,
      initialMessage: body,
      pairKey: makePairKey(me, receiverId),
      status: "pending",
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new HttpError(409, "A pending request already exists between you two.", {
        code: "REQUEST_PENDING",
      });
    }
    throw err;
  }

  request.sender = await User.findByPk(me, { attributes: USER_ATTRIBUTES });
  request.receiver = receiver;
  return toRequestJSON(request);
};

const listIncomingRequests = async (me) => {
  const rows = await MessageRequest.findAll({
    where: { receiverId: me, status: "pending" },
    include: [{ model: User, as: "sender", attributes: USER_ATTRIBUTES }],
    order: [["createdAt", "DESC"]],
    limit: 100,
  });
  return rows.map(toRequestJSON);
};

const listOutgoingRequests = async (me) => {
  const rows = await MessageRequest.findAll({
    where: { senderId: me },
    include: [{ model: User, as: "receiver", attributes: USER_ATTRIBUTES }],
    order: [["createdAt", "DESC"]],
    limit: 50,
  });
  return rows.map(toRequestJSON);
};

const loadPendingRequestForReceiver = async (me, requestIdRaw, transaction) => {
  const id = parseId(requestIdRaw, "request id");
  const request = await MessageRequest.findByPk(id, {
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });
  if (!request) throw new HttpError(404, "Message request not found.");
  if (request.receiverId !== me) throw new HttpError(403, "Not allowed.");
  if (request.status !== "pending") throw new HttpError(409, "Request already handled.");
  return request;
};

// Accepting creates the conversation and turns the stored first message into a real one.
const acceptRequest = async (me, requestIdRaw) =>
  db.sequelize.transaction(async (t) => {
    const request = await loadPendingRequestForReceiver(me, requestIdRaw, t);
    const conversation = await findOrCreateConversation(request.senderId, request.receiverId, t);

    const message = await Message.create(
      {
        conversationId: conversation.id,
        senderId: request.senderId,
        text: request.initialMessage,
        createdAt: request.createdAt,
      },
      { transaction: t },
    );

    const last = conversation.lastMessageAt && new Date(conversation.lastMessageAt);
    if (!last || last < message.createdAt) {
      await conversation.update({ lastMessageAt: message.createdAt }, { transaction: t });
    }
    await request.update(
      { status: "accepted", respondedAt: new Date(), conversationId: conversation.id },
      { transaction: t },
    );

    return {
      request: toRequestJSON(request),
      conversation,
      message: toMessageJSON(message),
    };
  });

const declineRequest = async (me, requestIdRaw) =>
  db.sequelize.transaction(async (t) => {
    const request = await loadPendingRequestForReceiver(me, requestIdRaw, t);
    await request.update({ status: "declined", respondedAt: new Date() }, { transaction: t });
    return toRequestJSON(request);
  });

  const markConversationRead = async (me, conversationId) => {
    const conv = await getParticipantConversation(conversationId, me);

    await Message.update(
      { readAt: new Date() },
      {
        where: {
          conversationId: conv.id,
          senderId: { [Op.ne]: me },
          readAt: null,
        },
      },
    );

    return { success: true };
  };

module.exports = {
  HttpError,
  getRelationship,
  getOrCreateConversation,
  getParticipantConversation,
  listConversations,
  getMessages,
  sendMessage,
  sendRequest,
  listIncomingRequests,
  listOutgoingRequests,
  acceptRequest,
  declineRequest,
  otherParticipantId,
  markConversationRead,
};
