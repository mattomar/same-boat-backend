const express = require("express");
const router = express.Router();

const db = require("../models");
const authenticateToken = require("../middlewares/auth");

// SUBMIT AN APPEAL
router.post("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { moderationLogId, explanation } = req.body;

    const parsedLogId = Number(moderationLogId);

    if (!Number.isInteger(parsedLogId) || parsedLogId <= 0) {
      return res.status(400).json({
        error: "Invalid moderation action ID",
      });
    }

    if (typeof explanation !== "string" || !explanation.trim()) {
      return res.status(400).json({
        error: "An explanation is required",
      });
    }

    if (explanation.trim().length > 3000) {
      return res.status(400).json({
        error: "Your explanation cannot exceed 3000 characters",
      });
    }

    // Find an appealable moderation action belonging to this user
    const moderationAction = await db.ModerationLog.findOne({
      where: {
        id: parsedLogId,
        targetUserId: userId,
        action: {
          [db.Sequelize.Op.in]: ["ban_user", "remove_content"],
        },
      },
    });

    if (!moderationAction) {
      return res.status(404).json({
        error: "Moderation action not found or cannot be appealed",
      });
    }

    // Prevent duplicate appeals
    const existingAppeal = await db.ModerationAppeal.findOne({
      where: {
        moderationLogId: parsedLogId,
      },
    });

    if (existingAppeal) {
      return res.status(409).json({
        error: "You have already appealed this action",
      });
    }

    const appeal = await db.ModerationAppeal.create({
      userId,
      moderationLogId: parsedLogId,
      explanation: explanation.trim(),
    });

    return res.status(201).json({
      success: true,
      message: "Your appeal has been submitted",
      appeal,
    });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        error: "You have already appealed this action",
      });
    }

    console.error("Submit moderation appeal error:", error);

    return res.status(500).json({
      error: "Failed to submit appeal",
    });
  }
});

// GET THE LOGGED-IN USER'S APPEALS
router.get("/my-appeals", authenticateToken, async (req, res) => {
  try {
    const appeals = await db.ModerationAppeal.findAll({
      where: {
        userId: req.user.id,
      },
      include: [
        {
          model: db.ModerationLog,
          as: "moderationAction",
          attributes: [
            "id",
            "action",
            "targetType",
            "targetId",
            "reason",
            "createdAt",
          ],
        },
        {
          model: db.User,
          as: "reviewer",
          attributes: ["id", "username"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.json(appeals);
  } catch (error) {
    console.error("Get moderation appeals error:", error);

    return res.status(500).json({
      error: "Failed to retrieve appeals",
    });
  }
});

// BAN STATUS: everything a banned user's appeal page needs
router.get("/ban-status", authenticateToken, async (req, res) => {
  try {
    if (!req.user.isBanned) {
      return res.json({ banned: false });
    }

    const banLog = await db.ModerationLog.findOne({
      where: { targetUserId: req.user.id, action: "ban_user" },
      order: [["createdAt", "DESC"]],
    });

    const appeal = banLog
      ? await db.ModerationAppeal.findOne({
          where: { moderationLogId: banLog.id },
        })
      : null;

    return res.json({
      banned: true,
      reason: req.user.banReason,
      moderationLogId: banLog ? banLog.id : null,
      appeal: appeal
        ? {
            status: appeal.status,
            explanation: appeal.explanation,
            adminResponse: appeal.adminResponse,
            createdAt: appeal.createdAt,
          }
        : null,
    });
  } catch (error) {
    console.error("Ban status error:", error);
    return res.status(500).json({ error: "Failed to load ban status" });
  }
});

module.exports = router;
