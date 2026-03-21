import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { serveStatic } from "./static";
import { createServer } from "http";
import { sessionMiddleware, authRouter, usersRouter, projectsRouter, githubRouter } from "./src/index";
import { migrateTokenEncryption } from "./src/utils/migrate-tokens";

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.error("FATAL: SESSION_SECRET environment variable is required in production. Exiting.");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  const ek = process.env.ENCRYPTION_KEY;
  if (!ek) {
    console.error("FATAL: ENCRYPTION_KEY environment variable is required in production. Exiting.");
    process.exit(1);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(ek)) {
    console.error("FATAL: ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Exiting.");
    process.exit(1);
  }
}

if (process.env.NODE_ENV === "production" && !process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not set. Repo analysis and Conflict Genius features will return 503.");
}

const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production",
  }),
);

const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req, res) => {
  return res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Session and auth
app.use(sessionMiddleware);
app.use("/auth", authRouter);
app.use("/api", usersRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/github", githubRouter);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const summary = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${summary.length > 200 ? summary.slice(0, 200) + "…" : summary}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await migrateTokenEncryption();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
