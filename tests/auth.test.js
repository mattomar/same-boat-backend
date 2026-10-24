const request = require("supertest");
const { app } = require("../server"); // FIXED
const { Post, Category } = require("../models");
const cloudinary = require("../config/cloudinary");

// Mock cloudinary upload
jest.mock("../config/cloudinary", () => ({
  uploader: {
    upload_stream: jest.fn(),
  },
}));

// Mock streamifier
jest.mock("streamifier", () => ({
  createReadStream: jest.fn(() => ({
    pipe: jest.fn(),
  })),
}));

// Mock auth middleware (so no JWT needed)
jest.mock("../middlewares/auth", () => {
  return (req, res, next) => {
    req.user = { id: 1, username: "testuser" };
    next();
  };
});

describe("POST /posts/createPost", () => {
  let category;

  beforeAll(async () => {
    await Post.destroy({ where: {} });
    await Category.destroy({ where: {} });

    category = await Category.create({
      name: "Test Category",
    });
  });

  afterAll(async () => {
    await Post.destroy({ where: {} });
    await Category.destroy({ where: {} });
  });

  it("should create a new post with files", async () => {
    cloudinary.uploader.upload_stream.mockImplementation(
      (options, callback) => {
        return {
          end: () =>
            callback(null, {
              secure_url: "https://fakeurl.com/media.jpg",
            }),
        };
      },
    );

    const response = await request(app)
      .post("/posts/createPost")
      .field("title", "Test Post")
      .field("content", "This is a test post.")
      .field("categoryId", category.id)
      .attach("photo", Buffer.from("fake image"), {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

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
