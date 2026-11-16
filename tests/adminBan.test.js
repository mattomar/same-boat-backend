process.env.JWT_SECRET = "test-secret";

const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");

const db = require("../models");
const adminRoutes = require("../routes/adminRoutes");
const reportRoutes = require("../routes/reportRoutes");
const authenticateToken = require("../middlewares/auth");

describe("Admin ban, unban, and reporting system", () => {
  let server;
  let baseUrl;

  let admin;
  let testUser;
  let reportedUser;

  let testPost;
  let testComment;

  let adminToken;
  let userToken;

  let userRole;
  let adminRole;

  let userReport;
  let postReport;
  let commentReport;

  const testRun = `${Date.now()}-${process.pid}`;

  const tokenFor = (user) =>
    jwt.sign({ userId: user.id }, process.env.JWT_SECRET);

  const api = async (token, method, path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    let data = null;

    try {
      data = await response.json();
    } catch {}

    return {
      status: response.status,
      data,
    };
  };

  beforeAll(async () => {
    await db.sequelize.sync();

    [userRole] = await db.Role.findOrCreate({
      where: { name: "user" },
      defaults: { name: "user" },
    });

    [adminRole] = await db.Role.findOrCreate({
      where: { name: "admin" },
      defaults: { name: "admin" },
    });

    admin = await db.User.create({
      firstName: "Admin",
      lastName: "Test",
      email: `admin-${testRun}@example.test`,
      password: "test-password",
      username: `adm${Date.now()}`,
      roleId: adminRole.id,
    });

    testUser = await db.User.create({
      firstName: "Ban",
      lastName: "Test",
      email: `user-${testRun}@example.test`,
      password: "test-password",
      username: `usr${Date.now()}`,
      roleId: userRole.id,
    });

    reportedUser = await db.User.create({
      firstName: "Reported",
      lastName: "Test",
      email: `reported-${testRun}@example.test`,
      password: "test-password",
      username: `rep${Date.now()}`,
      roleId: userRole.id,
    });

    testPost = await db.Post.create({
      userId: reportedUser.id,
      content: `Test report post ${testRun}`,
    });

    testComment = await db.Comment.create({
      userId: reportedUser.id,
      postId: testPost.id,
      content: `Test report comment ${testRun}`,
    });

    adminToken = tokenFor(admin);
    userToken = tokenFor(testUser);

    const app = express();

    app.use(express.json());

    app.use("/api/admin", adminRoutes);
    app.use("/api/reports", reportRoutes);

    app.get("/protected", authenticateToken, (req, res) => {
      res.status(200).json({
        success: true,
        userId: req.user.id,
      });
    });

    server = http.createServer(app);

    await new Promise((resolve) => {
      server.listen(0, resolve);
    });

    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Delete all reports created by the test user.
    await db.Report.destroy({
      where: {
        reporterId: testUser?.id,
      },
    });

    // Delete test content if it still exists.
    if (testComment) {
      await db.Comment.destroy({
        where: { id: testComment.id },
      });
    }

    if (testPost) {
      await db.Post.destroy({
        where: { id: testPost.id },
      });
    }

    // Delete test users.
    if (admin) {
      await db.User.destroy({
        where: { id: admin.id },
      });
    }

    if (testUser) {
      await db.User.destroy({
        where: { id: testUser.id },
      });
    }

    if (reportedUser) {
      await db.User.destroy({
        where: { id: reportedUser.id },
      });
    }
  });

  // ==========================================
  // BAN AND UNBAN TESTS
  // ==========================================

  test("complete ban, access restriction, and unban flow", async () => {
    let result = await api(adminToken, "GET", "/api/admin/overview");

    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);

    result = await api(userToken, "GET", "/api/admin/overview");

    expect(result.status).toBe(403);

    result = await api(userToken, "GET", "/protected");

    expect(result.status).toBe(200);

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/users/${admin.id}/ban`,
      { reason: "Testing self-ban protection" },
    );

    expect(result.status).toBe(400);

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/users/${testUser.id}/ban`,
      { reason: "   " },
    );

    expect(result.status).toBe(400);

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/users/${testUser.id}/ban`,
      { reason: "Repeated violation of community guidelines" },
    );

    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
    expect(result.data.user.isBanned).toBe(true);
    expect(result.data.user.banReason).toBe(
      "Repeated violation of community guidelines",
    );
    expect(result.data.user.bannedAt).toBeTruthy();

    let updatedUser = await db.User.findByPk(testUser.id);

    expect(updatedUser.isBanned).toBe(true);
    expect(updatedUser.banReason).toBe(
      "Repeated violation of community guidelines",
    );
    expect(updatedUser.bannedAt).toBeTruthy();

    result = await api(userToken, "GET", "/protected");

    expect(result.status).toBe(403);
    expect(result.data.banned).toBe(true);
    expect(result.data.reason).toBe(
      "Repeated violation of community guidelines",
    );

    result = await api(userToken, "GET", "/api/admin/overview");

    expect(result.status).toBe(403);

    result = await api(adminToken, "GET", "/api/admin/overview");

    expect(result.status).toBe(200);

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/users/${testUser.id}/ban`,
      { reason: "Another reason" },
    );

    expect(result.status).toBe(400);

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/users/${testUser.id}/unban`,
    );

    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
    expect(result.data.user.isBanned).toBe(false);

    updatedUser = await db.User.findByPk(testUser.id);

    expect(updatedUser.isBanned).toBe(false);
    expect(updatedUser.banReason).toBeNull();
    expect(updatedUser.bannedAt).toBeNull();

    result = await api(userToken, "GET", "/protected");

    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
    expect(result.data.userId).toBe(testUser.id);

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/users/${testUser.id}/unban`,
    );

    expect(result.status).toBe(400);

    result = await api(adminToken, "PATCH", "/api/admin/users/invalid/ban", {
      reason: "Test",
    });

    expect(result.status).toBe(400);

    result = await api(adminToken, "PATCH", "/api/admin/users/999999999/ban", {
      reason: "Test",
    });

    expect(result.status).toBe(404);
  });

  // ==========================================
  // REPORT SUBMISSION AND REVIEW TESTS
  // ==========================================

  test("complete report submission and admin review flow", async () => {
    let result = await api(userToken, "POST", "/api/reports", {
      targetType: "user",
      targetId: reportedUser.id,
      reason: "Harassment",
      details: "This user is harassing other members.",
    });

    expect(result.status).toBe(201);
    expect(result.data.success).toBe(true);

    userReport = result.data.report;

    expect(userReport.targetType).toBe("user");
    expect(userReport.targetId).toBe(reportedUser.id);
    expect(userReport.status).toBe("pending");

    result = await api(userToken, "POST", "/api/reports", {
      targetType: "post",
      targetId: testPost.id,
      reason: "Inappropriate content",
      details: "This post violates community guidelines.",
    });

    expect(result.status).toBe(201);

    postReport = result.data.report;

    expect(postReport.targetType).toBe("post");
    expect(postReport.targetId).toBe(testPost.id);

    result = await api(userToken, "POST", "/api/reports", {
      targetType: "comment",
      targetId: testComment.id,
      reason: "Abusive language",
    });

    expect(result.status).toBe(201);

    commentReport = result.data.report;

    expect(commentReport.targetType).toBe("comment");
    expect(commentReport.targetId).toBe(testComment.id);

    const savedUserReport = await db.Report.findByPk(userReport.id);

    expect(savedUserReport).toBeTruthy();
    expect(savedUserReport.reporterId).toBe(testUser.id);
    expect(savedUserReport.reportedUserId).toBe(reportedUser.id);
    expect(savedUserReport.status).toBe("pending");

    const savedPostReport = await db.Report.findByPk(postReport.id);

    expect(savedPostReport.targetSnapshot).toBeTruthy();
    expect(savedPostReport.targetSnapshot.content).toBe(testPost.content);

    const savedCommentReport = await db.Report.findByPk(commentReport.id);

    expect(savedCommentReport.targetSnapshot).toBeTruthy();
    expect(savedCommentReport.targetSnapshot.content).toBe(testComment.content);

    result = await api(userToken, "POST", "/api/reports", {
      targetType: "post",
      targetId: testPost.id,
      reason: "   ",
    });

    expect(result.status).toBe(400);

    result = await api(userToken, "POST", "/api/reports", {
      targetType: "message",
      targetId: testPost.id,
      reason: "Test",
    });

    expect(result.status).toBe(400);

    result = await api(userToken, "POST", "/api/reports", {
      targetType: "post",
      targetId: "invalid",
      reason: "Test",
    });

    expect(result.status).toBe(400);

    result = await api(userToken, "POST", "/api/reports", {
      targetType: "post",
      targetId: 999999999,
      reason: "Test",
    });

    expect(result.status).toBe(404);

    result = await api(userToken, "POST", "/api/reports", {
      targetType: "user",
      targetId: testUser.id,
      reason: "Test",
    });

    expect(result.status).toBe(400);

    result = await api(userToken, "POST", "/api/reports", {
      targetType: "post",
      targetId: testPost.id,
      reason: "Another report",
    });

    expect(result.status).toBe(409);

    result = await api(userToken, "GET", "/api/admin/reports");

    expect(result.status).toBe(403);

    result = await api(adminToken, "GET", "/api/admin/reports");

    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
    expect(result.data.reports.length).toBeGreaterThanOrEqual(3);

    result = await api(adminToken, "GET", "/api/admin/reports?status=pending");

    expect(result.status).toBe(200);
    expect(result.data.reports.length).toBeGreaterThanOrEqual(3);

    expect(
      result.data.reports.every((report) => report.status === "pending"),
    ).toBe(true);

    result = await api(adminToken, "GET", "/api/admin/reports?status=invalid");

    expect(result.status).toBe(400);

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/reports/${userReport.id}/review`,
      {
        status: "dismissed",
        resolutionNote: "Reviewed. No policy violation found.",
      },
    );

    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
    expect(result.data.report.status).toBe("dismissed");
    expect(result.data.report.reviewedBy).toBe(admin.id);

    const dismissedReport = await db.Report.findByPk(userReport.id);

    expect(dismissedReport.status).toBe("dismissed");
    expect(dismissedReport.reviewedBy).toBe(admin.id);
    expect(dismissedReport.reviewedAt).toBeTruthy();
    expect(dismissedReport.resolutionNote).toBe(
      "Reviewed. No policy violation found.",
    );

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/reports/${postReport.id}/review`,
      {
        status: "reviewed",
        resolutionNote: "Reviewed and documented.",
      },
    );

    expect(result.status).toBe(200);
    expect(result.data.report.status).toBe("reviewed");

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/reports/${commentReport.id}/review`,
      {
        status: "actioned",
        resolutionNote: "Moderation action taken.",
      },
    );

    expect(result.status).toBe(200);
    expect(result.data.report.status).toBe("actioned");

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/reports/${userReport.id}/review`,
      {
        status: "actioned",
        resolutionNote: "Trying to review again.",
      },
    );

    expect(result.status).toBe(400);

    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/reports/${userReport.id}/review`,
      {
        status: "invalid",
      },
    );

    expect(result.status).toBe(400);

    result = await api(
      adminToken,
      "PATCH",
      "/api/admin/reports/invalid/review",
      {
        status: "dismissed",
      },
    );

    expect(result.status).toBe(400);

    result = await api(
      adminToken,
      "PATCH",
      "/api/admin/reports/999999999/review",
      {
        status: "dismissed",
      },
    );

    expect(result.status).toBe(404);
  });

  // ==========================================
  // ACTUAL MODERATION ACTION TESTS
  // ==========================================

  test("admin can remove reported content and ban reported users", async () => {
    // Report the comment.
    let result = await api(userToken, "POST", "/api/reports", {
      targetType: "comment",
      targetId: testComment.id,
      reason: "Abusive language",
      details: "Testing comment removal.",
    });

    expect(result.status).toBe(201);

    const actionCommentReport = result.data.report;

    // Report the post.
    result = await api(userToken, "POST", "/api/reports", {
      targetType: "post",
      targetId: testPost.id,
      reason: "Inappropriate content",
      details: "Testing post removal.",
    });

    expect(result.status).toBe(201);

    const actionPostReport = result.data.report;

    // Report the user.
    result = await api(userToken, "POST", "/api/reports", {
      targetType: "user",
      targetId: reportedUser.id,
      reason: "Harassment",
      details: "Testing user ban.",
    });

    expect(result.status).toBe(201);

    const actionUserReport = result.data.report;

    // Invalid action must be rejected.
    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/reports/${actionUserReport.id}/action`,
      {
        action: "invalid_action",
        resolutionNote: "Testing invalid action.",
      },
    );

    expect(result.status).toBe(400);

    // Already-reviewed reports cannot be actioned.
    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/reports/${userReport.id}/action`,
      {
        action: "ban_user",
        resolutionNote: "Trying to action an already dismissed report.",
      },
    );

    expect(result.status).toBe(400);

    // Remove the reported comment.
    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/reports/${actionCommentReport.id}/action`,
      {
        action: "remove_content",
        resolutionNote: "Comment removed after review.",
      },
    );

    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
    expect(result.data.report.status).toBe("actioned");

    const deletedComment = await db.Comment.findByPk(testComment.id);

    expect(deletedComment).toBeNull();

    // The report and evidence must remain.
    const savedCommentReport = await db.Report.findByPk(actionCommentReport.id);

    expect(savedCommentReport).toBeTruthy();
    expect(savedCommentReport.status).toBe("actioned");
    expect(savedCommentReport.targetSnapshot).toBeTruthy();
    expect(savedCommentReport.targetSnapshot.content).toBe(testComment.content);

    // Remove the reported post.
    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/reports/${actionPostReport.id}/action`,
      {
        action: "remove_content",
        resolutionNote: "Post removed after review.",
      },
    );

    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
    expect(result.data.report.status).toBe("actioned");

    const deletedPost = await db.Post.findByPk(testPost.id);

    expect(deletedPost).toBeNull();

    // The post report and evidence must remain.
    const savedPostReport = await db.Report.findByPk(actionPostReport.id);

    expect(savedPostReport).toBeTruthy();
    expect(savedPostReport.status).toBe("actioned");
    expect(savedPostReport.targetSnapshot).toBeTruthy();
    expect(savedPostReport.targetSnapshot.content).toBe(testPost.content);

    // Ban the reported user.
    result = await api(
      adminToken,
      "PATCH",
      `/api/admin/reports/${actionUserReport.id}/action`,
      {
        action: "ban_user",
        resolutionNote: "User banned after reviewing the report.",
      },
    );

    expect(result.status).toBe(200);
    expect(result.data.success).toBe(true);
    expect(result.data.report.status).toBe("actioned");

    const bannedUser = await db.User.findByPk(reportedUser.id);

    expect(bannedUser.isBanned).toBe(true);
    expect(bannedUser.banReason).toBeTruthy();
    expect(bannedUser.bannedAt).toBeTruthy();

    const savedUserReport = await db.Report.findByPk(actionUserReport.id);

    expect(savedUserReport).toBeTruthy();
    expect(savedUserReport.status).toBe("actioned");
    expect(savedUserReport.reportedUserId).toBe(reportedUser.id);
  });
});
