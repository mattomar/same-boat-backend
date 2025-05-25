const { app } = require("../server");
const request = require("supertest");
const db = require("../models");

describe("GET /profile/:userId", () => {
  let user, profile;

  beforeAll(async () => {
    await db.sequelize.sync({ force: true });

    user = await db.User.create({
      firstName: "Test",
      lastName: "User",
      username: "testuser",
      email: "tesvtss@example.com",
      password: "hashedpw", // hash it if needed
    });

    profile = await db.Profile.create({
      bio: "Test bio",
      avatarUrl: "http://example.com/avatar.png",
      phone: "123456789",
      userId: user.id,
    });
  });

  afterAll(async () => {
    await db.sequelize.close();
  });

  it("should return user profile with bio, avatarUrl, and phone", async () => {
    const res = await request(app).get(`/profile/${user.id}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("username", "testuser");
    expect(res.body.profile).toMatchObject({
      bio: "Test bio",
      avatarUrl: "http://example.com/avatar.png",
      phone: "123456789",
    });
  });
});