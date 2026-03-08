import db from "./schema";

export interface User {
  id: number;
  github_id: string;
  username: string;
  avatar_url: string | null;
  access_token: string;
  created_at: string;
  updated_at: string;
}

const upsertStmt = db.prepare(`
  INSERT INTO users (github_id, username, avatar_url, access_token)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(github_id) DO UPDATE SET
    username = excluded.username,
    avatar_url = excluded.avatar_url,
    access_token = excluded.access_token,
    updated_at = CURRENT_TIMESTAMP
  RETURNING *
`);

const findByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);

export function upsertUser(
  githubId: string,
  username: string,
  avatarUrl: string | null,
  accessToken: string,
): User {
  return upsertStmt.get(githubId, username, avatarUrl, accessToken) as User;
}

export function findUserById(id: number): User | undefined {
  return findByIdStmt.get(id) as User | undefined;
}
