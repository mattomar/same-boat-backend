const request = require("supertest");
const { app, sequelize } = require("../server"); // destructured app & sequelize from server.js
const { User, Role } = require("../models");

beforeAll(async () => {
    await sequelize.sync({ force: true });
    await Role.findOrCreate({ where: { name: "User" } });
    await Role.findOrCreate({ where: { name: "Member" } }); // add this line
  });
afterAll(async () => {
  await sequelize.close();
});

describe("Auth routes", () => {
    const testUser = {
        firstName: "John",
        lastName: "Doe",
        email: "jochn@example.com",
        password: "password123",
      };

  let token;

  test("POST /api/auth/signup - should create new user and assign role", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send(testUser);
  
    if (res.status !== 201) {
      console.error("Signup failed:", res.status, res.body);
    }
  
    expect(res.status).toBe(201);
    expect(res.body.message).toBe("User registered successfully");
    expect(res.body.role).toBe("Member");
  
    const user = await User.findOne({ where: { email: testUser.email } });
    expect(user).not.toBeNull();
    expect(user.roleId).not.toBeNull();
  });
  

  test("POST /api/auth/login - should login user and return JWT token", async () => {
    const res = await request(app)
      .post("/api/auth/login")  // <- prefix included
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    expect(res.body.message).toBe("Login successful");
    expect(res.body.token).toBeDefined();

    token = res.body.token;
  });

  test("GET /protected - should access protected route with valid token", async () => {
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.user.email).toBe(testUser.email);
    expect(res.body.user.roleId).not.toBeNull();
  });
});