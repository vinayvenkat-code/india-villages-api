const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM states ORDER BY name ASC'
      );
      res.json({
        success: true,
        count: result.rows.length,
        data: result.rows
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};