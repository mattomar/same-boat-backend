const express = require("express");
const router = express.Router();
const { Notification } = require("../models");
const authenticateToken = require("../middlewares/auth");

// Get notifications
router.get("/", authenticateToken, async (req, res) => {
  const notifications = await Notification.findAll({
    where: { userId: req.user.id },
    order: [["createdAt", "DESC"]],
  });

  res.json(notifications);
});

module.exports = router;
