const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");

const db = require("../models");
const { Block, User, FriendRequest, MessageRequest, Conversation } = db;

const authenticateToken = require("../middlewares/auth");
const { emitters } = require("../socket/dmSocket");

// BLOCK A USER
router.post("/:userId", authenticateToken, async (req, res) => {
  const blockerId = Number(req.user.id);
  const blockedUserId = Number(req.params.userId);

  if (!Number.isInteger(blockedUserId) || blockedUserId <= 0) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  if (blockerId === blockedUserId) {
    return res.status(400).json({
      message: "You cannot block yourself",
    });
  }

  try {
    const user = await User.findByPk(blockedUserId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const block = await db.sequelize.transaction(async (transaction) => {
      // Create the block if it doesn't already exist
      const [newBlock] = await Block.findOrCreate({
        where: {
          blockerId,
          blockedUserId,
        },
        defaults: {
          blockerId,
          blockedUserId,
        },
        transaction,
      });

      // Remove friendship and pending friend requests in both directions
      await FriendRequest.destroy({
        where: {
          [Op.or]: [
            { senderId: blockerId, receiverId: blockedUserId },
            { senderId: blockedUserId, receiverId: blockerId },
          ],
        },
        transaction,
      });

      // Remove pending DM requests in both directions
      await MessageRequest.destroy({
        where: {
          status: "pending",
          [Op.or]: [
            { senderId: blockerId, receiverId: blockedUserId },
            { senderId: blockedUserId, receiverId: blockerId },
          ],
        },
        transaction,
      });

      // Hide the existing conversation from BOTH users
      const user1Id = Math.min(blockerId, blockedUserId);
      const user2Id = Math.max(blockerId, blockedUserId);
      const now = new Date();

      await Conversation.update(
        {
          deletedByUser1At: now,
          deletedByUser2At: now,
        },
        {
          where: {
            user1Id,
            user2Id,
          },
          transaction,
        },
      );

      return newBlock;
    });
        await emitters.usersBlocked(blockerId, blockedUserId);

    return res.status(200).json({
      message: "User blocked successfully",
      block,
    });
  } catch (error) {
    console.error("Block user error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// UNBLOCK A USER
router.delete("/:userId", authenticateToken, async (req, res) => {
  try {
    const blockerId = Number(req.user.id);
    const blockedUserId = Number(req.params.userId);

    if (!Number.isInteger(blockedUserId) || blockedUserId <= 0) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const deleted = await Block.destroy({
      where: {
        blockerId,
        blockedUserId,
      },
    });

    if (!deleted) {
      return res.status(404).json({
        message: "Block relationship not found",
      });
    }

    return res.json({
      message: "User unblocked successfully",
    });
  } catch (error) {
    console.error("Unblock user error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// GET USERS I HAVE BLOCKED
router.get("/", authenticateToken, async (req, res) => {
  try {
    const blocks = await Block.findAll({
      where: {
        blockerId: req.user.id,
      },
      include: [
        {
          model: User,
          as: "blockedUser",
          attributes: ["id", "username"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.json(blocks);
  } catch (error) {
    console.error("Fetch blocked users error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// CHECK BLOCKING RELATIONSHIP
router.get("/check/:userId", authenticateToken, async (req, res) => {
  try {
    const currentUserId = Number(req.user.id);
    const otherUserId = Number(req.params.userId);

    if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const blockedByMe = await Block.findOne({
      where: {
        blockerId: currentUserId,
        blockedUserId: otherUserId,
      },
    });

    const blockedMe = await Block.findOne({
      where: {
        blockerId: otherUserId,
        blockedUserId: currentUserId,
      },
    });

    return res.json({
      blockedByMe: !!blockedByMe,
      blockedMe: !!blockedMe,
      isBlocked: !!blockedByMe || !!blockedMe,
    });
  } catch (error) {
    console.error("Check block relationship error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

module.exports = router;
