const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const jwtSecret = process.env.JWT_SECRET || (isProduction ? '' : 'local-only-change-this-secret');

if (isProduction && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en produccion');
}

function asBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

const configuredDbPath = process.env.DB_PATH || './data/centinela.db';

module.exports = Object.freeze({
  projectRoot,
  nodeEnv,
  isProduction,
  port: Number.parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  dbPath: path.resolve(projectRoot, configuredDbPath),
  jwtSecret,
  jwtTtlSeconds: Number.parseInt(process.env.JWT_TTL_SECONDS || '28800', 10),
  adminUser: (process.env.ADMIN_USER || 'admin').trim(),
  adminPassword: process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || (isProduction ? '' : 'change-me-now'),
  corsOrigins: (() => {
    const origins = (process.env.CORS_ORIGINS || 'http://localhost:8080,http://127.0.0.1:8080,http://192.168.0.15:8080')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    const dashboardUrl = process.env.PUBLIC_DASHBOARD_URL || 'http://192.168.0.15:8080';
    if (!origins.includes(dashboardUrl)) origins.push(dashboardUrl);
    return origins;
  })(),
  publicDashboardUrl: process.env.PUBLIC_DASHBOARD_URL || 'http://192.168.0.15:8080',
  demoPayments: asBoolean(process.env.DEMO_PAYMENTS),
  allowLegacyBasic: asBoolean(process.env.ALLOW_LEGACY_BASIC),
  maxPageSize: Math.min(Math.max(Number.parseInt(process.env.MAX_PAGE_SIZE || '200', 10), 10), 500),
});
