import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  users,
  projects,
  platformConnections,
  type InsertProject,
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
}

export const storage = new DatabaseStorage();
