// Initialize the database (creates tables on import)
import "./db/schema";

export { sessionMiddleware } from "./middleware/session";
export { requireAuth } from "./middleware/requireAuth";
export { default as authRouter } from "./routes/auth";
export { default as usersRouter } from "./routes/users";
export { default as projectsRouter } from "./routes/projects";
