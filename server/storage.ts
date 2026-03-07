import { db } from "./db";
import {
  projects,
  type InsertProject,
  type Project
} from "@shared/schema";

export interface IStorage {
  createProject(project: InsertProject): Promise<Project>;
}

export class DatabaseStorage implements IStorage {
  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values(insertProject).returning();
    return project;
  }
}

export const storage = new DatabaseStorage();
