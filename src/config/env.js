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

const publicDashboardUrl = (process.env.PUBLIC_DASHBOARD_URL || process.env.RENDER_EXTERNAL_URL || 'http://192.168.0.15:3000')
  .trim()
  .replace(/\/$/, '');
const corsOrigins = Array.from(new Set([
  ...(process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
  publicDashboardUrl,
]));

// TEMPORAL: valor por defecto para poder desplegar sin configurar DATABASE_URL
// en el dashboard de Render. Se usa SOLO si no hay variable de entorno.
// Rota la contraseña de Neon y mueve esto a Environment cuando sea posible.
const FALLBACK_DATABASE_URL = 'postgresql://neondb_owner:npg_CHDfFET2oBg7@ep-dawn-smoke-ax52z8ln-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

module.exports = Object.freeze({
  projectRoot,
  nodeEnv,
  isProduction,
  port: Number.parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  // URL de PostgreSQL (Neon). Requerida en produccion.
  databaseUrl: (process.env.DATABASE_URL || FALLBACK_DATABASE_URL).trim(),
  jwtSecret,
  jwtTtlSeconds: Number.parseInt(process.env.JWT_TTL_SECONDS || '28800', 10),
  adminUser: (process.env.ADMIN_USER || 'admin').trim(),
  adminPassword: process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || (isProduction ? '' : 'change-me-now'),
  corsOrigins,
  publicDashboardUrl,
  demoPayments: asBoolean(process.env.DEMO_PAYMENTS),
  allowLegacyBasic: asBoolean(process.env.ALLOW_LEGACY_BASIC),
  maxPageSize: Math.min(Math.max(Number.parseInt(process.env.MAX_PAGE_SIZE || '200', 10), 10), 500),
});
