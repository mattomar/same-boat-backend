const express = require("express");
const router = express.Router();
const { FriendRequest, User } = require("../models");
const authenticateToken = require("../middlewares/auth");
const { Op } = require("sequelize");


router.get("/ping", (req, res) => {
  res.send("Friend route active");
});
// Send a friend request
router.post("/send/:receiverId", authenticateToken, async (req, res) => {
  const { receiverId } = req.params;
  const senderId = req.user.id;

  if (parseInt(receiverId) === senderId) {
    return res.status(400).json({ message: "You can't send a request to yourself." });
  }

const existing = await FriendRequest.findOne({
  where: {
    [Op.or]: [
      {
        senderId,
        receiverId,
      },
      {
        senderId: receiverId,
        receiverId: senderId,
      },
    ],
  },
  order: [["createdAt", "DESC"]],
});
  

  if (existing) {
    return res.status(400).json({ message: "Request already sent." });
  }

  await FriendRequest.create({ senderId, receiverId });
  const { Notification } = require("../models");

  await Notification.create({
    userId: receiverId,
    type: "friend_request",
    message: "You received a friend request",
  });
  res.json({ message: "Friend request sent." });
});

// Accept a friend request
router.post("/accept/:requestId", authenticateToken, async (req, res) => {
  const { requestId } = req.params;
  const request = await FriendRequest.findByPk(requestId);

  if (!request || request.receiverId !== req.user.id) {
    return res.status(404).json({ message: "Friend request not found." });
  }

  request.status = "accepted";
  await request.save();
  const { Notification } = require("../models");

  await Notification.create({
    userId: request.senderId,
    type: "friend_accepted",
    message: "Your friend request was accepted",
  });

  res.json({ message: "Friend request accepted." });
});

// List all accepted friends
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
    ...sent.map(r => r.receiver),
    ...received.map(r => r.sender),
  ];

  res.json(friends);
});


router.post("/decline/:requestId", authenticateToken, async (req, res) => {
  const { requestId } = req.params;
  const request = await FriendRequest.findByPk(requestId);

  if (!request || request.receiverId !== req.user.id) {
    return res.status(404).json({ message: "Friend request not found." });
  }

  request.status = "declined";
  await request.save();

  res.json({ message: "Friend request declined." });
});


router.get("/pending", authenticateToken, async (req, res) => {
  const requests = await FriendRequest.findAll({
    where: {
      receiverId: req.user.id,
      status: "pending",
    },
    include: [
      {
        model: User,
        as: "sender",
        attributes: ["id", "username"],
      },
    ],
  });

  res.json(requests);
});

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
    return res.status(404).json({
      message: "Friend not found",
    });
  }

  await friendship.destroy();

  res.json({
    message: "Friend removed",
  });
});

router.get("/search", authenticateToken, async (req, res) => {
  const { username } = req.query;

  if (!username || username.trim() === "") {
    return res.json([]);
  }

  // 1. get all related friend requests
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

  // 2. get users
  const users = await User.findAll({
    where: {
      username: { [Op.like]: `%${username}%` },
      id: { [Op.ne]: req.user.id },
    },
    limit: 10,
  });

  // 3. attach status
  const result = users.map((user) => {
let status = "none";

if (sent.has(user.id)) status = "pending_sent";
else if (received.has(user.id)) status = "pending_received";
else if (
  requests.some(
    (r) =>
      r.status === "accepted" &&
      ((r.senderId === req.user.id && r.receiverId === user.id) ||
        (r.receiverId === req.user.id && r.senderId === user.id)),
  )
) {
  status = "friends";
}
    return {
      id: user.id,
      username: user.username,
      status,
    };
  });

  res.json(result);
});

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
    return res.json({ status: "none" });
  }

  if (request.senderId === myId) {
    return res.json({ status: "pending_sent" });
  }

  if (request.receiverId === myId) {
    return res.json({ status: "pending_received" });
  }

  return res.json({ status: request.status }); // accepted/declined fallback
});

module.exports = router;
