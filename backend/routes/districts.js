const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { state_id } = req.query;
      let query = 'SELECT * FROM districts';
      let params = [];

      if (state_id) {
        query += ' WHERE state_id = $1';
        params.push(state_id);
      }

      query += ' ORDER BY name ASC';
      const result = await pool.query(query, params);
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