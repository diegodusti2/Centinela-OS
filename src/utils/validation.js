const { HttpError } = require('./http');
const config = require('../config/env');

function text(value, field, { required = true, max = 160 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} es requerido`, 'validation_error');
    return '';
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} debe ser texto`, 'validation_error');
  const normalized = value.trim();
  if (!normalized && required) throw new HttpError(400, `${field} es requerido`, 'validation_error');
  if (normalized.length > max) throw new HttpError(400, `${field} es demasiado largo`, 'validation_error');
  return normalized;
}

function email(value) {
  const normalized = text(value, 'email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpError(400, 'email no es valido', 'validation_error');
  }
  return normalized;
}

function password(value) {
  const normalized = text(value, 'password', { max: 128 });
  if (normalized.length < 8) throw new HttpError(400, 'password debe tener al menos 8 caracteres', 'validation_error');
  return normalized;
}

function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, defaultValue } = {}) {
  if ((value === undefined || value === null || value === '') && defaultValue !== undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${field} no es valido`, 'validation_error');
  }
  return parsed;
}

function plan(value) {
  return integer(value, 'plan', { min: 1, max: 12 });
}

function limit(value, fallback = 50) {
  return integer(value, 'limit', { min: 1, max: config.maxPageSize, defaultValue: fallback });
}

function coordinate(value, field, min, max, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} es requerido`, 'validation_error');
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${field} esta fuera de rango`, 'validation_error');
  }
  return parsed;
}

function coordinates(latitude, longitude) {
  return {
    latitude: coordinate(latitude, 'latitude', -90, 90, true),
    longitude: coordinate(longitude, 'longitude', -180, 180, true),
  };
}

function object(value, field, maxBytes = 8192) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `${field} debe ser un objeto`, 'validation_error');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new HttpError(400, `${field} es demasiado grande`, 'validation_error');
  return value;
}

module.exports = { text, email, password, integer, plan, limit, coordinate, coordinates, object };
