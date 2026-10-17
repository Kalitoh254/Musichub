'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 5000);

if (!process.env.DATABASE_URL) {
  console.error('Startup blocked: DATABASE_URL is not configured.');
  process.exit(1);
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Startup blocked: PORT is invalid.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: true }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', error => {
  console.error('Unexpected database connection error:', error.message);
});

app.disable('x-powered-by');

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

const allowedOrigins = new Set([
  "http://127.0.0.1:8000",
  "http://localhost:8000"
]);
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403);
  }
  next();
});
app.use(helmet());
app.use(express.json({ limit: '16kb', strict: true }));
app.use(rateLimit({
  windowMs: 60000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));

app.locals.pool = pool;
app.use('/api/v1/account', require('./routes/account'));
app.use('/api/v1/payments', require('./routes/payments'));


app.get('/api/v1/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'ok',
      service: 'musichub-api',
      database: 'connected'
    });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({
      status: 'unavailable',
      service: 'musichub-api',
      database: 'disconnected'
    });
  }
});

app.get('/api/v1/songs', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 25)
    );
    const search = String(req.query.search || '').trim().slice(0, 100);
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT id, title, artist, cover_key, download_price_kes
       FROM songs
       WHERE is_published = TRUE
         AND ($1 = '' OR title ILIKE '%' || $1 || '%'
              OR artist ILIKE '%' || $1 || '%')
       ORDER BY title ASC
       LIMIT $2 OFFSET $3`,
      [search, limit, offset]
    );

    res.json({
      data: result.rows,
      pagination: { page, limit, returned: result.rowCount }
    });
  } catch (error) {
    next(error);
  }
});


// Serve only approved frontend files; never expose backend source or repository files.
const projectRoot = path.resolve(__dirname, '../..');
const frontendFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/auth.js', 'auth.js'],
  ['/style.css', 'style.css'],
  ['/manifest.json', 'manifest.json'],
  ['/songs.json', 'songs.json'],
  ['/service-worker.js', 'service-worker.js']
]);
app.get([...frontendFiles.keys()], (req, res, next) => {
  res.sendFile(path.join(projectRoot, frontendFiles.get(req.path)), error => {
    if (error) next(error);
  });
});
app.use('/icons', express.static(path.join(projectRoot, 'icons'), {
  dotfiles: 'deny', index: false
}));
app.use('/mshub', express.static(path.join(projectRoot, 'mshub'), {
  dotfiles: 'deny', index: false
}));

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'Internal server error' });
});

let server;

async function shutdown(signal) {
  console.log(`${signal} received; shutting down MusicHub API.`);
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  await pool.end();
  process.exit(0);
}

async function start() {
  await pool.query('SELECT 1');
  server = app.listen(port, host, () => {
    console.log(`MusicHub API listening on ${host}:${port}`);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(error => {
  console.error('MusicHub API could not start:', error.message);
  process.exit(1);
});
