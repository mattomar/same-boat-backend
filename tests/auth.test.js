const request = require("supertest");
const path = require("path");
const { app } = require("../server"); 
const { User, Profile } = require("../models");

describe("User registration with avatar upload and profile creation", () => {
  let testUserId;

  const userData = {
    firstName: "Test",
    lastName: "User",
    username: "testuser123",
    email: "testuser123@example.com",
    password: "TestPass123!",
    bio: "This is a test bio.",
  };

  it("should register a user, upload avatar, create profile with bio and image URL", async () => {
    const res = await request(app)
    .post("/api/auth/signup")
    .field("firstName", userData.firstName)
      .field("lastName", userData.lastName)
      .field("username", userData.username)
      .field("email", userData.email)
      .field("password", userData.password)
      .field("bio", userData.bio)
      .attach("avatar", path.resolve(__dirname, "avatar.png")); // provide a test image in /tests/avatar.png

    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe("User registered successfully");

    // Check returned user data
    expect(res.body.user).toHaveProperty("id");
    expect(res.body.user.firstName).toBe(userData.firstName);
    expect(res.body.user.lastName).toBe(userData.lastName);
    expect(res.body.user.username).toBe(userData.username);
    expect(res.body.user.email).toBe(userData.email);
    expect(res.body.user.bio).toBe(userData.bio);

    expect(res.body.user.avatarUrl).toMatch(/^http:\/\/.+\/uploads\/avatar-/); // basic check for URL format

    // Save testUserId for cleanup
    testUserId = res.body.user.id;

    // Check profile exists in DB
    const profile = await Profile.findOne({ where: { userId: testUserId } });
    expect(profile).not.toBeNull();
    expect(profile.bio).toBe(userData.bio);
    expect(profile.avatarUrl).toBe(res.body.user.avatarUrl);

    // Check user exists in DB with hashed password
    const user = await User.findByPk(testUserId);
    expect(user).not.toBeNull();
    expect(user.email).toBe(userData.email);
    expect(user.password).not.toBe(userData.password); // should be hashed
  });

  afterAll(async () => {
    if (testUserId) {
      // Clean up test data
      await Profile.destroy({ where: { userId: testUserId } });
      await User.destroy({ where: { id: testUserId } });
    }
  });
});