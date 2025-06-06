const express = require('express');
const axios = require('axios');
const router = express.Router();

const apiKey = process.env.GIPHY_API_KEY;

router.get('/search', async (req, res) => {
  const query = req.query.q;

  try {
    const response = await axios.get('https://api.giphy.com/v1/gifs/search', {
      params: {
        api_key: apiKey,
        q: query,
        limit: 10,
      },
    });

    res.json(response.data.data);
  } catch (err) {
    console.error('Giphy fetch failed:', err.message);
    res.status(500).json({ message: 'Giphy fetch failed', error: err.message });
  }
});

module.exports = router;