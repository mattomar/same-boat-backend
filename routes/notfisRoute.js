const express = require("express");
const router = express.Router();
const { Notification } = require("../models");
const authenticateToken = require("../middlewares/auth");

// Get notifications
router.get("/", authenticateToken, async (req, res) => {
  try {
    const notifications = await Notification.findAll({
      where: { userId: req.user.id },
      order: [["createdAt", "DESC"]],
    });

    res.json(notifications);
  } catch (err) {
    console.error("Get notifications error:", err);
    res.status(500).json({ message: "Could not fetch notifications" });
  }
});

// Get unread notification count
router.get("/unread-count", authenticateToken, async (req, res) => {
  try {
    const count = await Notification.count({
      where: {
        userId: req.user.id,
        isRead: false,
      },
    });

    res.json({ count });
  } catch (err) {
    console.error("Unread notification count error:", err);
    res.status(500).json({ message: "Could not fetch unread count" });
  }
});

// Mark all notifications as read
router.put("/read-all", authenticateToken, async (req, res) => {
  try {
    await Notification.update(
      { isRead: true },
      {
        where: {
          userId: req.user.id,
          isRead: false,
        },
      },
    );

    res.json({ message: "Notifications marked as read" });
  } catch (err) {
    console.error("Mark notifications as read error:", err);
    res.status(500).json({ message: "Could not mark notifications as read" });
  }
});

module.exports = router;
