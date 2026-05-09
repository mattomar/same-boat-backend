const express = require("express");
const router = express.Router();


const { User, Profile, Post, Category } = require("../models");


router.get("/:userId", async (req, res) =>  {
  try {
    const userId = req.params.userId;

const user = await User.findByPk(userId, {
  attributes: ["id", "firstName", "lastName", "username", "email"],
  include: [
    {
      model: Profile,
      as: "profile",
      attributes: ["bio", "avatarUrl", "phone"],
    },
    {
      model: Post,
      as: "posts",
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["id", "name"],
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "username"],
        },
      ],
    },
  ],
});

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
