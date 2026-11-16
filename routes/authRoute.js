const express = require("express");
const bcrypt = require("bcryptjs");
const { User, Role, Profile } = require("../models");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const multer = require("multer");
const path = require("path");
const { Op } = require("sequelize");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, "avatar-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed!"), false);
    }
    cb(null, true);
  },
});

router.post("/signup", upload.single("avatar"), async (req, res) => {
  try {
    const { firstName, lastName, username, email, password, bio } = req.body;

    const existingUser = await User.findOne({
      where: {
        [Op.or]: [{ email }, { username }],
      },
    });

    if (existingUser) {
      return res
        .status(400)
        .json({ message: "Email or username already in use" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userRole = await Role.findOne({ where: { name: "Member" } });

    let avatarUrl = null;
    if (req.file) {
      avatarUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    }

    const newUser = await User.create({
      firstName,
      lastName,
      username,
      email,
      password: hashedPassword,
      bio,
      avatarUrl,
      roleId: userRole ? userRole.id : null,
    });

    await Profile.create({
      userId: newUser.id,
      bio: bio || null,
      avatarUrl: avatarUrl || null,
    });

    res.status(201).json({
      message: "User registered successfully",
      role: "Member",
      user: {
        id: newUser.id,
        firstName,
        lastName,
        username,
        email,
        bio,
        avatarUrl,
      },
    });
  } catch (error) {
    console.error("Signup Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Reject banned accounts before issuing a JWT.
    if (user.isBanned) {
      return res.status(403).json({
        message: "Your account has been banned.",
        banned: true,
        reason: user.banReason || null,
        bannedAt: user.bannedAt || null,
      });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, roleId: user.roleId },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      message: "Login successful",
      token,
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
