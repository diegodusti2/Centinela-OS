function notFound(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada', code: 'not_found' });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error('[500]', error.message, error.stack);
  res.status(status).json({
    error: status >= 500 ? 'Error interno del servidor' : error.message,
    code: error.code || 'internal_error',
    details: error.message,
    ...(error.details ? { details: error.details } : {}),
  });
}

module.exports = { notFound, errorHandler };
