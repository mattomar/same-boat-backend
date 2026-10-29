const express = require("express");
const router = express.Router();
const authenticateToken = require("../middlewares/auth");
const dm = require("../services/dmService");
const { emitters } = require("../socket/dmSocket");

// Wraps handlers so errors always come back as { message } JSON (Express 4 doesn't catch async errors).
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof dm.HttpError) {
      return res.status(err.status).json({ message: err.message, ...err.extra });
    }
    console.error("Direct message route error:", err);
    return res.status(500).json({ message: "Something went wrong." });
  }
};

router.get("/ping", (req, res) => res.send("Message route active"));

// Relationship with another user: none | friends | conversation | pending_sent | pending_received | declined
router.get("/status/:userId", authenticateToken, handle(async (req, res) => {
  res.json(await dm.getRelationship(req.user.id, req.params.userId));
}));

// ---- conversations ----
router.get("/conversations", authenticateToken, handle(async (req, res) => {
  res.json(await dm.listConversations(req.user.id));
}));

router.post("/conversations/with/:userId", authenticateToken, handle(async (req, res) => {
  const conv = await dm.getOrCreateConversation(req.user.id, req.params.userId);
  res.json({ conversationId: conv.id });
}));

router.get("/conversations/:conversationId/messages", authenticateToken, handle(async (req, res) => {
  res.json(await dm.getMessages(req.user.id, req.params.conversationId, req.query));
}));

router.post("/conversations/:conversationId/messages", authenticateToken, handle(async (req, res) => {
  const { conversation, message } = await dm.sendMessage(
    req.user.id,
    req.params.conversationId,
    req.body && req.body.text,
  );
  emitters.messageCreated(conversation, message);
  res.status(201).json(message);
}));

// ---- message requests ----
router.get("/requests/incoming", authenticateToken, handle(async (req, res) => {
  res.json(await dm.listIncomingRequests(req.user.id));
}));

router.get("/requests/outgoing", authenticateToken, handle(async (req, res) => {
  res.json(await dm.listOutgoingRequests(req.user.id));
}));

router.post("/requests/send/:receiverId", authenticateToken, handle(async (req, res) => {
  const request = await dm.sendRequest(req.user.id, req.params.receiverId, req.body && req.body.text);
  emitters.requestCreated(request);
  res.status(201).json(request);
}));

router.post("/requests/accept/:requestId", authenticateToken, handle(async (req, res) => {
  const result = await dm.acceptRequest(req.user.id, req.params.requestId);
  emitters.requestAccepted(result);
  res.json({ request: result.request, conversationId: result.conversation.id });
}));

router.post("/requests/decline/:requestId", authenticateToken, handle(async (req, res) => {
  const request = await dm.declineRequest(req.user.id, req.params.requestId);
  emitters.requestDeclined(request);
  res.json({ request });
}));

router.post(
  "/conversations/:conversationId/read",
  authenticateToken,
  handle(async (req, res) => {
    res.json(
      await dm.markConversationRead(req.user.id, req.params.conversationId),
    );
  }),
);
module.exports = router;
