import { db } from "./db";
import { eq, and, notInArray, desc } from "drizzle-orm";
import {
  users,
  projects,
  platformConnections,
  discoveredBranches,
  activityLog,
  type Project,
  type User,
  type PlatformConnection,
  type DiscoveredBranch,
  type ActivityLogEntry,
} from "@shared/schema";

export interface IStorage {
  upsertUser(githubId: string, username: string, avatarUrl: string | null, accessToken: string): Promise<User>;
  findUserById(id: number): Promise<User | undefined>;
  createProject(userId: number, name: string, description: string | null): Promise<Project>;
  getProjectsByUser(userId: number): Promise<Project[]>;
  getProjectById(projectId: number): Promise<Project | undefined>;
  getConnectionsByProject(projectId: number): Promise<PlatformConnection[]>;
  getConnectionById(connectionId: number): Promise<PlatformConnection | undefined>;
  createConnection(projectId: number, platform: string, branchName: string | null): Promise<PlatformConnection>;
  updateConnection(connectionId: number, fields: { status?: string; branch_name?: string | null; last_synced_at?: Date | null; ahead_by?: number; behind_by?: number }): Promise<PlatformConnection | undefined>;
  deleteConnection(connectionId: number): Promise<void>;
  updateProject(projectId: number, fields: { github_repo_url?: string | null; github_repo_name?: string | null; name?: string; description?: string | null }): Promise<Project | undefined>;
  upsertDiscoveredBranch(projectId: number, branchName: string, fields: { likely_platform?: string | null; ahead_by_default?: number; behind_by_default?: number; ahead_by_parent?: number; behind_by_parent?: number; last_commit_sha?: string | null; last_commit_at?: Date | null; dismissed_at?: Date | null; last_seen_at?: Date }): Promise<DiscoveredBranch>;
  getDiscoveredBranches(projectId: number): Promise<DiscoveredBranch[]>;
  getDiscoveredBranchByName(projectId: number, branchName: string): Promise<DiscoveredBranch | undefined>;
  dismissDiscoveredBranch(id: number, lastCommitSha: string | null): Promise<void>;
  deleteDiscoveredBranch(id: number): Promise<void>;
  deleteStaleDiscoveredBranches(projectId: number, activeBranchNames: string[]): Promise<void>;
  clearAllDiscoveredBranches(projectId: number): Promise<void>;
  deleteProject(projectId: number): Promise<void>;
  addActivityLog(projectId: number, eventType: string, description: string, metadata?: Record<string, unknown>): Promise<ActivityLogEntry>;
  getActivityLog(projectId: number, limit?: number): Promise<ActivityLogEntry[]>;
}

export class DatabaseStorage implements IStorage {
  async upsertUser(githubId: string, username: string, avatarUrl: string | null, accessToken: string): Promise<User> {
    const existing = await db.select().from(users).where(eq(users.github_id, githubId)).limit(1);
    if (existing.length > 0) {
      const [updated] = await db
        .update(users)
        .set({ username, avatar_url: avatarUrl, access_token: accessToken, updated_at: new Date() })
        .where(eq(users.github_id, githubId))
        .returning();
      return updated;
    }
    const [user] = await db
      .insert(users)
      .values({ github_id: githubId, username, avatar_url: avatarUrl, access_token: accessToken })
      .returning();
    return user;
  }

  async findUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  async createProject(userId: number, name: string, description: string | null): Promise<Project> {
    const [project] = await db
      .insert(projects)
      .values({ user_id: userId, name, description })
      .returning();
    return project;
  }

  async getProjectsByUser(userId: number): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.user_id, userId));
  }

  async getProjectById(projectId: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    return project;
  }

  async getConnectionsByProject(projectId: number): Promise<PlatformConnection[]> {
    return db.select().from(platformConnections).where(eq(platformConnections.project_id, projectId));
  }

  async getConnectionById(connectionId: number): Promise<PlatformConnection | undefined> {
    const [conn] = await db.select().from(platformConnections).where(eq(platformConnections.id, connectionId)).limit(1);
    return conn;
  }

  async createConnection(projectId: number, platform: string, branchName: string | null): Promise<PlatformConnection> {
    const [conn] = await db
      .insert(platformConnections)
      .values({ project_id: projectId, platform, branch_name: branchName, status: "disconnected" })
      .returning();
    return conn;
  }

  async updateConnection(connectionId: number, fields: { status?: string; branch_name?: string | null; last_synced_at?: Date | null; ahead_by?: number; behind_by?: number }): Promise<PlatformConnection | undefined> {
    const [conn] = await db
      .update(platformConnections)
      .set({ ...fields, updated_at: new Date() })
      .where(eq(platformConnections.id, connectionId))
      .returning();
    return conn;
  }

  async deleteConnection(connectionId: number): Promise<void> {
    await db.delete(platformConnections).where(eq(platformConnections.id, connectionId));
  }

  async updateProject(projectId: number, fields: { github_repo_url?: string | null; github_repo_name?: string | null; name?: string; description?: string | null }): Promise<Project | undefined> {
    const [project] = await db
      .update(projects)
      .set({ ...fields, updated_at: new Date() })
      .where(eq(projects.id, projectId))
      .returning();
    return project;
  }
  async upsertDiscoveredBranch(projectId: number, branchName: string, fields: { likely_platform?: string | null; ahead_by_default?: number; behind_by_default?: number; ahead_by_parent?: number; behind_by_parent?: number; last_commit_sha?: string | null; last_commit_at?: Date | null; dismissed_at?: Date | null; last_seen_at?: Date }): Promise<DiscoveredBranch> {
    const [result] = await db.insert(discoveredBranches)
      .values({ project_id: projectId, branch_name: branchName, ...fields })
      .onConflictDoUpdate({
        target: [discoveredBranches.project_id, discoveredBranches.branch_name],
        set: { ...fields, updated_at: new Date() },
      })
      .returning();
    return result;
  }

  async getDiscoveredBranches(projectId: number): Promise<DiscoveredBranch[]> {
    return db.select().from(discoveredBranches).where(eq(discoveredBranches.project_id, projectId));
  }

  async getDiscoveredBranchByName(projectId: number, branchName: string): Promise<DiscoveredBranch | undefined> {
    const [branch] = await db.select().from(discoveredBranches)
      .where(and(eq(discoveredBranches.project_id, projectId), eq(discoveredBranches.branch_name, branchName)))
      .limit(1);
    return branch;
  }

  async dismissDiscoveredBranch(id: number, lastCommitSha: string | null): Promise<void> {
    await db.update(discoveredBranches)
      .set({ dismissed_at: new Date(), last_commit_sha: lastCommitSha, updated_at: new Date() })
      .where(eq(discoveredBranches.id, id));
  }

  async deleteDiscoveredBranch(id: number): Promise<void> {
    await db.delete(discoveredBranches).where(eq(discoveredBranches.id, id));
  }

  async deleteStaleDiscoveredBranches(projectId: number, activeBranchNames: string[]): Promise<void> {
    if (activeBranchNames.length === 0) {
      console.warn(`deleteStaleDiscoveredBranches called with empty activeBranchNames for project ${projectId} — skipping to prevent accidental deletion of all branches`);
      return;
    }
    await db.delete(discoveredBranches)
      .where(and(
        eq(discoveredBranches.project_id, projectId),
        notInArray(discoveredBranches.branch_name, activeBranchNames)
      ));
  }

  async clearAllDiscoveredBranches(projectId: number): Promise<void> {
    await db.delete(discoveredBranches).where(eq(discoveredBranches.project_id, projectId));
  }

  async deleteProject(projectId: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(activityLog).where(eq(activityLog.project_id, projectId));
      await tx.delete(discoveredBranches).where(eq(discoveredBranches.project_id, projectId));
      await tx.delete(platformConnections).where(eq(platformConnections.project_id, projectId));
      await tx.delete(projects).where(eq(projects.id, projectId));
    });
  }

  async addActivityLog(projectId: number, eventType: string, description: string, metadata?: Record<string, unknown>): Promise<ActivityLogEntry> {
    const [entry] = await db.insert(activityLog)
      .values({ project_id: projectId, event_type: eventType, description, metadata: metadata ?? null })
      .returning();
    return entry;
  }

  async getActivityLog(projectId: number, limit = 50): Promise<ActivityLogEntry[]> {
    return db.select().from(activityLog)
      .where(eq(activityLog.project_id, projectId))
      .orderBy(desc(activityLog.created_at))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
