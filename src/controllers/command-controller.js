const db = require('../db');
const { HttpError } = require('../utils/http');
const { SAFE_COMMANDS, BLOCKED_COMMANDS } = require('../constants');
const { object, text, limit } = require('../utils/validation');
const { userOwnsDevice } = require('../middleware/auth');
const ws = require('../ws');

function commandView(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload || row.params || '{}'); } catch (_) { payload = {}; }
  return {
    id: row.id,
    deviceId: row.device_id,
    command: row.command_type || row.command,
    commandType: row.command_type || row.command,
    params: payload,
    payload,
    status: row.status,
    result: row.result,
    createdAt: row.created_at,
    executedAt: row.executed_at,
    expiresAt: row.expires_at,
  };
}

async function createCommand(req, res) {
  const deviceId = text(req.body.deviceId, 'deviceId', { max: 160 });
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && !(await userOwnsDevice(req.user, deviceId))) {
    throw new HttpError(403, 'No tienes acceso a este dispositivo', 'forbidden');
  }
  const command = text(req.body.command || req.body.commandType, 'command', { max: 30 }).toLowerCase();
  if (BLOCKED_COMMANDS.includes(command)) {
    throw new HttpError(422, 'Las capturas remotas no forman parte de Centinela OS por privacidad y consentimiento', 'command_not_available');
  }
  if (!SAFE_COMMANDS.includes(command)) throw new HttpError(400, 'Comando no permitido', 'validation_error');
  const payload = object(req.body.params || req.body.payload, 'params');
  const result = await db.run(`INSERT INTO commands (device_id, command_type, command, payload, params, requested_by, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '10 minutes') RETURNING id`,
    [deviceId, command, command, JSON.stringify(payload), JSON.stringify(payload), req.user.id]);
  const cmdId = Number(result.lastInsertRowid);
  const pushed = ws.sendCommand(deviceId, { id: cmdId, command_type: command, command, params: payload });
  return res.status(201).json({ success: true, commandId: cmdId, status: pushed ? 'sent' : 'pending', command, pushed });
}

async function listCommands(req, res) {
  const deviceId = req.params.deviceId;
  if (req.authType === 'device') {
    if (req.device.id !== deviceId) throw new HttpError(403, 'Dispositivo no autorizado', 'forbidden');
    await db.run("UPDATE commands SET status = 'failed', result = 'expired' WHERE device_id = $1 AND status = 'pending' AND expires_at < NOW()", [deviceId]);
    const pending = await db.all("SELECT * FROM commands WHERE device_id = $1 AND status = 'pending' ORDER BY id ASC LIMIT 20", [deviceId]);
    return res.json(pending.map(commandView));
  }
  if (!(await userOwnsDevice(req.user, deviceId))) throw new HttpError(403, 'No tienes acceso a este dispositivo', 'forbidden');
  const rows = await db.all('SELECT * FROM commands WHERE device_id = $1 ORDER BY id DESC LIMIT $2', [deviceId, limit(req.query.limit, 50)]);
  return res.json(rows.map(commandView));
}

async function completeCommand(req, res) {
  const deviceId = req.params.deviceId;
  if (req.device.id !== deviceId) throw new HttpError(403, 'Dispositivo no autorizado', 'forbidden');
  const commandId = Number(req.params.id);
  if (!Number.isInteger(commandId) || commandId < 1) throw new HttpError(400, 'commandId no valido', 'validation_error');
  const status = ['executed', 'failed'].includes(req.body.status) ? req.body.status : 'executed';
  const result = text(req.body.result, 'result', { required: false, max: 500 });
  const update = await db.run("UPDATE commands SET status = $1, result = $2, executed_at = NOW() WHERE id = $3 AND device_id = $4 AND status = 'pending'", [status, result || 'OK', commandId, deviceId]);
  if (!update.changes) throw new HttpError(404, 'Comando pendiente no encontrado', 'command_not_found');
  return res.json({ success: true, commandId, status });
}

module.exports = { createCommand, listCommands, completeCommand, commandView };
