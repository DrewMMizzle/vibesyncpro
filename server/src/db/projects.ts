import db from "./schema";

export interface Project {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  github_repo_url: string | null;
  github_repo_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformConnection {
  id: number;
  project_id: number;
  platform: string;
  branch_name: string | null;
  status: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

const insertProjectStmt = db.prepare(`
  INSERT INTO projects (user_id, name, description)
  VALUES (?, ?, ?)
  RETURNING *
`);

const findProjectsByUserStmt = db.prepare(`
  SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC
`);

const findProjectByIdStmt = db.prepare(`
  SELECT * FROM projects WHERE id = ?
`);

const findConnectionsByProjectStmt = db.prepare(`
  SELECT * FROM platform_connections WHERE project_id = ?
`);

export function createProject(userId: number, name: string, description: string | null): Project {
  return insertProjectStmt.get(userId, name, description) as Project;
}

export function getProjectsByUser(userId: number): Project[] {
  return findProjectsByUserStmt.all(userId) as Project[];
}

export function getProjectById(projectId: number): Project | undefined {
  return findProjectByIdStmt.get(projectId) as Project | undefined;
}

export function getConnectionsByProject(projectId: number): PlatformConnection[] {
  return findConnectionsByProjectStmt.all(projectId) as PlatformConnection[];
}
