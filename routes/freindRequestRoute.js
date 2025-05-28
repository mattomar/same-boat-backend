const express = require("express");
const router = express.Router();
const { FriendRequest, User } = require("../models");
const authenticateToken = require("../middlewares/auth");

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
      senderId,
      receiverId,
    },
    order: [["createdAt", "DESC"]],
  });
  
  if (existing && existing.status === "pending") {
    return res.status(400).json({ message: "Request already sent." });
  }

  if (existing) {
    return res.status(400).json({ message: "Request already sent." });
  }

  await FriendRequest.create({ senderId, receiverId });
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



module.exports = router;
