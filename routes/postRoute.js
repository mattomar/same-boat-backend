const express = require("express");
const router = express.Router();
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");
const { Post, Category, User, Comment } = require("../models");
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

      const { photo } = req.file || {}; // Only handling photo upload
      const photoUrl = photo ? await uploadToCloudinary(photo.buffer, "image") : null;

      const post = await Post.create({
        content,
        categoryId,
        userId,
        photoUrl,
        gifUrl,  // Store the GIF URL
        youtubeUrl,  // Store the YouTube URL
      });

      res.status(201).json(post);
    } catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);


// GET posts by category
router.get("/category/:categoryId", async (req, res) => {
  try {
    const { categoryId } = req.params;
    const posts = await Post.findAll({
      where: { categoryId },
      include: [{ model: User, as: "user", attributes: ["id", "username"] }],
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
router.post("/:postId/comments", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, parentId } = req.body;
    const userId = req.user.id;

    const post = await Post.findByPk(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = await Comment.create({
      content,
      userId,
      postId,
      parentId: parentId || null,
    });

    res.status(201).json(comment);
  } catch (err) {
    console.error("Create comment error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET comments (nested)
router.get("/:postId/comments", async (req, res) => {
  try {
    const { postId } = req.params;
    const comments = await Comment.findAll({
      where: { postId, parentId: null },
      include: [
        {
          model: Comment,
          as: "replies",
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "username"],
            },
          ],
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "username"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });
    res.status(200).json(comments);
  } catch (err) {
    console.error("Fetch comments error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE a comment + its nested replies
const deleteCommentWithReplies = async (commentId) => {
  const replies = await Comment.findAll({ where: { parentId: commentId } });
  for (const reply of replies) {
    await deleteCommentWithReplies(reply.id);
  }
  await Comment.destroy({ where: { id: commentId } });
};

router.delete("/comments/:commentId", authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.id;
    console.log("Delete commentId:", commentId);

    const comment = await Comment.findByPk(commentId);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    if (comment.userId !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await deleteCommentWithReplies(comment.id);

    res.status(200).json({ message: "Comment and its replies deleted successfully" });
  } catch (error) {
    console.error("Delete comment error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/test", (req, res) => {
  res.send("✅ Post route works");
});

module.exports = router;