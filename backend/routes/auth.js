const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

module.exports = (pool) => {
  const router = express.Router();

  router.post('/register', async (req, res) => {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ 
          success: false, 
          error: 'All fields required' 
        });
      }

      const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1', [email]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Email already exists' 
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const apiKey = 'vak_' + crypto.randomBytes(24).toString('hex');

      const result = await pool.query(
        `INSERT INTO users (name, email, password, api_key, plan) 
         VALUES ($1, $2, $3, $4, 'free') 
         RETURNING id, name, email, api_key, plan`,
        [name, email, hashedPassword, apiKey]
      );

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: result.rows[0]
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ 
          success: false, 
          error: 'Email and password required' 
        });
      }

      const result = await pool.query(
        'SELECT * FROM users WHERE email = $1', [email]
      );
      if (result.rows.length === 0) {
        return res.status(401).json({ 
          success: false, 
          error: 'Invalid credentials' 
        });
      }

      const user = result.rows[0];
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ 
          success: false, 
          error: 'Invalid credentials' 
        });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, plan: user.plan },
        process.env.JWT_SECRET || 'india_villages_secret',
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        message: 'Login successful',
        token,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          api_key: user.api_key,
          plan: user.plan
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};