const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { sub_district_id } = req.query;
      let query = 'SELECT * FROM villages';
      let params = [];

      if (sub_district_id) {
        query += ' WHERE sub_district_id = $1';
        params.push(sub_district_id);
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