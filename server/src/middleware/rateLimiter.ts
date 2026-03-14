import rateLimit from "express-rate-limit";
import type { Request } from "express";

function getUserKey(req: Request): string {
  return String(req.session?.userId ?? "anon");
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
