const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const cloudinary = require("../config/cloudinary");
const multer = require("multer");
const streamifier = require("streamifier");
const { app } = require("../server");
const { User, Category, Role, sequelize } = require("../models");
const path = require("path");
const fs = require("fs");


jest.setTimeout(20000);
jest.mock("../config/cloudinary", () => ({
  uploader: {
    upload_stream: jest.fn().mockImplementation((options, callback) => {
      const writable = require("stream").Writable();
      writable._write = (chunk, enc, next) => next();
      process.nextTick(() =>
        callback(null, { secure_url: "https://res.cloudinary.com/dummy-file" })
      );
      return writable;
    }),
  },
}));

describe("Post creation and category filtering", () => {
  let token;
  let category;
  let user;

  beforeAll(async () => {
    // Reset DB
    await sequelize.sync({ force: true });

    // Create role for user (adjust role name as per your DB)
    const role = await Role.create({ name: "Member" });

    // Create user with hashed password and roleId
    user = await User.create({
      firstName: "Jane",
      lastName: "Doe",
      username: "janedoe",
      email: "jane@example.com",
      password: await bcrypt.hash("secure123", 10),
      roleId: role.id,
    });

    // Sign JWT token with payload matching your auth middleware
    token = jwt.sign(
      { userId: user.id, email: user.email, roleId: user.roleId },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    // Create category to assign posts to
    category = await Category.create({ name: "Books" });
    await request(app)
  .post("/posts")
  .set("Authorization", `Bearer ${token}`)
  .send({
    title: "My Favorite Book",
    content: "This is an amazing story.",
    categoryId: category.id,
  });
  });

  afterAll(async () => {
    await sequelize.close();
  });


  test("should allow authenticated user to upload media files and create post", async () => {
    const res = await request(app)
      .post("/posts")
      .set("Authorization", `Bearer ${token}`)
      .field("title", "Uploaded Media Post")
      .field("content", "Uploaded files should appear")
      .field("categoryId", category.id)
      .attach("photo", fs.createReadStream(path.resolve(__dirname, "test-assets/sample.jpg")))
      .attach("video", fs.createReadStream(path.resolve(__dirname, "test-assets/sample.mp4")))
      .attach("audio", fs.createReadStream(path.resolve(__dirname, "test-assets/sample.mp3")))
  
    expect(res.statusCode).toBe(201);
    expect(res.body.photoUrl).toMatch(/^https:\/\/res\.cloudinary\.com/);
    expect(res.body.videoUrl).toMatch(/^https:\/\/res\.cloudinary\.com/);
    expect(res.body.audioUrl).toMatch(/^https:\/\/res\.cloudinary\.com/);
  });

  test("should return posts under category", async () => {
    const res = await request(app).get(`/posts/category/${category.id}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.some(post => post.title === "My Favorite Book")).toBe(true);
    expect(res.body.some(post => post.user.username === "janedoe")).toBe(true);
  });
  
});