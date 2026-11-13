const express = require("express");
const router = express.Router();

const { Notification, Block } = require("../models");

const { Op } = require("sequelize");
const authenticateToken = require("../middlewares/auth");

// --------------------------------------------------
// HELPER: GET BLOCKED USER IDS
// --------------------------------------------------

const getBlockedUserIds = async (userId) => {
  const blocks = await Block.findAll({
    where: {
      [Op.or]: [{ blockerId: userId }, { blockedUserId: userId }],
    },
    attributes: ["blockerId", "blockedUserId"],
  });

  const blockedIds = new Set();

  blocks.forEach((block) => {
    if (String(block.blockerId) !== String(userId)) {
      blockedIds.add(Number(block.blockerId));
    }

    if (String(block.blockedUserId) !== String(userId)) {
      blockedIds.add(Number(block.blockedUserId));
    }
  });

  return [...blockedIds];
};

// --------------------------------------------------
// GET NOTIFICATIONS
// --------------------------------------------------

router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const blockedIds = await getBlockedUserIds(userId);

    const where = {
      userId,
    };

    // Hide notifications sent by blocked users,
    // and users who have blocked the current user.
    if (blockedIds.length > 0) {
      where.senderId = {
        [Op.notIn]: blockedIds,
      };
    }

    const notifications = await Notification.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    res.json(notifications);
  } catch (err) {
    console.error("Get notifications error:", err);

    res.status(500).json({
      message: "Could not fetch notifications",
    });
  }
});

// --------------------------------------------------
// GET UNREAD NOTIFICATION COUNT
// --------------------------------------------------

router.get("/unread-count", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const blockedIds = await getBlockedUserIds(userId);

    const where = {
      userId,
      isRead: false,
    };

    if (blockedIds.length > 0) {
      where.senderId = {
        [Op.notIn]: blockedIds,
      };
    }

    const count = await Notification.count({
      where,
    });

    res.json({ count });
  } catch (err) {
    console.error("Unread notification count error:", err);

    res.status(500).json({
      message: "Could not fetch unread count",
    });
  }
});

// --------------------------------------------------
// MARK ALL VISIBLE NOTIFICATIONS AS READ
// --------------------------------------------------

router.put("/read-all", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const blockedIds = await getBlockedUserIds(userId);

    const where = {
      userId,
      isRead: false,
    };

    if (blockedIds.length > 0) {
      where.senderId = {
        [Op.notIn]: blockedIds,
      };
    }

    await Notification.update({ isRead: true }, { where });

    res.json({
      message: "Notifications marked as read",
    });
  } catch (err) {
    console.error("Mark notifications as read error:", err);

    res.status(500).json({
      message: "Could not mark notifications as read",
    });
  }
});

module.exports = router;
