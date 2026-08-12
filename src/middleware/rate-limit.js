function rateLimit({ windowMs = 60_000, max = 60, message = 'Demasiadas solicitudes' } = {}) {
  const buckets = new Map();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (now - entry.startedAt >= windowMs) buckets.delete(key);
    }
  }, Math.max(windowMs, 60_000)).unref();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      res.set('Retry-After', String(Math.ceil((windowMs - (now - current.startedAt)) / 1000)));
      return res.status(429).json({ error: message, code: 'rate_limited' });
    }
    return next();
  };
}

module.exports = rateLimit;
