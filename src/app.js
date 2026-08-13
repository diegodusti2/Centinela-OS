const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config/env');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error-handler');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.nodeEnv === 'production');

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
}));

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

app.get('/health', (req, res) => res.json({
  status: 'ok',
  version: '3.0.0',
  db: 'sqlite',
  timestamp: new Date().toISOString(),
}));

app.use('/api', routes);
app.use(express.static(path.join(config.projectRoot, 'public'), { index: false }));
app.get('/pay', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'pay.html')));
app.get('/success', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'success.html')));
app.get('/reset', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'reset.html')));
app.get('/download', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'downloads.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'dashboard.html')));
app.get('/about', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'about.html')));
app.get('/', (req, res) => res.sendFile(path.join(config.projectRoot, 'public', 'index.html')));

// Servir el dashboard HTML también en la raíz y en la carpeta public
app.use(express.static(path.join(config.projectRoot, 'public')));

// Dashboard web - servido desde el mismo puerto 3000
const dashboardRoot = path.join(config.projectRoot, '..', 'centinela_dashboard', 'build', 'web');
const fs = require('fs');
if (fs.existsSync(dashboardRoot)) {
  app.use(express.static(dashboardRoot));
  // SPA fallback: cualquier ruta no-API devuelve index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/public')) return next();
    const indexPath = path.join(dashboardRoot, 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    next();
  });
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
