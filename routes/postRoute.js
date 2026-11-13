const express = require("express");
const router = express.Router();
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");
const { Post, Category, User, Comment, Notification } = require("../models");
const { Op } = require("sequelize");
const authenticateToken = require("../middlewares/auth");

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit
});
const uploadToCloudinary = (buffer, resourceType) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType },
      (error, result) => {
        if (error) {
          console.error(`❌ Cloudinary ${resourceType} upload error:`, error);
          return reject(error);
        }
        console.log(`✅ Cloudinary ${resourceType} uploaded:`, result.secure_url);
        resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
};


// POST a new post
router.post(
  "/createPost",
  (req, res, next) => {
    console.log("📨 Hit /posts/createPost route");
    next();
  },
  authenticateToken,
  upload.single("photo"),  // Only handle image upload now
  async (req, res) => {
    try {
      console.log("🧠 req.user in /posts:", req.user); 
      const { content, categoryId, gifUrl, youtubeUrl } = req.body;
      const userId = req.user.id;

      const category = await Category.findByPk(categoryId);
      if (!category) return res.status(400).json({ message: "Invalid category" });

     const photo = req.file;
     const photoUrl = photo
       ? await uploadToCloudinary(photo.buffer, "image")
       : null;

      const post = await Post.create({
        content,
        categoryId,
        userId,
        photoUrl,
        gifUrl,  // Store the GIF URL
        youtubeUrl,  // Store the YouTube URL
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

res.status(201).json(createdPost);

} catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);


// GET posts by category
router.get("/category/:categoryId", async (req, res) => {
  try {
    const categoryId = Number(req.params.categoryId);

    const posts = await Post.findAll({
      where: { categoryId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "username"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.json(posts);
  } catch (error) {
    console.error("Fetch posts error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const categories = await Category.findAll();
    res.status(200).json(categories);
  } catch (error) {
    console.error("Fetch categories error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
// POST a comment (or reply)
// POST a comment or reply + notify mentioned users
router.post("/:postId/comments", authenticateToken, async (req, res) => {
  try {
    const postId = Number(req.params.postId);
    const { content, parentId } = req.body;
    const userId = req.user.id;

    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({ message: "Invalid post ID" });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({
        message: "Comment cannot be empty",
      });
    }

    const post = await Post.findByPk(postId);

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // Validate parent comment.
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
      });

      if (!parentComment) {
        return res.status(404).json({
          message: "Parent comment not found",
        });
      }

      validParentId = parsedParentId;
    }

    // Create comment.
    const comment = await Comment.create({
      content: content.trim(),
      userId,
      postId,
      parentId: validParentId,
    });
    // Notify the post owner when someone comments
    if (String(post.userId) !== String(userId)) {
      try {
        const sender = await User.findByPk(userId, {
          attributes: ["id", "username"],
        });

        await Notification.create({
          userId: post.userId,
          type: "comment",
          message: `${sender.username} commented on your post`,
          senderId: userId,
          postId,
        });
      } catch (notificationError) {
        console.error("Comment notification error:", notificationError);
      }
    }

    // Find all @mentions.
    const mentions = content.match(/@([A-Za-z0-9_.-]+)/g) || [];

    // Remove duplicate usernames.
    const uniqueUsernames = [
      ...new Set(mentions.map((mention) => mention.substring(1).toLowerCase())),
    ];

    // Get sender information.
    const sender = await User.findByPk(userId, {
      attributes: ["id", "username"],
    });

    // Create notifications.
    try {
      for (const username of uniqueUsernames) {
        const mentionedUser = await User.findOne({
          where: {
            username: {
              [Op.iLike]: username,
            },
          },
        });

        // Skip nonexistent users and self-mentions.
        if (!mentionedUser || String(mentionedUser.id) === String(userId)) {
          continue;
        }

        await Notification.create({
          userId: mentionedUser.id,
          type: "mention",
          message: `${sender.username} mentioned you in a comment`,
          senderId: userId,
          postId,
        });
      }
    } catch (notificationError) {
      // Don't fail comment creation if notification creation fails.
      console.error("Mention notification error:", notificationError);
    }

    res.status(201).json(comment);
  } catch (err) {
    console.error("Create comment error:", err);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

// GET comments with unlimited nested replies
router.get("/:postId/comments", async (req, res) => {
  try {
    const postId = Number(req.params.postId);

    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({ message: "Invalid post ID" });
    }

    // Fetch every comment belonging to this post.
    const allComments = await Comment.findAll({
      where: { postId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "username"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Create a map containing every comment.
    const commentMap = {};

    allComments.forEach((comment) => {
      const commentData = comment.toJSON();

      commentData.replies = [];

      commentMap[commentData.id] = commentData;
    });

    // Build the nested comment structure.
    const topLevelComments = [];

    allComments.forEach((comment) => {
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

    res.status(200).json(topLevelComments);
  } catch (err) {
    console.error("Fetch comments error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// DELETE a comment + its nested replies
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
      return res.status(400).json({ message: "Invalid comment ID" });
    }

    const comment = await Comment.findByPk(commentId);

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const post = await Post.findByPk(comment.postId);

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const isCommentOwner = String(comment.userId) === String(userId);
    const isPostOwner = String(post.userId) === String(userId);

    if (!isCommentOwner && !isPostOwner) {
      return res.status(403).json({
        message: "You are not authorized to delete this comment",
      });
    }

    await deleteCommentWithReplies(comment.id);

    res.status(200).json({
      message: "Comment and its replies deleted successfully",
    });
  } catch (error) {
    console.error("Delete comment error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// DELETE a post and all its comments/replies
router.delete("/:postId", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;
        if (!Number.isInteger(Number(postId)) || Number(postId) <= 0) {
          return res.status(400).json({ message: "Invalid post ID" });
        }



    const post = await Post.findByPk(postId);

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (String(post.userId) !== String(userId)) {
      return res.status(403).json({
        message: "You are not authorized to delete this post",
      });
    }

    // Find all top-level comments on this post
    const comments = await Comment.findAll({
      where: {
        postId: post.id,
        parentId: null,
      },
    });

    // Delete each comment and its nested replies
    for (const comment of comments) {
      await deleteCommentWithReplies(comment.id);
    }

    await post.destroy();

    res.status(200).json({
      message: "Post and its comments deleted successfully",
    });
  } catch (error) {
    console.error("Delete post error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET posts by user
router.get("/user/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const posts = await Post.findAll({
      where: { userId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "username"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json(posts);
  } catch (error) {
    console.error("Fetch user posts error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


router.get("/test", (req, res) => {
  res.send("✅ Post route works");
});




module.exports = router;