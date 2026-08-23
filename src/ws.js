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
      try {
        const msg = JSON.parse(raw.toString());
        const { event, data } = msg;

        if (event === 'auth') {
          const token = (data?.token || '').trim();
          if (!token) { send(ws, 'error', { msg: 'Token requerido' }); ws.close(); return; }
          const device = db.prepare('SELECT * FROM devices WHERE device_token_hash = ?').get(hashDeviceToken(token));
          if (!device) { send(ws, 'error', { msg: 'Token invalido' }); ws.close(); return; }
          deviceId = device.id;
          authed = true;
          sockets.set(deviceId, ws);
          send(ws, 'authed', { deviceId });
          console.log(`[WS] Device ${deviceId.slice(0, 12)}... connected`);
          db.prepare("UPDATE devices SET online = 1, last_seen = datetime('now') WHERE id = ?").run(deviceId);
          return;
        }

        if (!authed) { send(ws, 'error', { msg: 'No autenticado' }); return; }

        if (event === 'cmd_result') {
          const status = data?.status || (data?.result?.startsWith('OK') ? 'executed' : 'failed');
          db.prepare("UPDATE commands SET status = ?, result = ?, executed_at = datetime('now') WHERE id = ? AND device_id = ? AND status IN ('pending','sent')")
            .run(status, data?.result || '', data?.cmdId, deviceId);
          broadcast('cmd_update', { deviceId, cmdId: data?.cmdId, status, result: data?.result });
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      if (deviceId) {
        sockets.delete(deviceId);
        db.prepare("UPDATE devices SET online = 0, last_seen = datetime('now') WHERE id = ?").run(deviceId);
        console.log(`[WS] Device ${deviceId.slice(0, 12)}... disconnected`);
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
  db.prepare("UPDATE commands SET status = 'sent' WHERE id = ?").run(command.id);
  return true;
}

module.exports = { init, sendCommand };
