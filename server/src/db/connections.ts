import db from "./schema";
import type { PlatformConnection } from "./projects";

const insertConnectionStmt = db.prepare(`
  INSERT INTO platform_connections (project_id, platform, branch_name, status)
  VALUES (?, ?, ?, ?)
  RETURNING *
`);

const updateStatusStmt = db.prepare(`
  UPDATE platform_connections
  SET status = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
  RETURNING *
`);

export function createConnection(
  projectId: number,
  platform: string,
  branchName: string | null = null,
  status: string = "disconnected",
): PlatformConnection {
  return insertConnectionStmt.get(projectId, platform, branchName, status) as PlatformConnection;
}

export function updateConnectionStatus(
  id: number,
  status: string,
): PlatformConnection | undefined {
  return updateStatusStmt.get(status, id) as PlatformConnection | undefined;
}
