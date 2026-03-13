import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { storage } from "../../storage";
import { githubFetch, getAccessToken } from "./github";
import type { Project, PlatformConnection } from "@shared/schema";

const router = Router();

const VALID_PLATFORMS = ["replit", "claude_code", "computer"] as const;

function formatProject(project: Project, connections: PlatformConnection[]) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    github_repo_url: project.github_repo_url,
    github_repo_name: project.github_repo_name,
    created_at: project.created_at,
    updated_at: project.updated_at,
    platform_connections: connections.map((c) => ({
      id: c.id,
      platform: c.platform,
      branch_name: c.branch_name,
      status: c.status,
      ahead_by: c.ahead_by ?? 0,
      behind_by: c.behind_by ?? 0,
      last_synced_at: c.last_synced_at,
    })),
  };
}

// GET /api/projects
router.get("/", requireAuth, async (req, res) => {
  const projects = await storage.getProjectsByUser(req.session.userId!);
  const result = await Promise.all(
    projects.map(async (project) => {
      const connections = await storage.getConnectionsByProject(project.id);
      return formatProject(project, connections);
    })
  );
  return res.json(result);
});

// POST /api/projects
router.post("/", requireAuth, async (req, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ message: "Project name is required" });
  }
  const project = await storage.createProject(req.session.userId!, name.trim(), description?.trim() || null);
  return res.status(201).json(formatProject(project, []));
});

// GET /api/projects/:id
router.get("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) return res.status(400).json({ message: "Invalid project ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  const connections = await storage.getConnectionsByProject(project.id);
  return res.json(formatProject(project, connections));
});

// PATCH /api/projects/:id — update project (link repo, etc.)
router.patch("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) return res.status(400).json({ message: "Invalid project ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  const bodySchema = z.object({
    github_repo_url: z.string().optional().nullable(),
    github_repo_name: z.string().optional().nullable(),
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid fields" });

  const updated = await storage.updateProject(projectId, parsed.data);
  if (!updated) return res.status(404).json({ message: "Project not found" });

  const connections = await storage.getConnectionsByProject(projectId);
  return res.json(formatProject(updated, connections));
});

// POST /api/projects/:id/sync — compare branches via GitHub API and update statuses
router.post("/:id/sync", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) return res.status(400).json({ message: "Invalid project ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  if (!project.github_repo_name || !project.github_repo_name.includes("/")) {
    return res.status(400).json({ message: "No GitHub repo linked to this project" });
  }

  let token: string;
  try {
    token = await getAccessToken(req.session.userId!);
  } catch {
    return res.status(401).json({ message: "GitHub access token not found. Please re-authenticate." });
  }

  const connections = await storage.getConnectionsByProject(projectId);
  const [owner, repo] = project.github_repo_name.split("/");

  let defaultBranch: string;
  try {
    const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`) as { default_branch: string };
    defaultBranch = repoInfo.default_branch;
  } catch {
    return res.status(502).json({ message: "Failed to fetch repository info from GitHub" });
  }

  const results: Array<{ id: number; platform: string; branch_name: string | null; status: string; last_synced_at: string | null; ahead_by?: number; behind_by?: number }> = [];
  const errors: Array<{ id: number; platform: string; error: string }> = [];

  for (const conn of connections) {
    if (!conn.branch_name) {
      await storage.updateConnection(conn.id, { status: "disconnected", last_synced_at: new Date() });
      results.push({ id: conn.id, platform: conn.platform, branch_name: conn.branch_name, status: "disconnected", last_synced_at: new Date().toISOString() });
      continue;
    }

    if (conn.branch_name === defaultBranch) {
      await storage.updateConnection(conn.id, { status: "synced", last_synced_at: new Date() });
      results.push({ id: conn.id, platform: conn.platform, branch_name: conn.branch_name, status: "synced", last_synced_at: new Date().toISOString() });
      continue;
    }

    try {
      const encodedBase = encodeURIComponent(defaultBranch);
      const encodedHead = encodeURIComponent(conn.branch_name);
      const comparison = await githubFetch(
        token,
        `/repos/${owner}/${repo}/compare/${encodedBase}...${encodedHead}`
      ) as { ahead_by: number; behind_by: number; status: string };

      let status: string;
      if (comparison.ahead_by === 0 && comparison.behind_by === 0) {
        status = "synced";
      } else if (comparison.ahead_by > 0 && comparison.behind_by > 0) {
        status = "conflict";
      } else {
        status = "drifted";
      }

      await storage.updateConnection(conn.id, { status, last_synced_at: new Date(), ahead_by: comparison.ahead_by, behind_by: comparison.behind_by });
      results.push({
        id: conn.id,
        platform: conn.platform,
        branch_name: conn.branch_name,
        status,
        last_synced_at: new Date().toISOString(),
        ahead_by: comparison.ahead_by,
        behind_by: comparison.behind_by,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error(`Sync error for connection ${conn.id}:`, errorMessage);
      errors.push({ id: conn.id, platform: conn.platform, error: errorMessage });
      results.push({ id: conn.id, platform: conn.platform, branch_name: conn.branch_name, status: conn.status, last_synced_at: conn.last_synced_at?.toISOString() ?? null });
    }
  }

  return res.json({ synced: errors.length === 0, errors, connections: results, default_branch: defaultBranch });
});

// POST /api/projects/:id/connections
router.post("/:id/connections", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) return res.status(400).json({ message: "Invalid project ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  const bodySchema = z.object({
    platform: z.enum(VALID_PLATFORMS),
    branch_name: z.string().optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid platform" });

  const { platform, branch_name } = parsed.data;

  if (project.github_repo_name && !branch_name) {
    return res.status(400).json({ message: "Branch name is required when a GitHub repo is linked" });
  }

  const existing = await storage.getConnectionsByProject(projectId);
  if (existing.some((c) => c.platform === platform)) {
    return res.status(409).json({ message: `A ${platform} connection already exists for this project` });
  }

  const conn = await storage.createConnection(projectId, platform, branch_name ?? null);
  return res.status(201).json({
    id: conn.id,
    platform: conn.platform,
    branch_name: conn.branch_name,
    status: conn.status,
    last_synced_at: conn.last_synced_at,
  });
});

// PATCH /api/projects/:id/connections/:connId
router.patch("/:id/connections/:connId", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  const connId = parseInt(req.params.connId as string, 10);
  if (isNaN(projectId) || isNaN(connId)) return res.status(400).json({ message: "Invalid ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  const conn = await storage.getConnectionById(connId);
  if (!conn || conn.project_id !== projectId) return res.status(404).json({ message: "Connection not found" });

  const bodySchema = z.object({
    branch_name: z.string().optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid fields" });

  const updated = await storage.updateConnection(connId, parsed.data);
  if (!updated) return res.status(404).json({ message: "Connection not found" });

  return res.json({
    id: updated.id,
    platform: updated.platform,
    branch_name: updated.branch_name,
    status: updated.status,
    last_synced_at: updated.last_synced_at,
  });
});

// POST /api/projects/:id/connections/:connId/resolve — merge branches via GitHub API
router.post("/:id/connections/:connId/resolve", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  const connId = parseInt(req.params.connId as string, 10);
  if (isNaN(projectId) || isNaN(connId)) return res.status(400).json({ message: "Invalid ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  if (!project.github_repo_name || !project.github_repo_name.includes("/")) {
    return res.status(400).json({ message: "No GitHub repo linked to this project" });
  }

  const conn = await storage.getConnectionById(connId);
  if (!conn || conn.project_id !== projectId) return res.status(404).json({ message: "Connection not found" });

  if (!conn.branch_name) {
    return res.status(400).json({ message: "Connection has no branch assigned" });
  }

  const actionSchema = z.object({
    action: z.enum(["merge_to_default", "update_from_default"]),
  });
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid action. Use merge_to_default or update_from_default." });

  const { action } = parsed.data;

  let token: string;
  try {
    token = await getAccessToken(req.session.userId!);
  } catch {
    return res.status(401).json({ message: "GitHub access token not found. Please re-authenticate." });
  }

  const [owner, repo] = project.github_repo_name.split("/");

  let defaultBranch: string;
  try {
    const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`) as { default_branch: string };
    defaultBranch = repoInfo.default_branch;
  } catch {
    return res.status(502).json({ message: "Failed to fetch repository info from GitHub" });
  }

  const branchName = conn.branch_name;

  try {
    if (action === "merge_to_default") {
      await githubFetch(token, `/repos/${owner}/${repo}/merges`, {
        method: "POST",
        body: {
          base: defaultBranch,
          head: branchName,
          commit_message: `Merge ${branchName} into ${defaultBranch} via VibeSyncPro`,
        },
      });
      try {
        await githubFetch(token, `/repos/${owner}/${repo}/merges`, {
          method: "POST",
          body: {
            base: branchName,
            head: defaultBranch,
            commit_message: `Update ${branchName} from ${defaultBranch} via VibeSyncPro`,
          },
        });
      } catch (syncErr) {
        const syncStatus = (syncErr as { statusCode?: number }).statusCode;
        if (syncStatus && syncStatus !== 204) {
          console.warn(`Post-merge sync of ${branchName} from ${defaultBranch} failed (${syncStatus}), primary merge succeeded`);
        }
      }
    } else {
      await githubFetch(token, `/repos/${owner}/${repo}/merges`, {
        method: "POST",
        body: {
          base: branchName,
          head: defaultBranch,
          commit_message: `Update ${branchName} from ${defaultBranch} via VibeSyncPro`,
        },
      });
    }

    const encodedBase = encodeURIComponent(defaultBranch);
    const encodedHead = encodeURIComponent(branchName);
    const comparison = await githubFetch(
      token,
      `/repos/${owner}/${repo}/compare/${encodedBase}...${encodedHead}`
    ) as { ahead_by: number; behind_by: number };

    let newStatus: string;
    if (comparison.ahead_by === 0 && comparison.behind_by === 0) {
      newStatus = "synced";
    } else if (comparison.ahead_by > 0 && comparison.behind_by > 0) {
      newStatus = "conflict";
    } else {
      newStatus = "drifted";
    }

    await storage.updateConnection(conn.id, {
      status: newStatus,
      ahead_by: comparison.ahead_by,
      behind_by: comparison.behind_by,
      last_synced_at: new Date(),
    });

    return res.json({
      id: conn.id,
      status: newStatus,
      ahead_by: comparison.ahead_by,
      behind_by: comparison.behind_by,
    });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      const base = action === "merge_to_default" ? defaultBranch : branchName;
      const head = action === "merge_to_default" ? branchName : defaultBranch;
      const conflictUrl = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
      return res.status(409).json({
        message: "These branches edited the same files differently. You'll need to resolve the conflicts on GitHub.",
        conflict_url: conflictUrl,
      });
    }
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`Resolve error for connection ${conn.id}:`, errorMessage);
    return res.status(502).json({ message: "Failed to merge branches on GitHub. Please try again." });
  }
});

// DELETE /api/projects/:id/connections/:connId
router.delete("/:id/connections/:connId", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  const connId = parseInt(req.params.connId as string, 10);
  if (isNaN(projectId) || isNaN(connId)) return res.status(400).json({ message: "Invalid ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  const conn = await storage.getConnectionById(connId);
  if (!conn || conn.project_id !== projectId) return res.status(404).json({ message: "Connection not found" });

  await storage.deleteConnection(connId);
  return res.json({ message: "Connection removed" });
});

export default router;
