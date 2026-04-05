const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { district_id } = req.query;
      let query = 'SELECT * FROM sub_districts';
      let params = [];

      if (district_id) {
        query += ' WHERE district_id = $1';
        params.push(district_id);
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