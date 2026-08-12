const PLANS = Object.freeze({
  1: { months: 1, price: 3 },
  6: { months: 6, price: 15 },
  12: { months: 12, price: 24 },
});

const EVENT_TYPES = Object.freeze([
  'ANTI_SIM',
  'INTRUDER',
  'MOTION',
  'BATTERY_LOW',
  'STATUS',
  'TEST',
]);

// Only owner-approved recovery actions are exposed. Capture or surveillance
// commands are deliberately not part of the protocol.
const SAFE_COMMANDS = Object.freeze(['loc', 'tra', 'son', 'sil', 'par', 'es', 'lock', 'activate', 'profile', 'foto', 'video']);
const BLOCKED_COMMANDS = Object.freeze(['pantalla', 'audio']);

module.exports = { PLANS, EVENT_TYPES, SAFE_COMMANDS, BLOCKED_COMMANDS };
