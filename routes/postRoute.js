const express = require("express");
const router = express.Router();
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");

const {
  Post,
  Category,
  User,
  Comment,
  Notification,
  Block,
} = require("../models");

const { Op } = require("sequelize");
const authenticateToken = require("../middlewares/auth");
const optionalAuth = require("../middlewares/optionalAuth");

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

const isBlocked = async (userA, userB) => {
  if (!userA || !userB || String(userA) === String(userB)) {
    return false;
  }

  const block = await Block.findOne({
    where: {
      [Op.or]: [
        { blockerId: userA, blockedUserId: userB },
        { blockerId: userB, blockedUserId: userA },
      ],
    },
  });

  return Boolean(block);
};

const getBlockedUserIds = async (userId) => {
  const blocks = await Block.findAll({
    where: {
      [Op.or]: [{ blockerId: userId }, { blockedUserId: userId }],
    },
    attributes: ["blockerId", "blockedUserId"],
  });

  const blockedIds = new Set();

  blocks.forEach((block) => {
    if (String(block.blockerId) !== String(userId)) {
      blockedIds.add(Number(block.blockerId));
    }

    if (String(block.blockedUserId) !== String(userId)) {
      blockedIds.add(Number(block.blockedUserId));
    }
  });

  return blockedIds;
};

// Get IDs of banned accounts.
const getBannedUserIds = async () => {
  const bannedUsers = await User.findAll({
    where: { isBanned: true },
    attributes: ["id"],
  });

  return bannedUsers.map((user) => Number(user.id));
};

// --------------------------------------------------
// CLOUDINARY UPLOAD
// --------------------------------------------------

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const uploadToCloudinary = (buffer, resourceType) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType },
      (error, result) => {
        if (error) {
          console.error(`Cloudinary ${resourceType} upload error:`, error);
          return reject(error);
        }

        resolve(result.secure_url);
      },
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
};

// --------------------------------------------------
// TEST ROUTE
// --------------------------------------------------

router.get("/test", (req, res) => {
  res.send("Post route works");
});

// --------------------------------------------------
// CREATE POST
// --------------------------------------------------

router.post(
  "/createPost",
  (req, res, next) => {
    console.log("Hit /posts/createPost route");
    next();
  },
  authenticateToken,
  upload.single("photo"),
  async (req, res) => {
    try {
      const { content, categoryId, gifUrl, youtubeUrl } = req.body;
      const userId = req.user.id;

      const category = await Category.findByPk(categoryId);

      if (!category) {
        return res.status(400).json({ message: "Invalid category" });
      }

      const photoUrl = req.file
        ? await uploadToCloudinary(req.file.buffer, "image")
        : null;

      const post = await Post.create({
        content,
        categoryId,
        userId,
        photoUrl,
        gifUrl,
        youtubeUrl,
      });

      const createdPost = await Post.findByPk(post.id, {
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "username"],
          },
        ],
      });

      return res.status(201).json(createdPost);
    } catch (error) {
      console.error("Create post error:", error);
      return res.status(500).json({
        message: "Internal server error",
      });
    }
  },
);

// --------------------------------------------------
// GET POSTS BY CATEGORY
// --------------------------------------------------

router.get("/category/:categoryId", optionalAuth, async (req, res) => {
  try {
    const categoryId = Number(req.params.categoryId);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({
        message: "Invalid category ID",
      });
    }

    const where = { categoryId };

    // Always hide posts belonging to banned accounts.
    const bannedIds = await getBannedUserIds();

    if (bannedIds.length > 0) {
      where.userId = { [Op.notIn]: bannedIds };
    }

    // Also hide blocked accounts for logged-in visitors.
    if (req.user) {
      const blockedIds = await getBlockedUserIds(req.user.id);

      if (blockedIds.size > 0) {
        where.userId = {
          ...(where.userId || {}),
          [Op.notIn]: [...new Set([...bannedIds, ...blockedIds])],
        };
      }
    }

    const posts = await Post.findAll({
      where,
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "username"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.json(posts);
  } catch (error) {
    console.error("Fetch posts error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// --------------------------------------------------
// GET CATEGORIES
// --------------------------------------------------

router.get("/categories", async (req, res) => {
  try {
    const categories = await Category.findAll();
    return res.status(200).json(categories);
  } catch (error) {
    console.error("Fetch categories error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// --------------------------------------------------
// GET SINGLE POST
// --------------------------------------------------

router.get("/:postId", optionalAuth, async (req, res) => {
  try {
    const postId = Number(req.params.postId);

    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({
        message: "Invalid post ID",
      });
    }

    const post = await Post.findByPk(postId, {
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "username", "isBanned"],
        },
      ],
    });

    if (!post || post.user?.isBanned) {
      return res.status(404).json({
        message: "Post not found",
      });
    }

    if (req.user && (await isBlocked(req.user.id, post.userId))) {
      return res.status(404).json({
        message: "Post not found",
      });
    }

    return res.status(200).json(post);
  } catch (error) {
    console.error("Fetch single post error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// --------------------------------------------------
// CREATE COMMENT OR REPLY + NOTIFICATIONS
// --------------------------------------------------

router.post("/:postId/comments", authenticateToken, async (req, res) => {
  try {
    const postId = Number(req.params.postId);
    const { content, parentId } = req.body;
    const userId = req.user.id;

    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({
        message: "Invalid post ID",
      });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({
        message: "Comment cannot be empty",
      });
    }

    const post = await Post.findByPk(postId, {
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "isBanned"],
        },
      ],
    });

    if (!post || post.user?.isBanned) {
      return res.status(404).json({
        message: "Post not found",
      });
    }

    if (await isBlocked(userId, post.userId)) {
      return res.status(404).json({
        message: "Post not found",
      });
    }

    let validParentId = null;

    if (parentId !== undefined && parentId !== null) {
      const parsedParentId = Number(parentId);

      if (!Number.isInteger(parsedParentId) || parsedParentId <= 0) {
        return res.status(400).json({
          message: "Invalid parent comment ID",
        });
      }

      const parentComment = await Comment.findOne({
        where: {
          id: parsedParentId,
          postId,
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "isBanned"],
          },
        ],
      });

      if (!parentComment || parentComment.user?.isBanned) {
        return res.status(404).json({
          message: "Parent comment not found",
        });
      }

      if (await isBlocked(userId, parentComment.userId)) {
        return res.status(404).json({
          message: "Parent comment not found",
        });
      }

      validParentId = parsedParentId;
    }

    const comment = await Comment.create({
      content: content.trim(),
      userId,
      postId,
      parentId: validParentId,
    });

    const sender = await User.findByPk(userId, {
      attributes: ["id", "username"],
    });

    if (String(post.userId) !== String(userId)) {
      try {
        await Notification.create({
          userId: post.userId,
          type: "comment",
          message: `${sender.username} commented on your post`,
          senderId: userId,
          postId,
          commentId: comment.id,
        });
      } catch (notificationError) {
        console.error("Comment notification error:", notificationError);
      }
    }

    const mentions = content.match(/@([A-Za-z0-9_.-]+)/g) || [];

    const uniqueUsernames = [
      ...new Set(mentions.map((mention) => mention.substring(1).toLowerCase())),
    ];

    try {
      for (const username of uniqueUsernames) {
        const mentionedUser = await User.findOne({
          where: {
            username: {
              [Op.iLike]: username,
            },
            isBanned: false,
          },
        });

        if (!mentionedUser || String(mentionedUser.id) === String(userId)) {
          continue;
        }

        if (await isBlocked(userId, mentionedUser.id)) {
          continue;
        }

        await Notification.create({
          userId: mentionedUser.id,
          type: "mention",
          message: `${sender.username} mentioned you in a comment`,
          senderId: userId,
          postId,
          commentId: comment.id,
        });
      }
    } catch (notificationError) {
      console.error("Mention notification error:", notificationError);
    }

    return res.status(201).json(comment);
  } catch (error) {
    console.error("Create comment error:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

// --------------------------------------------------
// GET COMMENTS WITH NESTED REPLIES
// --------------------------------------------------

router.get("/:postId/comments", optionalAuth, async (req, res) => {
  try {
    const postId = Number(req.params.postId);

    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({
        message: "Invalid post ID",
      });
    }

    const post = await Post.findByPk(postId, {
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "isBanned"],
        },
      ],
    });

    if (!post || post.user?.isBanned) {
      return res.status(404).json({
        message: "Post not found",
      });
    }

    if (req.user && (await isBlocked(req.user.id, post.userId))) {
      return res.status(404).json({
        message: "Post not found",
      });
    }

    const bannedIds = await getBannedUserIds();

    const blockedIds = req.user
      ? await getBlockedUserIds(req.user.id)
      : new Set();

    const hiddenIds = new Set([...bannedIds, ...blockedIds]);

    const allComments = await Comment.findAll({
      where: { postId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "username", "isBanned"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const visibleComments = allComments.filter(
      (comment) =>
        !hiddenIds.has(Number(comment.userId)) && !comment.user?.isBanned,
    );

    const commentMap = {};

    visibleComments.forEach((comment) => {
      const commentData = comment.toJSON();
      commentData.replies = [];
      commentMap[commentData.id] = commentData;
    });

    const topLevelComments = [];

    visibleComments.forEach((comment) => {
      const commentData = commentMap[comment.id];

      if (commentData.parentId !== null) {
        const parentComment = commentMap[commentData.parentId];

        if (parentComment) {
          parentComment.replies.push(commentData);
        } else {
          topLevelComments.push(commentData);
        }
      } else {
        topLevelComments.push(commentData);
      }
    });

    return res.status(200).json(topLevelComments);
  } catch (error) {
    console.error("Fetch comments error:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

// --------------------------------------------------
// DELETE COMMENT + NESTED REPLIES
// --------------------------------------------------

const deleteCommentWithReplies = async (commentId) => {
  const replies = await Comment.findAll({
    where: { parentId: commentId },
  });

  for (const reply of replies) {
    await deleteCommentWithReplies(reply.id);
  }

  await Comment.destroy({
    where: { id: commentId },
  });
};

router.delete("/comments/:commentId", authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.id;

    if (!Number.isInteger(Number(commentId)) || Number(commentId) <= 0) {
      return res.status(400).json({
        message: "Invalid comment ID",
      });
    }

    const comment = await Comment.findByPk(commentId);

    if (!comment) {
      return res.status(404).json({
        message: "Comment not found",
      });
    }

    const post = await Post.findByPk(comment.postId);

    if (!post) {
      return res.status(404).json({
        message: "Post not found",
      });
    }

    const isCommentOwner = String(comment.userId) === String(userId);
    const isPostOwner = String(post.userId) === String(userId);

    if (!isCommentOwner && !isPostOwner) {
      return res.status(403).json({
        message: "You are not authorized to delete this comment",
      });
    }

    await deleteCommentWithReplies(comment.id);

    return res.status(200).json({
      message: "Comment and its replies deleted successfully",
    });
  } catch (error) {
    console.error("Delete comment error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// --------------------------------------------------
// DELETE POST + ALL COMMENTS
// --------------------------------------------------

router.delete("/:postId", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    if (!Number.isInteger(Number(postId)) || Number(postId) <= 0) {
      return res.status(400).json({
        message: "Invalid post ID",
      });
    }

    const post = await Post.findByPk(postId);

    if (!post) {
      return res.status(404).json({
        message: "Post not found",
      });
    }

    if (String(post.userId) !== String(userId)) {
      return res.status(403).json({
        message: "You are not authorized to delete this post",
      });
    }

    const comments = await Comment.findAll({
      where: {
        postId: post.id,
        parentId: null,
      },
    });

    for (const comment of comments) {
      await deleteCommentWithReplies(comment.id);
    }

    await post.destroy();

    return res.status(200).json({
      message: "Post and its comments deleted successfully",
    });
  } catch (error) {
    console.error("Delete post error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// --------------------------------------------------
// GET POSTS BY USER
// --------------------------------------------------

router.get("/user/:userId", optionalAuth, async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        message: "Invalid user ID",
      });
    }

    const targetUser = await User.findByPk(userId, {
      attributes: ["id", "isBanned"],
    });

    if (!targetUser || targetUser.isBanned) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (req.user && (await isBlocked(req.user.id, userId))) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const posts = await Post.findAll({
      where: {
        userId,
      },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "username"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json(posts);
  } catch (error) {
    console.error("Fetch user posts error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

module.exports = router;
