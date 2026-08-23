const { Server } = require('ws');
const db = require('./db');
const { hashDeviceToken } = require('./utils/token');
const { SAFE_COMMANDS } = require('./constants');

let wss = null;
const sockets = new Map();

function init(httpServer) {
  wss = new Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    let deviceId = null;
    let authed = false;
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      handleMessage(ws, raw, () => deviceId, (v) => { deviceId = v; }, (v) => { authed = v; }, () => authed)
        .catch(() => {});
    });

    ws.on('close', () => {
      if (deviceId) {
        sockets.delete(deviceId);
        db.run("UPDATE devices SET online = 0, last_seen = NOW() WHERE id = $1", [deviceId])
          .then(() => console.log(`[WS] Device ${deviceId.slice(0, 12)}... disconnected`))
          .catch(() => {});
      }
    });

    ws.on('error', () => {});
  });

  // Ping/pong para mantener vivas las conexiones
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);
  wss.on('close', () => clearInterval(interval));

  return wss;
}

async function handleMessage(ws, raw, getDeviceId, setDeviceId, setAuthed, isAuthed) {
  try {
    const msg = JSON.parse(raw.toString());
    const { event, data } = msg;

    if (event === 'auth') {
      const token = (data?.token || '').trim();
      if (!token) { send(ws, 'error', { msg: 'Token requerido' }); ws.close(); return; }
      const device = await db.get('SELECT * FROM devices WHERE device_token_hash = $1', [hashDeviceToken(token)]);
      if (!device) { send(ws, 'error', { msg: 'Token invalido' }); ws.close(); return; }
      setDeviceId(device.id);
      setAuthed(true);
      sockets.set(device.id, ws);
      send(ws, 'authed', { deviceId: device.id });
      console.log(`[WS] Device ${device.id.slice(0, 12)}... connected`);
      await db.run("UPDATE devices SET online = 1, last_seen = NOW() WHERE id = $1", [device.id]);
      return;
    }

    if (!isAuthed()) { send(ws, 'error', { msg: 'No autenticado' }); return; }

    if (event === 'cmd_result') {
      const deviceId = getDeviceId();
      const status = data?.status || (data?.result?.startsWith('OK') ? 'executed' : 'failed');
      await db.run("UPDATE commands SET status = $1, result = $2, executed_at = NOW() WHERE id = $3 AND device_id = $4 AND status IN ('pending','sent')",
        [status, data?.result || '', data?.cmdId, deviceId]);
      broadcast('cmd_update', { deviceId, cmdId: data?.cmdId, status, result: data?.result });
    }
  } catch (_) {}
}

function send(ws, event, data) {
  try { ws.send(JSON.stringify({ event, data })); } catch (_) {}
}

function broadcast(event, data) {
  const payload = JSON.stringify({ event, data });
  wss?.clients.forEach((ws) => { try { ws.send(payload); } catch (_) {} });
}

function sendCommand(deviceId, command) {
  const ws = sockets.get(deviceId);
  if (!ws) return false;
  send(ws, 'cmd', {
    id: command.id,
    type: command.command_type || command.command,
    params: typeof command.params === 'string' ? JSON.parse(command.params || '{}') : (command.params || {}),
  });
  db.run("UPDATE commands SET status = 'sent' WHERE id = $1", [command.id]).catch(() => {});
  return true;
}

module.exports = { init, sendCommand };
