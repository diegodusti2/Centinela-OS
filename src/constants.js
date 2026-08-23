const PLANS = Object.freeze({
  1: { months: 1, price: 3 },
  6: { months: 6, price: 15 },
  12: { months: 12, price: 24 },
});

// Only owner-approved recovery actions are exposed. Capture or surveillance
// commands are deliberately not part of the protocol.
const SAFE_COMMANDS = Object.freeze(['loc', 'tra', 'son', 'sil', 'par', 'es', 'lock', 'activate', 'profile', 'foto', 'video']);
const BLOCKED_COMMANDS = Object.freeze(['pantalla', 'audio']);

module.exports = { PLANS, SAFE_COMMANDS, BLOCKED_COMMANDS };
