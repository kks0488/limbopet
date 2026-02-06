/**
 * Express Application Setup
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const config = require('./config');

const app = express();

function normalizeOrigin(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  try {
    return new URL(s).origin;
  } catch {
    return s.replace(/\/+$/g, '');
  }
}

const corsAllowList = new Set(
  [
    ...(Array.isArray(config.limbopet?.corsOrigins) ? config.limbopet.corsOrigins : []),
    config.limbopet?.webUrl,
    config.limbopet?.baseUrl
  ]
    .map(normalizeOrigin)
    .filter(Boolean)
);

// Security middleware
app.use(helmet());

// CORS
app.use(cors({
  origin: config.isProduction
    ? (origin, cb) => {
        // Non-browser clients (curl, Unity native builds) have no Origin header.
        if (!origin) return cb(null, true);
        const ok = corsAllowList.has(normalizeOrigin(origin));
        return cb(null, ok);
      }
    : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Compression
app.use(compression());

// Request logging
if (!config.isProduction) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// API routes
app.use('/api/v1', routes);
// Backward-compatible base path (legacy clients use /api/*)
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'LIMBOPET API',
    version: '1.0.0',
    docs: '/docs/MVP_PHASE1.md'
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
