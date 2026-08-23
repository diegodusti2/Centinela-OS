const db = require('../db');
const { HttpError } = require('../utils/http');
const { getDeviceOrThrow } = require('./device-controller');

async function generateReport(req, res) {
  const deviceId = req.params.deviceId;
  const device = await getDeviceOrThrow(deviceId);
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const locations = await db.all('SELECT * FROM locations WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 200', [deviceId]);
  const events = await db.all('SELECT * FROM events WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 100', [deviceId]);
  const photos = await db.all("SELECT * FROM events WHERE device_id = $1 AND event_type = 'INTRUDER' AND image_url IS NOT NULL ORDER BY timestamp DESC LIMIT 50", [deviceId]);
  const commands = await db.all('SELECT * FROM commands WHERE device_id = $1 ORDER BY created_at DESC LIMIT 50', [deviceId]);
  const licenses = await db.all('SELECT * FROM licenses WHERE device_id = $1 ORDER BY created_at DESC', [deviceId]);

  const fmt = (ts, lon) => {
    if (!ts) return '-';
    try {
      const ms = db.toMs(ts);
      const d = new Date(ms);
      // Hora local del lugar del hecho: 1 huso (60 min) cada 15 grados de longitud
      const offMin = lon == null || isNaN(lon) ? 0 : Math.round(lon / 15) * 60;
      return new Date(d.getTime() + offMin * 60000).toLocaleString('es', { hour12: false });
    } catch (_) { return String(ts); }
  };

  const evtLabel = (t) => {
    const m = { ANTI_SIM: 'SIM Extraida', INTRUDER: 'Intruso', MOTION: 'Movimiento', BATTERY_LOW: 'Bateria Baja', STATUS: 'Estado' };
    return m[t] || t || 'Evento';
  };

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Centinela OS - Informe</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;background:#0b1120;color:#e2e8f0;padding:40px;line-height:1.5}
.header{text-align:center;margin-bottom:36px;padding-bottom:24px;border-bottom:1px solid #1e293b}
.header h1{color:#3b82f6;letter-spacing:4px;font-size:20px;font-weight:700;text-transform:uppercase}
.header p{color:#94a3b8;font-size:11px;margin-top:6px;letter-spacing:1px}
.card{background:#111827;border:1px solid #1e293b;border-radius:10px;padding:24px;margin-bottom:14px}
.card h3{color:#3b82f6;font-size:13px;font-weight:600;margin-bottom:14px;text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;border-bottom:1px solid #1e293b}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #1e293b;font-size:11px;line-height:1.4}
th{color:#64748b;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.5px;background:#0f172a}
td{color:#cbd5e1;font-size:11px}
tr:hover td{background:rgba(59,130,246,.04)}
.sub{color:#64748b;font-size:11px;padding:12px 0}
.info-row{display:flex;gap:32px;flex-wrap:wrap;margin-bottom:8px}
.info-item{min-width:140px}
.info-item label{display:block;font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;font-weight:500}
.info-item span{font-size:13px;font-weight:500;color:#e2e8f0}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:.3px}
.badge-green{background:#064e3b;color:#10b981}
.badge-red{background:#7f1d1d;color:#ef4444}
.badge-blue{background:#1e3a5f;color:#60a5fa}
a{color:#3b82f6;text-decoration:none;font-size:10px;font-weight:500}
a:hover{text-decoration:underline}
.footer{text-align:center;color:#475569;font-size:10px;margin-top:36px;padding-top:20px;border-top:1px solid #1e293b;letter-spacing:.5px}
@media print{body{background:#fff;color:#111;padding:20px}.card{background:#fff;border:1px solid #e5e7eb;box-shadow:none}.card h3{color:#1e40af;border-bottom-color:#e5e7eb}th{background:#f3f4f6;color:#374151}td{color:#1f2937}.header{border-bottom-color:#e5e7eb}.header h1{color:#1e40af}.footer{border-top-color:#e5e7eb;color:#6b7280}}
</style>
</head>
<body>
<div class="header">
<h1>CENTINELA OS</h1>
<p>Informe detallado del dispositivo</p>
</div>

<div class="card">
<h3>Dispositivo</h3>
<div class="info-row">
<div class="info-item"><label>Nombre</label><span>${device.name || '-'}</span></div>
<div class="info-item"><label>Modelo</label><span>${device.model || '-'}</span></div>
<div class="info-item"><label>Android</label><span>${device.android_version || '-'}</span></div>
<div class="info-item"><label>Bateria</label><span>${device.battery_level ?? '-'}%</span></div>
</div>
<div class="info-row">
<div class="info-item"><label>Estado</label><span class="badge ${device.online ? 'badge-green' : 'badge-red'}">${device.online ? 'ONLINE' : 'OFFLINE'}</span></div>
<div class="info-item"><label>Escudo</label><span>${device.shield_armed ? 'Armado' : 'Desarmado'}</span></div>
<div class="info-item"><label>Ultima vez visto</label><span>${fmt(device.last_seen, device.last_lng)}</span></div>
</div>
${device.last_lat ? `<div class="info-row"><div class="info-item"><label>Ubicacion</label><span>${Number(device.last_lat).toFixed(6)}, ${Number(device.last_lng).toFixed(6)} <a href="https://www.google.com/maps?q=${device.last_lat},${device.last_lng}" target="_blank" style="color:#3b82f6;font-size:11px">[Ver mapa]</a></span></div></div>` : ''}
</div>

<div class="card">
<h3>Licencias (${licenses.length})</h3>
${licenses.length ? `<table><tr><th>Codigo</th><th>Estado</th><th>Duracion</th><th>Precio</th><th>Expira</th></tr>${licenses.map(l => `<tr><td style="font-family:monospace">${l.code}</td><td><span class="badge ${l.status === 'active' ? 'badge-green' : 'badge-red'}">${l.status}</span></td><td>${l.duration_months}m</td><td>$${l.price}</td><td>${fmt(l.expires_at, device.last_lng)}</td></tr>`).join('')}</table>` : '<p class="sub">Sin licencias</p>'}
</div>

<div class="card">
<h3>Eventos Recientes (${events.length})</h3>
${events.length ? `<table><tr><th>Tipo</th><th>Descripcion</th><th>Ubicacion</th><th>Mapa</th><th>Fecha</th></tr>${events.slice(0, 50).map(e => `<tr><td><span class="badge badge-blue">${evtLabel(e.event_type || e.type)}</span></td><td>${e.description || '-'}</td><td>${e.latitude ? Number(e.latitude).toFixed(6)+', '+Number(e.longitude).toFixed(6) : '-'}</td><td>${e.latitude ? '<a href="https://www.google.com/maps?q='+e.latitude+','+e.longitude+'" target="_blank" style="color:#3b82f6;text-decoration:none;font-size:10px">Ver en Mapa</a>' : '-'}</td><td>${fmt(e.timestamp, e.longitude)}</td></tr>`).join('')}</table>` : '<p class="sub">Sin eventos</p>'}
</div>

<div class="card">
<h3>Itinerario GPS (${locations.length})</h3>
${locations.length ? `<table><tr><th>Evento</th><th>Latitud</th><th>Longitud</th><th>Bateria</th><th>Mapa</th><th>Fecha</th></tr>${locations.slice(0, 100).map(l => `<tr><td>${l.event || 'GPS'}</td><td>${Number(l.latitude).toFixed(6)}</td><td>${Number(l.longitude).toFixed(6)}</td><td>${l.battery_level ?? '-'}%</td><td><a href="https://www.google.com/maps?q=${l.latitude},${l.longitude}" target="_blank" style="color:#3b82f6;text-decoration:none;font-size:10px">Ver en Mapa</a></td><td>${fmt(l.timestamp, l.longitude)}</td></tr>`).join('')}</table>` : '<p class="sub">Sin registros</p>'}
</div>

<div class="card">
<h3>Fotos de Intruso (${photos.length})</h3>
${photos.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${photos.map(p => `<div style="text-align:center"><img src="${baseUrl}${p.image_url}" style="width:120px;height:160px;object-fit:cover;border-radius:6px;border:1px solid #1e293b" loading="lazy"><div style="font-size:9px;color:#94a3b8;margin-top:4px">${fmt(p.timestamp, p.longitude)}</div></div>`).join('')}</div>` : '<p class="sub">Sin fotos</p>'}
</div>

<div class="card">
<h3>Comandos (${commands.length})</h3>
${commands.length ? `<table><tr><th>Tipo</th><th>Estado</th><th>Resultado</th><th>Creado</th></tr>${commands.slice(0, 30).map(c => `<tr><td>${c.command_type || '-'}</td><td><span class="badge ${c.status === 'executed' ? 'badge-green' : c.status === 'failed' ? 'badge-red' : 'badge-blue'}">${c.status}</span></td><td style="font-size:10px">${c.result || '-'}</td><td>${fmt(c.created_at, device.last_lng)}</td></tr>`).join('')}</table>` : '<p class="sub">Sin comandos</p>'}
</div>

<div class="footer">
<p>Generado por Centinela OS v3.0 &middot; ${fmt(new Date().toISOString(), device.last_lng)}</p>
</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="centinela_informe_${deviceId.slice(0, 12)}.html"`);
  return res.send(html);
}

module.exports = { generateReport };
