const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const config = require('./config/env');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error-handler');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.nodeEnv === 'production');

// Compresion gzip para respuestas de texto (HTML/JSON/JS/CSS).
app.use(compression());

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
}));

// CSP estricto solo para el panel: sin scripts/estilos inline y sin marcos.
// El resto de paginas publicas mantiene la politica global.
const dashboardCsp = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://*.basemaps.cartocdn.com'],
      connectSrc: ["'self'", 'wss:', 'ws:', 'https:'],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origen no permitido por CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Token'],
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/health', (req, res) => {
  let dbInfo = { db: 'sqlite' };
  try {
    const db = require('./db');
    const count = (table) => {
      try { return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c; } catch (_) { return -1; }
    };
    dbInfo = {
      db: 'sqlite',
      dbPathBasename: require('path').basename(require('./config/env').dbPath),
      dbParent: require('path').basename(require('path').dirname(require('./config/env').dbPath)),
      users: count('users'),
      devices: count('devices'),
      licenses: count('licenses'),
      registrations: count('registrations'),
    };
  } catch (_) {}
  return res.json({
    status: 'ok',
    version: '3.0.0',
    ...dbInfo,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', routes);

// Estaticos publicos: cache de 1 dia para activos versionados por contenido
// (css/js/svg). Las carpetas uploads/receipts/downloads se sirven sin cache
// para no entregar contenido sensible obsoleto ni romper descargas nuevas.
app.use(express.static(path.join(config.projectRoot, 'public'), {
  index: false,
  maxAge: '1d',
  setHeaders(res, filePath) {
    if (filePath.includes(path.sep + 'uploads' + path.sep) ||
        filePath.includes(path.sep + 'receipts' + path.sep) ||
        filePath.includes(path.sep + 'downloads' + path.sep)) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));
app.get('/pay', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'pay.html')));
app.get('/success', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'success.html')));
app.get('/reset', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'reset.html')));
app.get('/download', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'downloads.html')));
app.get('/manual-samsung', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'manual-samsung.html')));
app.get('/dashboard', dashboardCsp, (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'dashboard.html')));
app.get('/about', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'about.html')));
app.get('/', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'index.html')));

// Servir el dashboard HTML también en la raíz y en la carpeta public
app.use(express.static(path.join(config.projectRoot, 'public')));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
