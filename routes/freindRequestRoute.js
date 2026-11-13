const express = require("express");
const router = express.Router();

const { FriendRequest, User, Notification, Block } = require("../models");

const authenticateToken = require("../middlewares/auth");
const { Op, fn, col, where } = require("sequelize");

// ========================
// HELPER: CHECK BLOCK
// ========================
const isBlocked = async (userA, userB) => {
  return await Block.findOne({
    where: {
      [Op.or]: [
        { blockerId: userA, blockedUserId: userB },
        { blockerId: userB, blockedUserId: userA },
      ],
    },
  });
};

// ========================
// HEALTH CHECK
// ========================
router.get("/ping", (req, res) => {
  res.send("Friend route active");
});

// ========================
// SEND FRIEND REQUEST
// ========================
router.post("/send/:receiverId", authenticateToken, async (req, res) => {
  try {
    const receiverId = Number(req.params.receiverId);
    const senderId = Number(req.user.id);

    if (!Number.isInteger(receiverId) || receiverId <= 0) {
      return res.status(400).json({ message: "Invalid user ID." });
    }

    if (receiverId === senderId) {
      return res.status(400).json({
        message: "You can't send a request to yourself.",
      });
    }

    // Prevent requests between blocked users
    const block = await isBlocked(senderId, receiverId);

    if (block) {
      return res.status(404).json({ message: "User not found." });
    }

    const receiver = await User.findByPk(receiverId);

    if (!receiver) {
      return res.status(404).json({ message: "User not found." });
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
      return res.status(400).json({
        message: "Request already exists.",
      });
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

    return res.json({ message: "Friend request sent." });
  } catch (error) {
    console.error("Send friend request error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// ========================
// ACCEPT FRIEND REQUEST
// ========================
router.post("/accept/:requestId", authenticateToken, async (req, res) => {
  try {
    const requestId = Number(req.params.requestId);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ message: "Invalid request id." });
    }

    const request = await FriendRequest.findByPk(requestId);

    if (!request) {
      return res.status(404).json({
        message: "Friend request not found.",
      });
    }

    if (Number(request.receiverId) !== Number(req.user.id)) {
      return res.status(403).json({ message: "Not allowed." });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        message: "Request already handled.",
      });
    }

    // Prevent accepting requests between blocked users
    const block = await isBlocked(
      Number(request.senderId),
      Number(request.receiverId),
    );

    if (block) {
      return res.status(404).json({ message: "User not found." });
    }

    request.status = "accepted";
    await request.save();

    const requester = await User.findByPk(request.senderId, {
      attributes: ["id", "username"],
    });

    const requesterName = requester ? requester.username : "this user";

    const receiverMessage = `You accepted ${requesterName}'s friend request`;

    // Update original notification
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

    // Notify the sender
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
  } catch (error) {
    console.error("Accept friend request error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// ========================
// DECLINE FRIEND REQUEST
// ========================
router.post("/decline/:requestId", authenticateToken, async (req, res) => {
  try {
    const request = await FriendRequest.findByPk(req.params.requestId);

    if (!request) {
      return res.status(404).json({
        message: "Friend request not found.",
      });
    }

    if (Number(request.receiverId) !== Number(req.user.id)) {
      return res.status(403).json({ message: "Not allowed." });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        message: "Request already handled.",
      });
    }

    request.status = "declined";
    await request.save();

    const requester = await User.findByPk(request.senderId, {
      attributes: ["id", "username"],
    });

    const requesterName = requester ? requester.username : "this user";

    const receiverMessage = `You declined ${requesterName}'s friend request`;

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
  } catch (error) {
    console.error("Decline friend request error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// ========================
// SEARCH USERS
// ========================
router.get("/search", authenticateToken, async (req, res) => {
  try {
    const { username } = req.query;
    const myId = Number(req.user.id);

    if (!username || username.trim() === "") {
      return res.json([]);
    }

    const requests = await FriendRequest.findAll({
      where: {
        [Op.or]: [{ senderId: myId }, { receiverId: myId }],
      },
    });

    // Get users blocked in either direction
    const blocks = await Block.findAll({
      where: {
        [Op.or]: [{ blockerId: myId }, { blockedUserId: myId }],
      },
    });

    const blockedUserIds = blocks.map((block) =>
      Number(block.blockerId) === myId
        ? Number(block.blockedUserId)
        : Number(block.blockerId),
    );

    const users = await User.findAll({
      where: {
        [Op.and]: [
          where(fn("LOWER", col("username")), {
            [Op.like]: `%${username.toLowerCase()}%`,
          }),
          {
            id: {
              [Op.ne]: myId,
              [Op.notIn]: blockedUserIds.length ? blockedUserIds : [-1],
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
          (Number(r.senderId) === myId &&
            Number(r.receiverId) === Number(user.id)) ||
          (Number(r.receiverId) === myId &&
            Number(r.senderId) === Number(user.id)),
      );

      if (request) {
        requestId = request.id;

        if (request.status === "pending") {
          status =
            Number(request.senderId) === myId
              ? "pending_sent"
              : "pending_received";
        }

        if (request.status === "accepted") {
          status = "friends";
        }
      }

      return {
        id: user.id,
        username: user.username,
        status,
        requestId,
      };
    });

    return res.json(result);
  } catch (error) {
    console.error("User search error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// ========================
// GET FRIEND STATUS
// ========================
router.get("/status/:userId", authenticateToken, async (req, res) => {
  try {
    const myId = Number(req.user.id);
    const otherId = Number(req.params.userId);

    if (!Number.isInteger(otherId) || otherId <= 0) {
      return res.status(400).json({
        message: "Invalid user ID.",
      });
    }

    // Don't reveal relationship status between blocked users
    const block = await isBlocked(myId, otherId);

    if (block) {
      return res.status(404).json({
        message: "User not found.",
      });
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
  } catch (error) {
    console.error("Friend status error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// ========================
// REMOVE FRIEND
// ========================
router.delete("/remove/:userId", authenticateToken, async (req, res) => {
  try {
    const myId = Number(req.user.id);
    const otherId = Number(req.params.userId);

    if (!Number.isInteger(otherId) || otherId <= 0) {
      return res.status(400).json({
        message: "Invalid user ID.",
      });
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
  } catch (error) {
    console.error("Remove friend error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

module.exports = router;
