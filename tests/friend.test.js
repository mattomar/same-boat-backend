const request = require("supertest");
const bcrypt = require("bcryptjs");
const { app } = require("../server");
const { sequelize, User } = require("../models");

let tokenA;
let tokenB;
let userA;
let userB;
let requestId;

beforeAll(async () => {
  await sequelize.sync({ force: true });

  const hashedPassword = await bcrypt.hash("123456", 10);

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

  const loginA = await request(app).post("/api/auth/login").send({
    email: "matt@test.com",
    password: "123456",
  });

  console.log("loginA:", loginA.statusCode, loginA.body);

  tokenA = loginA.body.token;

  const loginB = await request(app).post("/api/auth/login").send({
    email: "john@test.com",
    password: "123456",
  });

  console.log("loginB:", loginB.statusCode, loginB.body);

  tokenB = loginB.body.token;
});

afterAll(async () => {
  await sequelize.close();
});

describe("Friend System", () => {
  test("Send friend request", async () => {
    const res = await request(app)
      .post(`/api/friends/send/${userB.id}`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.statusCode).toBe(200);
  });

  test("Cannot send duplicate request", async () => {
    const res = await request(app)
      .post(`/api/friends/send/${userB.id}`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.statusCode).toBe(400);
  });

  test("View pending requests", async () => {
    const res = await request(app)
      .get("/api/friends/pending")
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);

    requestId = res.body[0].id;
  });

  test("Accept friend request", async () => {
    const res = await request(app)
      .post(`/api/friends/accept/${requestId}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.statusCode).toBe(200);
  });

  test("Friends list contains friend", async () => {
    const res = await request(app)
      .get("/api/friends/friends")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test("Remove friend", async () => {
    const res = await request(app)
      .delete(`/api/friends/${userB.id}`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.statusCode).toBe(200);
  });

  test("Friends list empty after removal", async () => {
    const res = await request(app)
      .get("/api/friends/friends")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(0);
  });
});
