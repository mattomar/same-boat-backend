const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");

const db = require("../models");
const authenticateToken = require("../middlewares/auth");
const requireAdmin = require("../middlewares/requireAdmin");

// LOG MODERATION ACTION
const logModerationAction = async ({
  adminId,
  reportId = null,
  targetUserId = null,
  targetType = null,
  targetId = null,
  action,
  reason = null,
  transaction = null,
}) => {
  return db.ModerationLog.create(
    {
      adminId,
      reportId,
      targetUserId,
      targetType,
      targetId,
      action,
      reason,
    },
    { transaction },
  );
};

// ADMIN DASHBOARD OVERVIEW
router.get("/overview", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [
      totalUsers,
      totalPosts,
      totalComments,
      totalBannedUsers,
      pendingReports,
    ] = await Promise.all([
      db.User.count(),
      db.Post.count(),
      db.Comment.count(),
      db.User.count({ where: { isBanned: true } }),
      db.Report.count({ where: { status: "pending" } }),
    ]);

    return res.status(200).json({
      success: true,
      overview: {
        totalUsers,
        totalPosts,
        totalComments,
        totalBannedUsers,
        pendingReports,
      },
    });
  } catch (error) {
    console.error("Admin overview error:", error);

    return res.status(500).json({
      error: "Failed to load admin overview",
    });
  }
});

// GET ALL USERS + SEARCH + PAGINATION
router.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20),
    );

    const offset = (page - 1) * limit;
    const search = req.query.search?.trim();

    const where = {};

    if (search) {
      where[Op.or] = [
        { username: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await db.User.findAndCountAll({
      where,
      attributes: [
        "id",
        "firstName",
        "lastName",
        "username",
        "email",
        "avatarUrl",
        "createdAt",
        "isBanned",
        "banReason",
        "bannedAt",
      ],
      include: [
        {
          model: db.Role,
          as: "role",
          attributes: ["id", "name"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      users: rows,
      pagination: {
        totalUsers: count,
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        limit,
      },
    });
  } catch (error) {
    console.error("Admin users error:", error);

    return res.status(500).json({
      error: "Failed to load users",
    });
  }
});

// BAN USER
router.patch(
  "/users/:userId/ban",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const reason = req.body?.reason?.trim();

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      if (userId === req.user.id) {
        return res.status(400).json({
          error: "You cannot ban your own account",
        });
      }

      if (!reason) {
        return res.status(400).json({
          error: "A ban reason is required",
        });
      }

      const user = await db.User.findByPk(userId);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.isBanned) {
        return res.status(400).json({
          error: "User is already banned",
        });
      }

      await user.update({
        isBanned: true,
        banReason: reason,
        bannedAt: new Date(),
      });

      await logModerationAction({
        adminId: req.user.id,
        targetUserId: user.id,
        targetType: "user",
        targetId: user.id,
        action: "ban_user",
        reason,
      });

      return res.status(200).json({
        success: true,
        message: "User banned successfully",
        user: {
          id: user.id,
          username: user.username,
          isBanned: user.isBanned,
          banReason: user.banReason,
          bannedAt: user.bannedAt,
        },
      });
    } catch (error) {
      console.error("Ban user error:", error);
      return res.status(500).json({ error: "Failed to ban user" });
    }
  },
);

// UNBAN USER
router.patch(
  "/users/:userId/unban",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const userId = Number(req.params.userId);

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      const user = await db.User.findByPk(userId);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!user.isBanned) {
        return res.status(400).json({
          error: "User is not banned",
        });
      }

      await user.update({
        isBanned: false,
        banReason: null,
        bannedAt: null,
      });

      await logModerationAction({
        adminId: req.user.id,
        targetUserId: user.id,
        targetType: "user",
        targetId: user.id,
        action: "unban_user",
        reason: "User account unbanned",
      });

      return res.status(200).json({
        success: true,
        message: "User unbanned successfully",
        user: {
          id: user.id,
          username: user.username,
          isBanned: user.isBanned,
        },
      });
    } catch (error) {
      console.error("Unban user error:", error);
      return res.status(500).json({ error: "Failed to unban user" });
    }
  },
);

// GET ALL REPORTS
router.get("/reports", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const { status } = req.query;
    const where = {};

    if (status) {
      const allowedStatuses = ["pending", "reviewed", "actioned", "dismissed"];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          error: "Invalid report status",
        });
      }

      where.status = status;
    }

    const { count, rows } = await db.Report.findAndCountAll({
      where,
      include: [
        {
          model: db.User,
          as: "reporter",
          attributes: ["id", "username", "avatarUrl"],
        },
        {
          model: db.User,
          as: "reportedUser",
          attributes: ["id", "username", "avatarUrl"],
        },
        {
          model: db.User,
          as: "reviewer",
          attributes: ["id", "username"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      reports: rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalReports: count,
        limit,
      },
    });
  } catch (error) {
    console.error("Get reports error:", error);

    return res.status(500).json({
      error: "Failed to retrieve reports",
    });
  }
});

// REVIEW A REPORT WITHOUT TAKING A MODERATION ACTION
router.patch(
  "/reports/:reportId/review",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const reportId = Number(req.params.reportId);
      const { status, resolutionNote } = req.body;

      if (!Number.isInteger(reportId) || reportId <= 0) {
        return res.status(400).json({
          error: "Invalid report ID",
        });
      }

      const allowedStatuses = ["reviewed", "actioned", "dismissed"];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          error: "Invalid review status",
        });
      }

      const report = await db.Report.findByPk(reportId);

      if (!report) {
        return res.status(404).json({
          error: "Report not found",
        });
      }

      if (report.status !== "pending") {
        return res.status(400).json({
          error: "This report has already been reviewed",
        });
      }

      if (resolutionNote !== undefined && typeof resolutionNote !== "string") {
        return res.status(400).json({
          error: "Invalid resolution note",
        });
      }

      await db.sequelize.transaction(async (transaction) => {
        await report.update(
          {
            status,
            reviewedBy: req.user.id,
            reviewedAt: new Date(),
            resolutionNote: resolutionNote?.trim() || null,
          },
          { transaction },
        );

        await logModerationAction({
          adminId: req.user.id,
          reportId: report.id,
          targetUserId: report.reportedUserId,
          targetType: report.targetType,
          targetId: report.targetId,
          action: status === "dismissed" ? "dismiss_report" : "review_report",
          reason: resolutionNote?.trim() || `Report marked as ${status}`,
          transaction,
        });
      });

      return res.status(200).json({
        success: true,
        message: "Report reviewed successfully",
        report,
      });
    } catch (error) {
      console.error("Review report error:", error);

      return res.status(500).json({
        error: "Failed to review report",
      });
    }
  },
);

// TAKE MODERATION ACTION ON A REPORT
router.patch(
  "/reports/:reportId/action",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const reportId = Number(req.params.reportId);
      const { action, resolutionNote } = req.body;

      if (!Number.isInteger(reportId) || reportId <= 0) {
        return res.status(400).json({
          error: "Invalid report ID",
        });
      }

      const allowedActions = ["remove_content", "ban_user"];

      if (!allowedActions.includes(action)) {
        return res.status(400).json({
          error: "Invalid moderation action",
        });
      }

      if (resolutionNote !== undefined && typeof resolutionNote !== "string") {
        return res.status(400).json({
          error: "Invalid resolution note",
        });
      }

      const report = await db.Report.findByPk(reportId);

      if (!report) {
        return res.status(404).json({
          error: "Report not found",
        });
      }

      if (report.status !== "pending") {
        return res.status(400).json({
          error: "This report has already been reviewed",
        });
      }

      if (
        action === "remove_content" &&
        !["post", "comment"].includes(report.targetType)
      ) {
        return res.status(400).json({
          error: "Only post and comment reports can use remove_content",
        });
      }

      if (action === "ban_user" && report.reportedUserId === req.user.id) {
        return res.status(400).json({
          error: "You cannot ban your own account",
        });
      }

      const note = resolutionNote?.trim() || null;

      await db.sequelize.transaction(async (transaction) => {
        // REMOVE REPORTED POST OR COMMENT
        if (action === "remove_content") {
          let content;

          if (report.targetType === "post") {
            content = await db.Post.findByPk(report.targetId, {
              transaction,
            });
          } else {
            content = await db.Comment.findByPk(report.targetId, {
              transaction,
            });
          }

          if (!content) {
            const error = new Error("Reported content no longer exists");
            error.status = 404;
            throw error;
          }

          await content.destroy({ transaction });
        }

        // BAN REPORTED USER
        if (action === "ban_user") {
          const user = await db.User.findByPk(report.reportedUserId, {
            transaction,
          });

          if (!user) {
            const error = new Error("Reported user not found");
            error.status = 404;
            throw error;
          }

          if (!user.isBanned) {
            await user.update(
              {
                isBanned: true,
                banReason: note || `Banned following report #${report.id}`,
                bannedAt: new Date(),
              },
              { transaction },
            );
          }
        }

        // UPDATE REPORT
        await report.update(
          {
            status: "actioned",
            reviewedBy: req.user.id,
            reviewedAt: new Date(),
            resolutionNote: note || `Moderation action: ${action}`,
          },
          { transaction },
        );

        // RECORD MODERATION ACTION
        await logModerationAction({
          adminId: req.user.id,
          reportId: report.id,
          targetUserId: report.reportedUserId,
          targetType: report.targetType,
          targetId: report.targetId,
          action,
          reason: note || report.reason,
          transaction,
        });
      });

      return res.status(200).json({
        success: true,
        message: "Moderation action completed successfully",
        action,
        report,
      });
    } catch (error) {
      console.error("Moderation action error:", error);

      return res.status(error.status || 500).json({
        error: error.status
          ? error.message
          : "Failed to perform moderation action",
      });
    }
  },
);

// GET MODERATION LOGS
router.get(
  "/moderation-logs",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const offset = (page - 1) * limit;

      const where = {};

      if (req.query.action) {
        where.action = req.query.action;
      }

      if (req.query.targetUserId) {
        const targetUserId = Number(req.query.targetUserId);

        if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
          return res.status(400).json({
            error: "Invalid target user ID",
          });
        }

        where.targetUserId = targetUserId;
      }

      const { count, rows } = await db.ModerationLog.findAndCountAll({
        where,
        include: [
          {
            model: db.User,
            as: "admin",
            attributes: ["id", "username", "avatarUrl"],
          },
          {
            model: db.User,
            as: "targetUser",
            attributes: ["id", "username", "avatarUrl"],
            required: false,
          },
          {
            model: db.Report,
            as: "report",
            required: false,
          },
        ],
        order: [["createdAt", "DESC"]],
        limit,
        offset,
      });

      return res.status(200).json({
        success: true,
        logs: rows,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(count / limit),
          totalLogs: count,
          limit,
        },
      });
    } catch (error) {
      console.error("Get moderation logs error:", error);

      return res.status(500).json({
        error: "Failed to retrieve moderation logs",
      });
    }
  },
);

module.exports = router;
