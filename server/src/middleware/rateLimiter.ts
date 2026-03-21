import rateLimit from "express-rate-limit";
import type { Request } from "express";

function getUserKey(req: Request): string {
  if (req.session?.userId) {
    return `user:${req.session.userId}`;
  }
  // Fall back to IP for unauthenticated requests so they aren't all in one bucket
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `ip:${ip}`;
}

export const syncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  keyGenerator: getUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  message: { message: "Too many syncs — please wait 5 minutes before trying again" },
});

export const scanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  keyGenerator: getUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  message: { message: "Too many branch scans — please wait 10 minutes before trying again" },
});

export const analyzeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: getUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  message: { message: "Too many analysis requests — please wait 1 hour before trying again" },
});
