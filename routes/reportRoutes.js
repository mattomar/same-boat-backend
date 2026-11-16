const express = require("express");
const router = express.Router();

const db = require("../models");
const authenticateToken = require("../middlewares/auth");

// SUBMIT A REPORT
router.post("/", authenticateToken, async (req, res) => {
  try {
    const reporterId = req.user.id;
    const { targetType, targetId, reason, details } = req.body;

    // Validate target type
    if (!["user", "post", "comment"].includes(targetType)) {
      return res.status(400).json({
        error: "Invalid report target type",
      });
    }

    // Validate target ID
    const parsedTargetId = Number(targetId);

    if (!Number.isInteger(parsedTargetId) || parsedTargetId <= 0) {
      return res.status(400).json({
        error: "Invalid target ID",
      });
    }

    // Validate reason
    if (typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({
        error: "A report reason is required",
      });
    }

    // Find the reported target
    let target;
    let reportedUserId;

    if (targetType === "user") {
      target = await db.User.findByPk(parsedTargetId);

      if (target) {
        reportedUserId = target.id;
      }
    }

    if (targetType === "post") {
      target = await db.Post.findByPk(parsedTargetId);

      if (target) {
        reportedUserId = target.userId;
      }
    }

    if (targetType === "comment") {
      target = await db.Comment.findByPk(parsedTargetId);

      if (target) {
        reportedUserId = target.userId;
      }
    }

    if (!target) {
      return res.status(404).json({
        error: "Reported content not found",
      });
    }

    // Prevent reporting yourself
    if (Number(reportedUserId) === Number(reporterId)) {
      return res.status(400).json({
        error: "You cannot report your own content",
      });
    }

    // Prevent duplicate pending reports from the same user
    const existingReport = await db.Report.findOne({
      where: {
        reporterId,
        targetType,
        targetId: parsedTargetId,
        status: "pending",
      },
    });

    if (existingReport) {
      return res.status(409).json({
        error: "You have already reported this content",
      });
    }

    // Create a snapshot of the reported content
    let targetSnapshot = target.get({ plain: true });

    // Never store sensitive user information in report evidence
    delete targetSnapshot.password;
    delete targetSnapshot.email;

    const report = await db.Report.create({
      reporterId,
      reportedUserId,
      targetType,
      targetId: parsedTargetId,
      reason: reason.trim(),
      details: typeof details === "string" ? details.trim() || null : null,
      targetSnapshot,
    });

    return res.status(201).json({
      success: true,
      message: "Report submitted successfully",
      report: {
        id: report.id,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      },
    });
  } catch (error) {
    console.error("Submit report error:", error);

    return res.status(500).json({
      error: "Failed to submit report",
    });
  }
});

module.exports = router;
