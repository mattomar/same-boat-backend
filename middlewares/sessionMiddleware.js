
require("dotenv").config(); // Load environment variables from .env file


const session = require("express-session");

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET, // Use the secret from the .env file
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true if using HTTPS
})

module.exports = sessionMiddleware;