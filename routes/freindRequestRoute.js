const express = require("express");
const router = express.Router();
const { FriendRequest, User, Notification } = require("../models");
const authenticateToken = require("../middlewares/auth");
const { Op, fn, col, where } = require("sequelize");
// Health check
router.get("/ping", (req, res) => {
  res.send("Friend route active");
});

// ========================
// SEND FRIEND REQUEST
// ========================
router.post("/send/:receiverId", authenticateToken, async (req, res) => {
  const { receiverId } = req.params;
  const senderId = req.user.id;

  if (parseInt(receiverId) === senderId) {
    return res
      .status(400)
      .json({ message: "You can't send a request to yourself." });
  }

  const existing = await FriendRequest.findOne({
    where: {
      [Op.or]: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    },
  });

  if (existing) {
    return res.status(400).json({ message: "Request already sent." });
  }

  await FriendRequest.create({ senderId, receiverId, status: "pending" });

  const sender = await User.findByPk(senderId);

  await Notification.create({
    userId: receiverId,
    senderId,
    type: "friend_request",
    message: `${sender.username} sent you a friend request`,
  });

  res.json({ message: "Friend request sent." });
});

// ========================
// ACCEPT FRIEND REQUEST
// ========================
router.post("/accept/:requestId", authenticateToken, async (req, res) => {
  const requestId = Number(req.params.requestId);

  if (!requestId) {
    return res.status(400).json({ message: "Invalid request id" });
  }

  const request = await FriendRequest.findByPk(requestId);

  if (!request) {
    return res.status(404).json({ message: "Friend request not found." });
  }

  if (request.receiverId !== req.user.id) {
    return res.status(403).json({ message: "Not allowed." });
  }

  if (request.status !== "pending") {
    return res.status(400).json({ message: "Already handled." });
  }

  request.status = "accepted";
  await request.save();

  await Notification.create({
    userId: request.senderId,
    senderId: req.user.id,
    type: "friend_accepted",
    message: `${req.user.username} accepted your friend request`,
  });

  return res.json({
    message: "Friend request accepted",
    requestId: request.id,
    senderId: request.senderId,
  });
});

// ========================
// DECLINE FRIEND REQUEST
// ========================
router.post("/decline/:requestId", authenticateToken, async (req, res) => {
  const request = await FriendRequest.findByPk(req.params.requestId);

  if (!request) {
    return res.status(404).json({ message: "Friend request not found." });
  }

  if (request.receiverId !== req.user.id) {
    return res.status(403).json({ message: "Not allowed." });
  }

  if (request.status !== "pending") {
    return res.status(400).json({ message: "Request already handled." });
  }

  request.status = "declined";
  await request.save();

  return res.json({
    message: "Friend request declined",
    requestId: request.id,
  });
});

// ========================
// GET FRIENDS
// ========================
router.get("/friends", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  const sent = await FriendRequest.findAll({
    where: { senderId: userId, status: "accepted" },
    include: [{ model: User, as: "receiver", attributes: ["id", "username"] }],
  });

  const received = await FriendRequest.findAll({
    where: { receiverId: userId, status: "accepted" },
    include: [{ model: User, as: "sender", attributes: ["id", "username"] }],
  });

  const friends = [
    ...sent.map((r) => r.receiver),
    ...received.map((r) => r.sender),
  ];

  res.json(friends);
});

// ========================
// REMOVE FRIEND
// ========================
router.delete("/:userId", authenticateToken, async (req, res) => {
  const friendship = await FriendRequest.findOne({
    where: {
      status: "accepted",
      [Op.or]: [
        {
          senderId: req.user.id,
          receiverId: req.params.userId,
        },
        {
          senderId: req.params.userId,
          receiverId: req.user.id,
        },
      ],
    },
  });

  if (!friendship) {
    return res.status(404).json({ message: "Friend not found" });
  }

  await friendship.destroy();

  res.json({ message: "Friend removed" });
});

// ========================
// SEARCH USERS
// ========================
router.get("/search", authenticateToken, async (req, res) => {
  const { username } = req.query;

  if (!username || username.trim() === "") {
    return res.json([]);
  }

  const requests = await FriendRequest.findAll({
    where: {
      [Op.or]: [{ senderId: req.user.id }, { receiverId: req.user.id }],
    },
  });

  const sent = new Set(
    requests.filter((r) => r.senderId === req.user.id).map((r) => r.receiverId),
  );

  const received = new Set(
    requests.filter((r) => r.receiverId === req.user.id).map((r) => r.senderId),
  );

const users = await User.findAll({
  where: {
    [Op.and]: [
      where(fn("LOWER", col("username")), {
        [Op.like]: `%${username.toLowerCase()}%`,
      }),
      {
        id: {
          [Op.ne]: req.user.id,
        },
      },
    ],
  },
  limit: 10,
});
const result = users.map((user) => {
  let status = "none";
  let requestId = null;

  const request = requests.find(
    (r) =>
      (r.senderId === req.user.id && r.receiverId === user.id) ||
      (r.receiverId === req.user.id && r.senderId === user.id),
  );

  if (request) {
    requestId = request.id;

    if (request.status === "pending") {
      status =
        request.senderId === req.user.id ? "pending_sent" : "pending_received";
    }

    if (request.status === "accepted") status = "friends";
    if (request.status === "declined") status = "none";
  }

  return {
    id: user.id,
    username: user.username,
    status,
    requestId,
  };
});
  console.log("USER ID:", req.user.id);
  console.log("USERNAME QUERY:", req.query.username);

  res.json(result);
});

// ========================
// GET STATUS
// ========================
router.get("/status/:userId", authenticateToken, async (req, res) => {
  const myId = req.user.id;
  const otherId = parseInt(req.params.userId);

  const request = await FriendRequest.findOne({
    where: {
      [Op.or]: [
        { senderId: myId, receiverId: otherId },
        { senderId: otherId, receiverId: myId },
      ],
    },
  });

  if (!request) {
    return res.json({
      status: "none",
      requestId: null,
    });
  }

  if (request.senderId === myId) {
    return res.json({
      status: request.status === "accepted" ? "friends" : "pending_sent",
      requestId: request.id,
    });
  }

  if (request.receiverId === myId) {
    return res.json({
      status: request.status === "accepted" ? "friends" : "pending_received",
      requestId: request.id,
    });
  }

  return res.json({
    status: request.status,
    requestId: request.id,
  });
});
module.exports = router;
