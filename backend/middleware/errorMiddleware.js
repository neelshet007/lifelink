/**
 * ============================================================
 * FILE: backend/middleware/errorMiddleware.js
 * ROLE: Centralized Express error handler
 * ============================================================
 *
 * DATA FLOW OVERVIEW
 * ------------------
 * This is registered as the LAST middleware in server.js:
 *   app.use(errorHandler)
 *
 * Express identifies it as an error handler because it has 4 parameters
 * (err, req, res, next). When any controller or middleware calls next(err)
 * or throws an unhandled error inside an async route that uses express-async-errors,
 * Express skips all remaining normal middleware and jumps directly here.
 *
 * WHY this design?
 * ----------------
 * Without centralised error handling every controller would need its own
 * try/catch → res.status(500).json(...). By funnelling all errors through
 * this handler we get consistent JSON error shapes, log in one place, and
 * hide stack traces in production automatically.
 *
 * statusCode logic:
 *   - If a controller called res.status(4xx) before calling next(err),
 *     we preserve that status code.
 *   - If Express defaulted res.statusCode to 200 (meaning no status was
 *     explicitly set before the error), we override it to 500.
 */

const errorHandler = (err, req, res, next) => {
  // Preserve controller-set status or fall back to 500 Internal Server Error
  const statusCode = res.statusCode === 200 ? 500 : (res.statusCode || 500);
  res.status(statusCode);

  res.json({
    message: err.message,
    // Stack trace is only included in development so sensitive file paths
    // are never exposed to end users in production.
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};

module.exports = { errorHandler };
