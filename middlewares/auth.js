const jwt = require("jsonwebtoken");
const { User, Role } = require("../models");

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.sendStatus(401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findByPk(decoded.userId, {
      include: [
        {
          model: Role,
          as: "role",
          attributes: ["id", "name"],
        },
      ],
    });

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    // Banned users can only access moderation appeal endpoints.
    const isAppealRoute = req.originalUrl
      .split("?")[0]
      .startsWith("/api/moderation-appeals");

    if (user.isBanned && !isAppealRoute) {
      return res.status(403).json({
        error: "Your account has been banned",
        banned: true,
        reason: user.banReason || null,
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("Token error:", err);

    return res.status(403).json({
      error: "Invalid token",
    });
  }
};

module.exports = authenticateToken;
