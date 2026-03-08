import type { Express } from "express";
import { type Server } from "http";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Project and user API routes are registered in server/index.ts
  // via projectsRouter (/api/projects) and usersRouter (/api)
  return httpServer;
}
