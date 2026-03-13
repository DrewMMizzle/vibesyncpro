import { pgTable, text, serial, integer, timestamp, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  github_id: text("github_id").unique().notNull(),
  username: text("username").notNull(),
  avatar_url: text("avatar_url"),
  access_token: text("access_token").notNull(),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  github_repo_url: text("github_repo_url"),
  github_repo_name: text("github_repo_name"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

export const platformConnections = pgTable("platform_connections", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull().references(() => projects.id),
  platform: text("platform").notNull(),
  branch_name: text("branch_name"),
  status: text("status").notNull().default("disconnected"),
  ahead_by: integer("ahead_by").default(0),
  behind_by: integer("behind_by").default(0),
  last_synced_at: timestamp("last_synced_at"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

export const discoveredBranches = pgTable("discovered_branches", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull().references(() => projects.id),
  branch_name: text("branch_name").notNull(),
  likely_platform: text("likely_platform"),
  ahead_by_default: integer("ahead_by_default").default(0),
  behind_by_default: integer("behind_by_default").default(0),
  ahead_by_parent: integer("ahead_by_parent").default(0),
  behind_by_parent: integer("behind_by_parent").default(0),
  last_commit_sha: text("last_commit_sha"),
  last_commit_at: timestamp("last_commit_at"),
  dismissed_at: timestamp("dismissed_at"),
  last_seen_at: timestamp("last_seen_at").defaultNow(),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("discovered_branches_project_branch_idx").on(table.project_id, table.branch_name),
]);

export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  project_id: integer("project_id").notNull().references(() => projects.id),
  event_type: text("event_type").notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const insertPlatformConnectionSchema = createInsertSchema(platformConnections).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;
export const insertDiscoveredBranchSchema = createInsertSchema(discoveredBranches).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type InsertPlatformConnection = z.infer<typeof insertPlatformConnectionSchema>;
export type PlatformConnection = typeof platformConnections.$inferSelect;
export type InsertDiscoveredBranch = z.infer<typeof insertDiscoveredBranchSchema>;
export type DiscoveredBranch = typeof discoveredBranches.$inferSelect;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
