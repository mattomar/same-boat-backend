const express = require("express");
const router = express.Router();

const { Op } = require("sequelize");
const { User, Profile, Post, Category, Block } = require("../models");

router.get("/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // If the requester is logged in, check whether either user blocked the other
    const currentUserId = req.user?.id;

    if (currentUserId && Number(currentUserId) !== userId) {
      const block = await Block.findOne({
        where: {
          [Op.or]: [
            {
              blockerId: currentUserId,
              blockedUserId: userId,
            },
            {
              blockerId: userId,
              blockedUserId: currentUserId,
            },
          ],
        },
      });

      if (block) {
        return res.status(404).json({ message: "User not found" });
      }
    }

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

    return res.json(user);
  } catch (error) {
    console.error("Profile fetch error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
