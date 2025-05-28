process.env.JWT_SECRET = "supersecretkey123";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { app } = require("../server");
const { sequelize, User, FriendRequest, Role } = require("../models");

let user1Token, user2Token;
let user1, user2;

beforeAll(async () => {
  await sequelize.sync({ force: true });

  const role = await Role.create({ name: "Member" });

  user1 = await User.create({
    firstName: "Alice",
    lastName: "Smith",
    username: "alice",
    email: "alice@example.com",
    password: await bcrypt.hash("password1", 10),
    roleId: role.id,
  });

  user2 = await User.create({
    firstName: "Bob",
    lastName: "Jones",
    username: "bob",
    email: "bob@example.com",
    password: await bcrypt.hash("password2", 10),
    roleId: role.id,
  });

  user1Token = jwt.sign(
    { id: user1.id, email: user1.email, roleId: user1.roleId },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  user2Token = jwt.sign(
    { id: user2.id, email: user2.email, roleId: user2.roleId },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
});

afterAll(async () => {
  await sequelize.close();
});

describe("Friend Request Flow", () => {
  let requestId;

  test("user1 sends a friend request to user2", async () => {
    const res = await request(app)
      .post(`/friend-requests/send/${user2.id}`) // ✅ Fixed path
      .set("Authorization", `Bearer ${user1Token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/sent/i);

    const requestInDb = await FriendRequest.findOne({ where: { senderId: user1.id, receiverId: user2.id } });
    requestId = requestInDb.id;
  });

  test("user1 cannot send duplicate request", async () => {
    const res = await request(app)
      .post(`/friend-requests/send/${user2.id}`) // ✅ Fixed path
      .set("Authorization", `Bearer ${user1Token}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/already sent/i);
  });

  test("user1 cannot send request to themselves", async () => {
    const res = await request(app)
      .post(`/friend-requests/send/${user1.id}`) // ✅ Fixed path
      .set("Authorization", `Bearer ${user1Token}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/yourself/i);
  });

  test("user2 accepts the friend request", async () => {
    const res = await request(app)
      .post(`/friend-requests/accept/${requestId}`) // ✅ Fixed path
      .set("Authorization", `Bearer ${user2Token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/accepted/i);

    const updatedRequest = await FriendRequest.findByPk(requestId);
    expect(updatedRequest.status).toBe("accepted");
  });

  test("accepted friends are listed for both users", async () => {
    const res1 = await request(app)
      .get("/friend-requests/friends") // ✅ Fixed path
      .set("Authorization", `Bearer ${user1Token}`);

    const res2 = await request(app)
      .get("/friend-requests/friends") // ✅ Fixed path
      .set("Authorization", `Bearer ${user2Token}`);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.body.some(friend => friend.username === "bob")).toBe(true);
    expect(res2.body.some(friend => friend.username === "alice")).toBe(true);
  });

  test("user2 receives a new request and declines it", async () => {
    const user3 = await User.create({
      firstName: "Charlie",
      lastName: "Ray",
      username: "charlie",
      email: "charlie@example.com",
      password: await bcrypt.hash("password3", 10),
      roleId: user1.roleId,
    });

    const token3 = jwt.sign(
      { id: user3.id, email: user3.email, roleId: user3.roleId },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const sendRes = await request(app)
      .post(`/friend-requests/send/${user2.id}`) // ✅ Fixed path
      .set("Authorization", `Bearer ${token3}`);

    const pendingRequest = await FriendRequest.findOne({
      where: { senderId: user3.id, receiverId: user2.id },
    });

    const declineRes = await request(app)
      .post(`/friend-requests/decline/${pendingRequest.id}`) // ✅ Fixed path
      .set("Authorization", `Bearer ${user2Token}`);

    expect(declineRes.statusCode).toBe(200);
    expect(declineRes.body.message).toMatch(/declined/i);

    const finalRequest = await FriendRequest.findByPk(pendingRequest.id);
    expect(finalRequest.status).toBe("declined");
  });
});