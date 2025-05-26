const express = require("express");
const router = express.Router();
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");
const { Post, Category, User } = require("../models");
const authenticateToken = require("../middlewares/auth");

const upload = multer(); // memory storage

// Helper function to upload buffer to Cloudinary
const uploadToCloudinary = (buffer, resourceType) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
};

router.post(
  "/",
  authenticateToken,
  upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { title, content, categoryId } = req.body;
      const userId = req.user.id;

      const category = await Category.findByPk(categoryId);
      if (!category) {
        return res.status(400).json({ message: "Invalid category" });
      }

      const { photo, video, audio } = req.files || {};

      const photoUrl = photo
        ? await uploadToCloudinary(photo[0].buffer, "image")
        : null;
      const videoUrl = video
        ? await uploadToCloudinary(video[0].buffer, "video")
        : null;
      const audioUrl = audio
        ? await uploadToCloudinary(audio[0].buffer, "video")
        : null; // Cloudinary uses 'video' for audio too

      const post = await Post.create({
        title,
        content,
        categoryId,
        userId,
        photoUrl,
        videoUrl,
        audioUrl,
      });

      res.status(201).json(post);
    } catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

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

module.exports = router;