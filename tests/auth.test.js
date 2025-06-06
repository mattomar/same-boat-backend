const request = require("supertest");
const app = require("../server"); // your Express app
const { Post, Category } = require("../models");
const cloudinary = require("../config/cloudinary");
const jwt = require("jsonwebtoken");

// Mock cloudinary upload
jest.mock("../config/cloudinary", () => ({
  uploader: {
    upload_stream: jest.fn(),
  },
}));

// Create mock streamifier
jest.mock("streamifier", () => ({
  createReadStream: jest.fn(() => ({
    pipe: jest.fn(),
  })),
}));

// Mock token verification middleware
jest.mock("../middlewares/auth", () => {
  return (req, res, next) => {
    req.user = { id: 1, username: "testuser" }; // fake authenticated user
    next();
  };
});

describe("POST /posts/createPost", () => {
  beforeAll(async () => {
    await Category.create({ id: 1, name: "Test Category" });
  });

  afterAll(async () => {
    await Post.destroy({ where: {} });
    await Category.destroy({ where: {} });
  });

  it("should create a new post with files", async () => {
    // Mock cloudinary upload_stream behavior
    cloudinary.uploader.upload_stream.mockImplementation((options, callback) => {
      return {
        end: () => callback(null, { secure_url: "https://fakeurl.com/media.jpg" }),
      };
    });

    const response = await request(app)
      .post("/posts/createPost")
      .field("title", "Test Post")
      .field("content", "This is a test post.")
      .field("categoryId", "1")
      .attach("photo", Buffer.from("fake image content"), { filename: "photo.jpg", contentType: "image/jpeg" });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("id");
    expect(response.body.title).toBe("Test Post");
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalled();
  });

  it("should fail with invalid category", async () => {
    const response = await request(app)
      .post("/posts/createPost")
      .field("title", "Invalid Post")
      .field("content", "Invalid category test")
      .field("categoryId", "999");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid category");
  });
});