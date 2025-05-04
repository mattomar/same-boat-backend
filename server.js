require("dotenv").config(); // Load environment variables from .env file

const express = require("express");
const session = require("express-session");
const userRoutes = require("./routes/userRoutes"); // Import the userRoutes file
const app = express();

// Set up session management middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET, // Use the secret from the .env file
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true if using HTTPS
  })
);
app.use(express.json()); 


// Use the user routes
app.use("/user", userRoutes); // Add the route prefix to your user routes

// Start the server
app.listen(3000, () => {
  console.log("Server running on port 3000");
});