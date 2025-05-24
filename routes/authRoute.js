const express = require("express");
const bcrypt = require("bcryptjs");
const { User, Role } = require("../models"); // Import your models
const jwt = require("jsonwebtoken");
require("dotenv").config();



const router = express.Router();
router.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // 🔹 Check if email already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "Email already in use" });
    }

    // 🔹 Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔹 Assign "Member" role by default
    const userRole = await Role.findOne({ where: { name: "Member" } });

    // 🔹 Create user
    const newUser = await User.create({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      roleId: userRole ? userRole.id : null,
    });

    res.status(201).json({ message: "User registered successfully", role: "Member" });

  } catch (error) {
    console.error("Signup Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
  router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1️⃣ Check if the user exists
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // 2️⃣ Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, roleId: user.roleId }, 
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // 4️⃣ Send token to client
    res.status(200).json({ message: "Login successful", token });

  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

 
module.exports = router;