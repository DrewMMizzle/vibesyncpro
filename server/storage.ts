import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  users,
  projects,
  platformConnections,
  type Project,
  type User,
  type PlatformConnection,
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
}

export const storage = new DatabaseStorage();
