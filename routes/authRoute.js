const express = require("express");
const bcrypt = require("bcryptjs");
const { User, Role, Profile } = require("../models"); // Import your models
const jwt = require("jsonwebtoken");
require("dotenv").config();
const multer = require("multer");
const path = require("path");
const { Op } = require("sequelize"); // make sure to import Op for OR queries

const router = express.Router();

// Configure multer storage and filename
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // folder where files will be stored
  },
  filename: (req, file, cb) => {
    // e.g. avatar-1234567890.png
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, "avatar-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // max 5MB
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed!"), false);
    }
    cb(null, true);
  },
});

router.post("/signup", upload.single("avatar"), async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      username,
      email,
      password,
      bio,
    } = req.body;

    // Check if email or username already exists
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

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Assign "Member" role by default
    const userRole = await Role.findOne({ where: { name: "Member" } });

    // Prepare avatarUrl if file uploaded
    let avatarUrl = null;
    if (req.file) {
      avatarUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    }

    // Create user
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

    // Check if the user exists
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, roleId: user.roleId },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Send token to client
    res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
