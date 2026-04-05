const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: '../.env' });

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Database connected successfully!');
    release();
  }
});

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    message: 'India Villages API is running!', 
    version: '1.0.0' 
  });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'OK', database: 'connected' });
  } catch (err) {
    res.json({ status: 'ERROR', database: 'disconnected' });
  }
});

app.get('/api/states', async (req, res) => {
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

app.get('/api/districts', async (req, res) => {
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

app.get('/api/sub-districts', async (req, res) => {
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

app.get('/api/villages', async (req, res) => {
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

app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ 
        success: false, 
        error: 'Search query required' 
      });
    }
    const result = await pool.query(
      `SELECT v.*, sd.name as sub_district, 
              d.name as district, s.name as state
       FROM villages v
       JOIN sub_districts sd ON v.sub_district_id = sd.id
       JOIN districts d ON sd.district_id = d.id
       JOIN states s ON d.state_id = s.id
       WHERE v.name ILIKE $1 LIMIT 50`,
      [`%${q}%`]
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});