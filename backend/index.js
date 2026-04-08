const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

dotenv.config({ path: '../.env' });

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'india_villages_secret_key_2024';

// ── DATABASE ─────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) console.error('Database connection failed:', err.message);
  else { console.log('Database connected successfully!'); release(); }
});

// ── PLAN LIMITS ───────────────────────────────────────────────────────────────
const PLAN_LIMITS = {
  free:      { daily: 5000,     burst: 100  },
  premium:   { daily: 50000,    burst: 500  },
  pro:       { daily: 300000,   burst: 2000 },
  unlimited: { daily: 1000000,  burst: 5000 }
};

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['https://india-villages-api.vercel.app', 'http://localhost:5173'],
  credentials: true
}));
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Request logger
app.use((req, res, next) => {
  req.requestId = 'req_' + crypto.randomBytes(8).toString('hex');
  req.startTime = Date.now();
  next();
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
const successResponse = (res, data, count, req, extra = {}) => {
  const responseTime = Date.now() - (req.startTime || Date.now());
  res.json({
    success: true,
    count: count !== undefined ? count : (Array.isArray(data) ? data.length : 1),
    data,
    meta: {
      requestId: req.requestId,
      responseTime,
      ...extra
    }
  });
};

const errorResponse = (res, status, code, message) => {
  res.status(status).json({
    success: false,
    error: { code, message }
  });
};

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return errorResponse(res, 401, 'INVALID_TOKEN', 'JWT token required');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    errorResponse(res, 401, 'INVALID_TOKEN', 'Invalid or expired token');
  }
};

const authenticateApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return errorResponse(res, 401, 'INVALID_API_KEY', 'API key required. Add X-API-Key header');

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE api_key = $1', [apiKey]
    );
    if (result.rows.length === 0) {
      return errorResponse(res, 401, 'INVALID_API_KEY', 'Invalid API key');
    }

    const user = result.rows[0];
    const plan = user.plan || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', limits.daily);
    res.setHeader('X-RateLimit-Remaining', limits.daily); // simplified
    res.setHeader('X-RateLimit-Reset', new Date(Date.now() + 86400000).toISOString());

    req.user = user;
    req.plan = plan;
    req.limits = limits;
    next();
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
};

const isAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return errorResponse(res, 403, 'ACCESS_DENIED', 'Admin access required');
  }
  next();
};

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────

// POST /auth/register
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password, business_name, phone } = req.body;
    if (!name || !email || !password) {
      return errorResponse(res, 400, 'INVALID_QUERY', 'Name, email and password required');
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return errorResponse(res, 400, 'INVALID_QUERY', 'Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const apiKey = 'ak_' + crypto.randomBytes(16).toString('hex');
    const apiSecret = 'as_' + crypto.randomBytes(16).toString('hex');
    const hashedSecret = await bcrypt.hash(apiSecret, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password, business_name, phone, api_key, api_secret, plan, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'free', 'user', 'active')
       RETURNING id, name, email, business_name, api_key, plan, status`,
      [name, email, hashedPassword, business_name || name, phone || '', apiKey, hashedSecret]
    );

    successResponse(res, {
      ...result.rows[0],
      api_secret: apiSecret,
      warning: 'Save your API secret! It will not be shown again.'
    }, undefined, req);

  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return errorResponse(res, 400, 'INVALID_QUERY', 'Email and password required');
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return errorResponse(res, 401, 'INVALID_API_KEY', 'Invalid credentials');
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return errorResponse(res, 401, 'INVALID_API_KEY', 'Invalid credentials');

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, plan: user.plan },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    successResponse(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        role: user.role,
        api_key: user.api_key
      }
    }, undefined, req);

  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /auth/me
app.get('/auth/me', authenticateJWT, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, business_name, phone, plan, role, status, api_key, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    successResponse(res, result.rows[0], undefined, req);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// ── GEO API ROUTES (v1) ───────────────────────────────────────────────────────

// GET /v1/states
app.get('/v1/states', authenticateApiKey, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM states ORDER BY name ASC');
    successResponse(res, result.rows, result.rows.length, req, {
      rateLimit: {
        limit: req.limits.daily,
        remaining: req.limits.daily,
        reset: new Date(Date.now() + 86400000).toISOString()
      }
    });
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /v1/states/:id/districts
app.get('/v1/states/:id/districts', authenticateApiKey, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM districts WHERE state_id = $1 ORDER BY name ASC',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return errorResponse(res, 404, 'NOT_FOUND', 'State not found or has no districts');
    }
    successResponse(res, result.rows, result.rows.length, req);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /v1/districts/:id/subdistricts
app.get('/v1/districts/:id/subdistricts', authenticateApiKey, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM sub_districts WHERE district_id = $1 ORDER BY name ASC',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return errorResponse(res, 404, 'NOT_FOUND', 'District not found or has no sub-districts');
    }
    successResponse(res, result.rows, result.rows.length, req);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /v1/subdistricts/:id/villages
app.get('/v1/subdistricts/:id/villages', authenticateApiKey, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM villages WHERE sub_district_id = $1',
      [req.params.id]
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      'SELECT * FROM villages WHERE sub_district_id = $1 ORDER BY name ASC LIMIT $2 OFFSET $3',
      [req.params.id, limit, offset]
    );

    successResponse(res, result.rows, result.rows.length, req, {
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /v1/search
app.get('/v1/search', authenticateApiKey, async (req, res) => {
  try {
    const { q, state, district, subDistrict, limit = 50 } = req.query;
    if (!q || q.length < 2) {
      return errorResponse(res, 400, 'INVALID_QUERY', 'Search query must be at least 2 characters');
    }

    let query = `
      SELECT 
        v.id,
        v.name as village,
        sd.name as sub_district,
        d.name as district,
        s.name as state,
        'India' as country,
        CONCAT(v.name, ', ', sd.name, ', ', d.name, ', ', s.name, ', India') as full_address,
        v.id as value,
        v.name as label
      FROM villages v
      JOIN sub_districts sd ON v.sub_district_id = sd.id
      JOIN districts d ON sd.district_id = d.id
      JOIN states s ON d.state_id = s.id
      WHERE v.name ILIKE $1
    `;
    const params = [`%${q}%`];
    let paramCount = 1;

    if (state) {
      paramCount++;
      query += ` AND s.name ILIKE $${paramCount}`;
      params.push(`%${state}%`);
    }
    if (district) {
      paramCount++;
      query += ` AND d.name ILIKE $${paramCount}`;
      params.push(`%${district}%`);
    }
    if (subDistrict) {
      paramCount++;
      query += ` AND sd.name ILIKE $${paramCount}`;
      params.push(`%${subDistrict}%`);
    }

    paramCount++;
    query += ` ORDER BY v.name ASC LIMIT $${paramCount}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    successResponse(res, result.rows, result.rows.length, req);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /v1/autocomplete
app.get('/v1/autocomplete', authenticateApiKey, async (req, res) => {
  try {
    const { q, hierarchyLevel = 'village', limit = 10 } = req.query;
    if (!q || q.length < 2) {
      return errorResponse(res, 400, 'INVALID_QUERY', 'Query must be at least 2 characters');
    }

    const result = await pool.query(`
      SELECT 
        v.id as value,
        v.name as label,
        CONCAT(v.name, ', ', sd.name, ', ', d.name, ', ', s.name, ', India') as full_address,
        json_build_object(
          'village', v.name,
          'subDistrict', sd.name,
          'district', d.name,
          'state', s.name,
          'country', 'India'
        ) as hierarchy
      FROM villages v
      JOIN sub_districts sd ON v.sub_district_id = sd.id
      JOIN districts d ON sd.district_id = d.id
      JOIN states s ON d.state_id = s.id
      WHERE v.name ILIKE $1
      ORDER BY v.name ASC
      LIMIT $2
    `, [`${q}%`, parseInt(limit)]);

    successResponse(res, result.rows, result.rows.length, req);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────

// GET /admin/users
app.get('/admin/users', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const { search, plan, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT id, name, email, business_name, plan, role, status, 
                 api_key, created_at FROM users WHERE 1=1`;
    const params = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` AND (email ILIKE $${paramCount} OR name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }
    if (plan) {
      paramCount++;
      query += ` AND plan = $${paramCount}`;
      params.push(plan);
    }
    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    const countResult = await pool.query('SELECT COUNT(*) FROM users');

    successResponse(res, result.rows, result.rows.length, req, {
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count)
      }
    });
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// PUT /admin/users/:id/plan
app.put('/admin/users/:id/plan', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLAN_LIMITS[plan]) {
      return errorResponse(res, 400, 'INVALID_QUERY', 'Invalid plan. Use: free, premium, pro, unlimited');
    }
    const result = await pool.query(
      'UPDATE users SET plan = $1 WHERE id = $2 RETURNING id, name, email, plan',
      [plan, req.params.id]
    );
    successResponse(res, result.rows[0], undefined, req);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// PUT /admin/users/:id/status
app.put('/admin/users/:id/status', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, name, email, status',
      [status, req.params.id]
    );
    successResponse(res, result.rows[0], undefined, req);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /admin/stats
app.get('/admin/stats', authenticateJWT, isAdmin, async (req, res) => {
  try {
    const states = await pool.query('SELECT COUNT(*) FROM states');
    const districts = await pool.query('SELECT COUNT(*) FROM districts');
    const subDistricts = await pool.query('SELECT COUNT(*) FROM sub_districts');
    const villages = await pool.query('SELECT COUNT(*) FROM villages');
    const users = await pool.query('SELECT COUNT(*) FROM users');
    const planDist = await pool.query(
      'SELECT plan, COUNT(*) as count FROM users GROUP BY plan'
    );

    successResponse(res, {
      data: {
        states: parseInt(states.rows[0].count),
        districts: parseInt(districts.rows[0].count),
        subDistricts: parseInt(subDistricts.rows[0].count),
        villages: parseInt(villages.rows[0].count),
        totalUsers: parseInt(users.rows[0].count)
      },
      planDistribution: planDist.rows
    }, undefined, req);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', err.message);
  }
});

// ── HOME & HEALTH ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'India Villages API',
    version: '1.0.0',
    endpoints: {
      auth: {
        register: 'POST /auth/register',
        login: 'POST /auth/login',
        me: 'GET /auth/me'
      },
      geo: {
        states: 'GET /v1/states',
        districts: 'GET /v1/states/:id/districts',
        subDistricts: 'GET /v1/districts/:id/subdistricts',
        villages: 'GET /v1/subdistricts/:id/villages',
        search: 'GET /v1/search?q=',
        autocomplete: 'GET /v1/autocomplete?q='
      },
      admin: {
        users: 'GET /admin/users',
        stats: 'GET /admin/stats'
      }
    }
  });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'OK', database: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'ERROR', database: 'disconnected' });
  }
});

// 404 handler
app.use((req, res) => {
  errorResponse(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`);
});
module.exports = app;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});