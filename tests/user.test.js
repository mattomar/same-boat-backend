require('dotenv').config(); 
const request = require("supertest");
const express = require("express");
const session = require("express-session");
const userRoutes = require("../routes/userRoutes")

// Set up Express app for testing
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET, // Using session secret from .env
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true if using HTTPS
  })
);
app.use("/user", userRoutes);

// Ensure session is properly initialized for each test
beforeEach((done) => {
  request(app)
    .get("/user/start-session")
    .end(done);
});

describe("User session tests", () => {
  test("should start a session and return user data", (done) => {
    request(app)
      .get("/user/start-session")
      .expect("Content-Type", /json/)
      .expect(200)
      .then((res) => {
        expect(res.body).toHaveProperty("userId");
        done();
      })
      .catch(done);
  });

  test("should end the session", (done) => {
    request(app)
      .get("/user/end-session")
      .expect("Content-Type", /json/)
      .expect(200)
      .then((res) => {
        expect(res.body).toHaveProperty("message", "Session ended");
        done();
      })
      .catch(done);
  });
});