const jwt = require("jsonwebtoken");
const { User } = require("../models");

const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  // Allow logged-out visitors
  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.userId);

    if (user) {
      req.user = user;
    }

    return next();
  } catch (error) {
    // Invalid or expired tokens shouldn't grant an identity
    return next();
  }
};

module.exports = optionalAuth;
