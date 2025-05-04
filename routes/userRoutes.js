const express = require("express");
const router = express.Router();

// Route to initialize a user session or get a unique ID
router.get("/start-session", (req, res) => {
  if (!req.session.user) {
    req.session.user = { id: Date.now().toString(36) };   }
  res.json({ message: "Session started", userId: req.session.user.id });
});

// Route to end the current session (log out)
router.get("/end-session", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Error ending session" });
      }
      res.json({ message: "Session ended" });
    });
  });

module.exports = router;