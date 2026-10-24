const request = require("supertest");
const bcrypt = require("bcryptjs");
const { app } = require("../server");
const { sequelize, User, Notification } = require("../models");

let tokenA;
let tokenB;
let userA;
let userB;
let requestId;

beforeAll(async () => {
  await sequelize.sync({ force: true });

  const hashedPassword = await bcrypt.hash("123456", 10);

  // Create users
  userA = await User.create({
    firstName: "Matt",
    lastName: "Omar",
    username: "matt",
    email: "matt@test.com",
    password: hashedPassword,
  });

  userB = await User.create({
    firstName: "John",
    lastName: "Doe",
    username: "john",
    email: "john@test.com",
    password: hashedPassword,
  });

  // Login A
  const loginA = await request(app).post("/api/auth/login").send({
    email: "matt@test.com",
    password: "123456",
  });

  tokenA = loginA.body.token;

  // Login B
  const loginB = await request(app).post("/api/auth/login").send({
    email: "john@test.com",
    password: "123456",
  });

  tokenB = loginB.body.token;
});

afterAll(async () => {
  await sequelize.close();
});

describe("Notifications System", () => {
  test("starts with no notifications", async () => {
    const res = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("creates notification on friend request", async () => {
    await request(app)
      .post(`/api/friends/send/${userB.id}`)
      .set("Authorization", `Bearer ${tokenA}`);

    const res = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.statusCode).toBe(200);

    expect(res.body.length).toBeGreaterThan(0);

    const hasFriendRequest = res.body.some((n) => n.type === "friend_request");

    expect(hasFriendRequest).toBe(true);
  });

  test("creates notification on accept", async () => {
    // get pending request
    const pending = await request(app)
      .get("/api/friends/pending")
      .set("Authorization", `Bearer ${tokenB}`);

    requestId = pending.body[0].id;

    // accept request
    await request(app)
      .post(`/api/friends/accept/${requestId}`)
      .set("Authorization", `Bearer ${tokenB}`);

    // check notification for sender (userA)
    const res = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.statusCode).toBe(200);

    const hasAccepted = res.body.some((n) => n.type === "friend_accepted");

    expect(hasAccepted).toBe(true);
  });

  test("notification contains correct userId", async () => {
    const res = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.statusCode).toBe(200);

    res.body.forEach((n) => {
      expect(n.userId).toBe(userB.id);
    });
  });

  test("notifications are ordered newest first", async () => {
    const res = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.statusCode).toBe(200);

    for (let i = 1; i < res.body.length; i++) {
      expect(
        new Date(res.body[i - 1].createdAt) >= new Date(res.body[i].createdAt),
      ).toBe(true);
    }
  });
});
