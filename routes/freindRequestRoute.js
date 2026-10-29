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

const friendRequest = await FriendRequest.create({
  senderId,
  receiverId,
  status: "pending",
});

const sender = await User.findByPk(senderId);

await Notification.create({
  userId: receiverId,
  senderId,
  type: "friend_request",
  friendRequestId: friendRequest.id,
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
    return res.status(400).json({ message: "Request already handled." });
  }

  request.status = "accepted";
  await request.save();

  // Who sent the request? (so the receiver's notification can name them)
  const requester = await User.findByPk(request.senderId, {
    attributes: ["id", "username"],
  });
  const requesterName = requester ? requester.username : "this user";
  const receiverMessage = `You accepted ${requesterName}'s friend request`;

  // Update the original notification
  const notification = await Notification.findOne({
    where: {
      friendRequestId: request.id,
      userId: req.user.id,
      type: "friend_request",
    },
  });

  if (notification) {
    notification.type = "friend_accepted";
    notification.message = receiverMessage;
    notification.handled = true;
    notification.isRead = true;

    await notification.save();
  }

  // Notify the person who sent the request
  await Notification.create({
    userId: request.senderId,
    senderId: req.user.id,
    type: "friend_accepted",
    message: `${req.user.username} accepted your friend request`,
  });

  return res.json({
    message: "Friend request accepted",
    notificationMessage: receiverMessage,
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

  const requester = await User.findByPk(request.senderId, {
    attributes: ["id", "username"],
  });
  const requesterName = requester ? requester.username : "this user";
  const receiverMessage = `You declined ${requesterName}'s friend request`;

  // Update the original notification
  const notification = await Notification.findOne({
    where: {
      friendRequestId: request.id,
      userId: req.user.id,
      type: "friend_request",
    },
  });

  if (notification) {
    notification.type = "friend_declined";
    notification.message = receiverMessage;
    notification.handled = true;
    notification.isRead = true;

    await notification.save();
  }

  return res.json({
    message: "Friend request declined",
    notificationMessage: receiverMessage,
    requestId: request.id,
  });
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
  const myId = Number(req.user.id);
  const otherId = Number(req.params.userId);

  if (!Number.isInteger(otherId) || otherId <= 0) {
    return res.status(400).json({ message: "Invalid user ID." });
  }

  const request = await FriendRequest.findOne({
    where: {
      [Op.or]: [
        { senderId: myId, receiverId: otherId },
        { senderId: otherId, receiverId: myId },
      ],
    },
  });

  if (!request || request.status === "declined") {
    return res.json({
      status: "none",
      requestId: null,
    });
  }

  let status;

  if (request.status === "accepted") {
    status = "friends";
  } else if (request.status === "pending") {
    status =
      Number(request.senderId) === myId ? "pending_sent" : "pending_received";
  } else {
    status = "none";
  }

  return res.json({
    status,
    requestId: request.id,
  });
});


 // ========================
// REMOVE FRIEND
// ========================
router.delete("/remove/:userId", authenticateToken, async (req, res) => {
  const myId = req.user.id;
  const otherId = Number(req.params.userId);

  if (!Number.isInteger(otherId) || otherId <= 0) {
    return res.status(400).json({ message: "Invalid user ID." });
  }

  if (myId === otherId) {
    return res.status(400).json({
      message: "You can't remove yourself.",
    });
  }

  const friendship = await FriendRequest.findOne({
    where: {
      status: "accepted",
      [Op.or]: [
        { senderId: myId, receiverId: otherId },
        { senderId: otherId, receiverId: myId },
      ],
    },
  });

  if (!friendship) {
    return res.status(404).json({
      message: "Friendship not found.",
    });
  }

  await friendship.destroy();

  return res.json({
    message: "Friend removed successfully.",
    removedUserId: otherId,
  });
});

module.exports = router;
