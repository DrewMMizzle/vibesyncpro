import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { storage } from "../../storage";
import { githubFetch, getAccessToken, GitHubRateLimitError, NoGitHubTokenError, GitHubTokenRevokedError } from "./github";
import { syncLimiter, scanLimiter } from "../middleware/rateLimiter";
import type { Project, PlatformConnection, DiscoveredBranch } from "@shared/schema";
import geniusRouter from "./genius";

const router = Router();

const VALID_PLATFORMS = ["replit", "claude_code", "computer"] as const;

type GitHubCompare = {
  ahead_by: number;
  behind_by: number;
  commits: Array<{ commit: { message: string } }>;
};

// Returns the number of commits ahead that are NOT VibeSyncPro housekeeping.
// When all ahead commits are sync housekeeping we treat the branch as in sync,
// preventing the endless "Add to project" loop that housekeeping merge commits cause.
function realAheadBy(cmp: GitHubCompare): number {
  if (cmp.commits.length < cmp.ahead_by) {
    // GitHub truncated the list (>250 commits) — can't filter safely, use raw count
    return cmp.ahead_by;
  }
  return cmp.commits.filter((c) => !c.commit.message.includes("via VibeSyncPro")).length;
}

const PLATFORM_LABELS: Record<string, string> = {
  replit: "Replit",
  claude_code: "Claude Code",
  computer: "Computer",
};

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
      platform_url: c.platform_url ?? null,
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
  const REPO_NAME_RE = /^[^/]+\/[^/]+$/;
  const bodySchema = z.object({
    name: z.string().trim().min(1, "Project name is required").max(200, "Project name must be 200 characters or fewer"),
    description: z.string().max(5000, "Description must be 5,000 characters or fewer").optional().nullable(),
    github_repo_url: z.string().optional().nullable(),
    github_repo_name: z.string().optional().nullable(),
    connections: z.array(z.object({
      platform: z.enum(VALID_PLATFORMS),
      branch_name: z.string().max(255, "Branch name must be 255 characters or fewer").nullable(),
    })).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return res.status(400).json({ message: firstError?.message || "Invalid input" });
  }

  const { name, description, github_repo_url, github_repo_name, connections: connInputs } = parsed.data;

  if (github_repo_name && !REPO_NAME_RE.test(github_repo_name)) {
    return res.status(400).json({ message: "Invalid repository name format. Expected owner/repo" });
  }

  if (connInputs) {
    for (const c of connInputs) {
      if (c.branch_name !== null && c.branch_name !== undefined && c.branch_name.trim() === "") {
        return res.status(400).json({ message: "Branch name cannot be blank" });
      }
    }
  }

  if (github_repo_name && github_repo_name.includes("/")) {
    try {
      await getAccessToken(req.session.userId!);
    } catch (err) {
      if (err instanceof NoGitHubTokenError) {
        return res.status(401).json({ code: "github_token_missing", message: err.message });
      }
      return res.status(401).json({ code: "github_token_missing", message: "GitHub access token not found. Please sign in again." });
    }
  }

  const project = await storage.createProject(req.session.userId!, name.trim(), description?.trim() || null);

  if (github_repo_name || github_repo_url) {
    await storage.updateProject(project.id, {
      github_repo_url: github_repo_url ?? null,
      github_repo_name: github_repo_name ?? null,
    });
  }

  const createdConns: PlatformConnection[] = [];
  if (connInputs && connInputs.length > 0) {
    for (const connInput of connInputs) {
      const conn = await storage.createConnection(project.id, connInput.platform, connInput.branch_name);
      createdConns.push(conn);
    }
  }

  const updatedProject = await storage.getProjectById(project.id);
  if (!updatedProject) return res.status(500).json({ message: "Failed to read project after creation" });

  const allConns = await storage.getConnectionsByProject(project.id);

  if (github_repo_name && github_repo_name.includes("/") && allConns.length > 0) {
    try {
      const token = await getAccessToken(req.session.userId!);
      const [owner, repo] = github_repo_name.split("/");
      const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`) as { default_branch: string };
      const defaultBranch = repoInfo.default_branch;

      for (const conn of allConns) {
        if (!conn.branch_name) {
          await storage.updateConnection(conn.id, { status: "disconnected", ahead_by: 0, behind_by: 0, last_synced_at: new Date() });
          continue;
        }
        if (conn.branch_name === defaultBranch) {
          await storage.updateConnection(conn.id, { status: "synced", ahead_by: 0, behind_by: 0, last_synced_at: new Date() });
          continue;
        }
        try {
          const comparison = await githubFetch(
            token,
            `/repos/${owner}/${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(conn.branch_name)}`
          ) as GitHubCompare;
          const aheadBy = realAheadBy(comparison);
          let status: string;
          if (aheadBy === 0 && comparison.behind_by === 0) status = "synced";
          else if (aheadBy > 0 && comparison.behind_by > 0) status = "conflict";
          else status = "drifted";
          await storage.updateConnection(conn.id, { status, last_synced_at: new Date(), ahead_by: aheadBy, behind_by: comparison.behind_by });
        } catch {
          // sync error for individual connection — skip
        }
      }
    } catch (err) {
      if (err instanceof GitHubTokenRevokedError) {
        // Token was valid at pre-check but revoked during sync — log but don't fail
        console.error("Token revoked during initial sync:", err.message);
      }
      // initial sync failed — project still created successfully
    }
  }

  await storage.addActivityLog(project.id, "project_created", `Project "${name}" was created`, {
    connections: connInputs?.map((c) => c.platform) ?? [],
    has_repo: !!github_repo_name,
  });

  const finalConns = await storage.getConnectionsByProject(project.id);
  const finalProject = await storage.getProjectById(project.id);
  return res.status(201).json(formatProject(finalProject!, finalConns));
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
    name: z.string().min(1, "Project name is required").max(200, "Project name must be 200 characters or fewer").optional(),
    description: z.string().max(5000, "Description must be 5,000 characters or fewer").optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return res.status(400).json({ message: firstError?.message || "Invalid fields" });
  }

  const data = { ...parsed.data };
  if (data.name !== undefined) {
    data.name = data.name.trim();
    if (!data.name) return res.status(400).json({ message: "Name cannot be empty" });
  }
  if (data.description !== undefined && data.description !== null) {
    data.description = data.description.trim() || null;
  }
  if (data.github_repo_name !== undefined && data.github_repo_name !== null) {
    if (!/^[^/]+\/[^/]+$/.test(data.github_repo_name)) {
      return res.status(400).json({ message: "Invalid repository name format. Expected owner/repo" });
    }
  }

  const updated = await storage.updateProject(projectId, data);
  if (!updated) return res.status(404).json({ message: "Project not found" });

  const connections = await storage.getConnectionsByProject(projectId);
  return res.json(formatProject(updated, connections));
});

// DELETE /api/projects/:id — delete a project and all related data
router.delete("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) return res.status(400).json({ message: "Invalid project ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  await storage.deleteProject(projectId);
  return res.json({ deleted: true });
});

// GET /api/projects/:id/activity — get activity log
router.get("/:id/activity", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) return res.status(400).json({ message: "Invalid project ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  const entries = await storage.getActivityLog(projectId, 50);
  return res.json({ activity: entries });
});

// POST /api/projects/:id/sync — compare branches via GitHub API and update statuses
router.post("/:id/sync", requireAuth, syncLimiter, async (req, res) => {
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
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    return res.status(401).json({ code: "github_token_missing", message: "GitHub access token not found. Please sign in again." });
  }

  const connections = await storage.getConnectionsByProject(projectId);
  const [owner, repo] = project.github_repo_name.split("/");

  let defaultBranch: string;
  try {
    const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`) as { default_branch: string };
    defaultBranch = repoInfo.default_branch;
  } catch (err) {
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
    return res.status(502).json({ message: "Failed to fetch repository info from GitHub" });
  }

  const results: Array<{ id: number; platform: string; branch_name: string | null; status: string; last_synced_at: string | null; ahead_by?: number; behind_by?: number }> = [];
  const errors: Array<{ id: number; platform: string; error: string }> = [];

  for (const conn of connections) {
    if (!conn.branch_name) {
      await storage.updateConnection(conn.id, { status: "disconnected", ahead_by: 0, behind_by: 0, last_synced_at: new Date() });
      results.push({ id: conn.id, platform: conn.platform, branch_name: conn.branch_name, status: "disconnected", last_synced_at: new Date().toISOString(), ahead_by: 0, behind_by: 0 });
      continue;
    }

    if (conn.branch_name === defaultBranch) {
      await storage.updateConnection(conn.id, { status: "synced", ahead_by: 0, behind_by: 0, last_synced_at: new Date() });
      results.push({ id: conn.id, platform: conn.platform, branch_name: conn.branch_name, status: "synced", last_synced_at: new Date().toISOString(), ahead_by: 0, behind_by: 0 });
      continue;
    }

    try {
      const encodedBase = encodeURIComponent(defaultBranch);
      const encodedHead = encodeURIComponent(conn.branch_name);
      const comparison = await githubFetch(
        token,
        `/repos/${owner}/${repo}/compare/${encodedBase}...${encodedHead}`
      ) as GitHubCompare;

      const aheadBy = realAheadBy(comparison);
      let status: string;
      if (aheadBy === 0 && comparison.behind_by === 0) {
        status = "synced";
      } else if (aheadBy > 0 && comparison.behind_by > 0) {
        status = "conflict";
      } else {
        status = "drifted";
      }

      await storage.updateConnection(conn.id, { status, last_synced_at: new Date(), ahead_by: aheadBy, behind_by: comparison.behind_by });
      results.push({
        id: conn.id,
        platform: conn.platform,
        branch_name: conn.branch_name,
        status,
        last_synced_at: new Date().toISOString(),
        ahead_by: aheadBy,
        behind_by: comparison.behind_by,
      });
    } catch (err) {
      if (err instanceof GitHubTokenRevokedError) {
        return res.status(401).json({ code: "github_token_revoked", message: err.message });
      }
      if (err instanceof GitHubRateLimitError) {
        return res.status(429).json({ message: err.message });
      }
      const statusCode = (err as { statusCode?: number }).statusCode;
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error(`Sync error for connection ${conn.id}:`, errorMessage);
      if (statusCode === 404) {
        await storage.updateConnection(conn.id, { status: "disconnected", ahead_by: 0, behind_by: 0, last_synced_at: new Date() });
        errors.push({ id: conn.id, platform: conn.platform, error: `Branch '${conn.branch_name}' not found in this repository. It may have been renamed or deleted.` });
        results.push({ id: conn.id, platform: conn.platform, branch_name: conn.branch_name, status: "disconnected", last_synced_at: new Date().toISOString(), ahead_by: 0, behind_by: 0 });
      } else {
        errors.push({ id: conn.id, platform: conn.platform, error: errorMessage });
        results.push({ id: conn.id, platform: conn.platform, branch_name: conn.branch_name, status: conn.status, last_synced_at: conn.last_synced_at?.toISOString() ?? null });
      }
    }
  }

  const errorIds = new Set(errors.map((e) => e.id));
  for (const r of results) {
    if (errorIds.has(r.id)) continue;
    const platformLabel = PLATFORM_LABELS[r.platform] ?? r.platform;
    if (r.status === "synced") {
      await storage.addActivityLog(projectId, "sync_synced", `${platformLabel} branch is up to date`, { platform: r.platform, branch: r.branch_name });
    } else if (r.status === "drifted") {
      const detail = (r.ahead_by ?? 0) > 0 ? `${r.ahead_by} ahead` : `${r.behind_by} behind`;
      await storage.addActivityLog(projectId, "sync_drifted", `${platformLabel} branch has drifted (${detail})`, { platform: r.platform, branch: r.branch_name, ahead_by: r.ahead_by, behind_by: r.behind_by });
    } else if (r.status === "conflict") {
      await storage.addActivityLog(projectId, "sync_conflict", `${platformLabel} branch has conflicts`, { platform: r.platform, branch: r.branch_name, ahead_by: r.ahead_by, behind_by: r.behind_by });
    }
  }
  for (const e of errors) {
    const platformLabel = PLATFORM_LABELS[e.platform] ?? e.platform;
    await storage.addActivityLog(projectId, "sync_error", `Sync failed for ${platformLabel}`, { platform: e.platform, error: e.error });
  }

  let discoveredBranchesList: ReturnType<typeof formatDiscoveredBranch>[] = [];
  let rateLimitWarning: string | undefined;
  try {
    discoveredBranchesList = await runBranchScan(projectId, token, owner, repo, defaultBranch);
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      rateLimitWarning = err.message;
    }
    console.error(`Auto-scan after sync failed for project ${projectId}:`, err instanceof Error ? err.message : "Unknown error");
  }

  return res.json({ synced: errors.length === 0, errors, connections: results, default_branch: defaultBranch, discovered_branches: discoveredBranchesList, ...(rateLimitWarning ? { warning: rateLimitWarning } : {}) });
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
    branch_name: z.string().max(255, "Branch name must be 255 characters or fewer").optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return res.status(400).json({ message: firstError?.message || "Invalid platform" });
  }

  const { platform, branch_name } = parsed.data;

  if (branch_name !== undefined && branch_name !== null && branch_name.trim() === "") {
    return res.status(400).json({ message: "Branch name cannot be blank" });
  }

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
    branch_name: z.string().max(255, "Branch name must be 255 characters or fewer").optional().nullable(),
    platform_url: z.string().url("Must be a valid URL").max(2048).optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return res.status(400).json({ message: firstError?.message || "Invalid fields" });
  }

  if (parsed.data.branch_name !== undefined && parsed.data.branch_name !== null && parsed.data.branch_name.trim() === "") {
    return res.status(400).json({ message: "Branch name cannot be blank" });
  }

  const updated = await storage.updateConnection(connId, parsed.data);
  if (!updated) return res.status(404).json({ message: "Connection not found" });

  return res.json({
    id: updated.id,
    platform: updated.platform,
    branch_name: updated.branch_name,
    platform_url: updated.platform_url ?? null,
    status: updated.status,
    last_synced_at: updated.last_synced_at,
  });
});

// GET /api/projects/:id/connections/:connId/commits — fetch commit context from GitHub
router.get("/:id/connections/:connId/commits", requireAuth, async (req, res) => {
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
  if (!conn.branch_name) return res.json({ ahead: [], behind: [], files: [] });

  let token: string;
  try {
    token = await getAccessToken(req.session.userId!);
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    return res.status(401).json({ code: "github_token_missing", message: "GitHub access token not found. Please sign in again." });
  }

  const [owner, repo] = project.github_repo_name.split("/");

  type GitHubCommit = { sha: string; commit: { message: string; author: { name: string; date: string } } };
  type GitHubFile = { filename: string; status: string };

  try {
    const fwd = await githubFetch(token, `/repos/${owner}/${repo}/compare/${encodeURIComponent(conn.branch_name)}...HEAD`) as {
      commits: GitHubCommit[];
      files?: GitHubFile[];
    };
    const bwd = await githubFetch(token, `/repos/${owner}/${repo}/compare/HEAD...${encodeURIComponent(conn.branch_name)}`) as {
      commits: GitHubCommit[];
      files?: GitHubFile[];
    };

    const mapCommit = (c: GitHubCommit) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0].slice(0, 120),
      author: c.commit.author.name,
      date: c.commit.author.date,
    });

    return res.json({
      behind: fwd.commits.slice(0, 8).map(mapCommit),
      ahead: bwd.commits.slice(0, 8).map(mapCommit),
      files: (fwd.files ?? []).slice(0, 20).map((f) => ({ name: f.filename, status: f.status })),
    });
  } catch (err) {
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
    return res.status(502).json({ message: "Failed to fetch commit data from GitHub" });
  }
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
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    return res.status(401).json({ code: "github_token_missing", message: "GitHub access token not found. Please sign in again." });
  }

  const [owner, repo] = project.github_repo_name.split("/");

  let defaultBranch: string;
  try {
    const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`) as { default_branch: string };
    defaultBranch = repoInfo.default_branch;
  } catch (err) {
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
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
    ) as GitHubCompare;

    const aheadBy = realAheadBy(comparison);
    let newStatus: string;
    if (aheadBy === 0 && comparison.behind_by === 0) {
      newStatus = "synced";
    } else if (aheadBy > 0 && comparison.behind_by > 0) {
      newStatus = "conflict";
    } else {
      newStatus = "drifted";
    }

    await storage.updateConnection(conn.id, {
      status: newStatus,
      ahead_by: aheadBy,
      behind_by: comparison.behind_by,
      last_synced_at: new Date(),
    });

    const platformLabel = PLATFORM_LABELS[conn.platform] ?? conn.platform;
    const actionDesc = action === "merge_to_default"
      ? `${platformLabel} branch merged to ${defaultBranch}`
      : `${platformLabel} branch updated from ${defaultBranch}`;
    await storage.addActivityLog(projectId, "resolve_success", actionDesc, { platform: conn.platform, branch: branchName, action });

    return res.json({
      id: conn.id,
      status: newStatus,
      ahead_by: aheadBy,
      behind_by: comparison.behind_by,
    });
  } catch (err) {
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    const rawErrMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`Resolve error for connection ${conn.id} (status ${statusCode ?? "unknown"}):`, rawErrMsg);

    if (statusCode === 409) {
      const base = action === "merge_to_default" ? defaultBranch : branchName;
      const head = action === "merge_to_default" ? branchName : defaultBranch;
      const conflictUrl = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
      const platformLabel = PLATFORM_LABELS[conn.platform] ?? conn.platform;

      // Do a fresh comparison to determine real status — avoid falsely marking as
      // "conflict" when behind_by=0 (branch is purely ahead, merge failed due to
      // complex git history / rebase, not a true file conflict).
      let freshAhead = conn.ahead_by ?? 0;
      let freshBehind = conn.behind_by ?? 0;
      try {
        const cmp = await githubFetch(
          token,
          `/repos/${owner}/${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branchName)}`
        ) as GitHubCompare;
        freshAhead = realAheadBy(cmp);
        freshBehind = cmp.behind_by;
      } catch { /* ignore — fall back to cached values */ }

      const trueConflict = freshAhead > 0 && freshBehind > 0;
      const newStatus = trueConflict ? "conflict" : "drifted";
      await storage.updateConnection(conn.id, { status: newStatus, ahead_by: freshAhead, behind_by: freshBehind, last_synced_at: new Date() });
      await storage.addActivityLog(projectId, "resolve_conflict", `Conflict detected merging ${platformLabel} branch`, { platform: conn.platform, branch: branchName, action });

      // For a PR creation URL, append ?expand=1 so GitHub opens the PR form directly
      const prUrl = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branchName)}?expand=1`;
      const message = trueConflict
        ? "Both sides changed the same files in different ways. Auto-resolve couldn't handle it. Use Conflict Genius to review the differences, or open a pull request on GitHub."
        : "Auto-merge didn't work because this branch has a non-standard history. Open a pull request on GitHub to merge it — that's the safest path.";
      return res.status(409).json({ message, conflict_url: trueConflict ? conflictUrl : prUrl });
    }

    const githubMsgMatch = rawErrMsg.match(/"message"\s*:\s*"([^"]+)"/);
    const githubMsg = githubMsgMatch ? githubMsgMatch[1] : null;

    if (statusCode === 404) {
      await storage.updateConnection(conn.id, { status: "disconnected", ahead_by: 0, behind_by: 0, last_synced_at: new Date() });
      return res.status(404).json({ message: `Branch '${branchName}' was not found in this repository. It may have been deleted or renamed. Update the branch name on this connection to continue.` });
    }
    if (statusCode === 403) {
      return res.status(502).json({ message: `GitHub blocked the merge. This repo may have branch protection rules that require a pull request or passing checks before merging.` });
    }
    if (statusCode === 422) {
      const detail = githubMsg ?? "The branch may be in an invalid state";
      return res.status(502).json({ message: `GitHub could not process the merge: ${detail}` });
    }

    return res.status(502).json({ message: githubMsg ? `GitHub merge failed: ${githubMsg}` : "Failed to merge branches on GitHub. Please try again." });
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

function formatDiscoveredBranch(b: DiscoveredBranch) {
  return {
    id: b.id,
    branch_name: b.branch_name,
    likely_platform: b.likely_platform,
    ahead_by_default: b.ahead_by_default ?? 0,
    behind_by_default: b.behind_by_default ?? 0,
    ahead_by_parent: b.ahead_by_parent ?? 0,
    behind_by_parent: b.behind_by_parent ?? 0,
    last_commit_sha: b.last_commit_sha,
    last_commit_at: b.last_commit_at,
    dismissed_at: b.dismissed_at,
    last_seen_at: b.last_seen_at,
  };
}

interface GitHubBranchInfo {
  name: string;
  commit: { sha: string; url: string };
}

interface GitHubCommitDetail {
  commit: { committer: { date: string } | null; author: { date: string } | null };
}

const MAX_SCAN_BRANCHES = 50;

async function runBranchScan(projectId: number, token: string, owner: string, repo: string, defaultBranch: string) {
  const connections = await storage.getConnectionsByProject(projectId);
  const registeredBranches = new Set<string>();
  registeredBranches.add(defaultBranch);
  for (const conn of connections) {
    if (conn.branch_name) registeredBranches.add(conn.branch_name);
  }

  const allBranches: GitHubBranchInfo[] = [];
  let page = 1;
  while (true) {
    const batch = await githubFetch(
      token,
      `/repos/${owner}/${repo}/branches?per_page=100&page=${page}`
    ) as GitHubBranchInfo[];
    allBranches.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  const unregistered = allBranches.filter((b) => !registeredBranches.has(b.name));

  // Cap unregistered branches to avoid excessive API calls on large repos
  const capped = unregistered.slice(0, MAX_SCAN_BRANCHES);
  if (unregistered.length > MAX_SCAN_BRANCHES) {
    console.warn(`Branch scan for project ${projectId}: ${unregistered.length} unregistered branches found, processing first ${MAX_SCAN_BRANCHES}`);
  }

  const discoveredNames: string[] = [];

  for (const branch of capped) {
    discoveredNames.push(branch.name);

    const existing = await storage.getDiscoveredBranchByName(projectId, branch.name);
    if (existing?.dismissed_at && existing.last_commit_sha === branch.commit.sha) {
      continue;
    }

    let aheadByDefault = 0;
    let behindByDefault = 0;
    try {
      const comparison = await githubFetch(
        token,
        `/repos/${owner}/${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branch.name)}`
      ) as { ahead_by: number; behind_by: number };
      aheadByDefault = comparison.ahead_by;
      behindByDefault = comparison.behind_by;
    } catch {
    }

    let likelyPlatform: string | null = null;
    let aheadByParent = 0;
    let behindByParent = 0;
    const platformBranches = connections.filter((c) => c.branch_name && c.branch_name !== defaultBranch);
    let closestAhead = Infinity;
    for (const conn of platformBranches) {
      try {
        const cmp = await githubFetch(
          token,
          `/repos/${owner}/${repo}/compare/${encodeURIComponent(conn.branch_name!)}...${encodeURIComponent(branch.name)}`
        ) as { ahead_by: number; behind_by: number };
        if (cmp.behind_by === 0 && cmp.ahead_by > 0 && cmp.ahead_by < closestAhead) {
          closestAhead = cmp.ahead_by;
          likelyPlatform = conn.platform;
          aheadByParent = cmp.ahead_by;
          behindByParent = cmp.behind_by;
        }
      } catch {
      }
    }

    let lastCommitAt: Date | null = null;
    try {
      const commitDetail = await githubFetch(
        token,
        `/repos/${owner}/${repo}/commits/${branch.commit.sha}`
      ) as GitHubCommitDetail;
      const dateStr = commitDetail.commit?.committer?.date ?? commitDetail.commit?.author?.date;
      if (dateStr) lastCommitAt = new Date(dateStr);
    } catch {
    }

    const updateFields: { likely_platform: string | null; ahead_by_default: number; behind_by_default: number; ahead_by_parent: number; behind_by_parent: number; last_commit_sha: string; last_commit_at: Date | null; last_seen_at: Date; dismissed_at?: null } = {
      likely_platform: likelyPlatform,
      ahead_by_default: aheadByDefault,
      behind_by_default: behindByDefault,
      ahead_by_parent: aheadByParent,
      behind_by_parent: behindByParent,
      last_commit_sha: branch.commit.sha,
      last_commit_at: lastCommitAt,
      last_seen_at: new Date(),
    };

    if (existing?.dismissed_at && existing.last_commit_sha !== branch.commit.sha) {
      updateFields.dismissed_at = null;
    }

    await storage.upsertDiscoveredBranch(projectId, branch.name, updateFields);
  }

  await storage.deleteStaleDiscoveredBranches(projectId, discoveredNames);

  const allDiscovered = await storage.getDiscoveredBranches(projectId);
  return allDiscovered.filter((b) => !b.dismissed_at).map(formatDiscoveredBranch);
}

// POST /api/projects/:id/branches/scan — discover unregistered branches
router.post("/:id/branches/scan", requireAuth, scanLimiter, async (req, res) => {
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
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    return res.status(401).json({ code: "github_token_missing", message: "GitHub access token not found. Please sign in again." });
  }

  const [owner, repo] = project.github_repo_name.split("/");

  let defaultBranch: string;
  try {
    const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`) as { default_branch: string };
    defaultBranch = repoInfo.default_branch;
  } catch (err) {
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
    return res.status(502).json({ message: "Failed to fetch repository info from GitHub" });
  }

  try {
    const discovered = await runBranchScan(projectId, token, owner, repo, defaultBranch);
    return res.json({ discovered_branches: discovered });
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`Branch scan error for project ${projectId}:`, errorMessage);
    return res.status(502).json({ message: "Failed to scan branches from GitHub" });
  }
});

// GET /api/projects/:id/branches/discovered — get stored discovered branches
router.get("/:id/branches/discovered", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) return res.status(400).json({ message: "Invalid project ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  const allDiscovered = await storage.getDiscoveredBranches(projectId);
  return res.json({ discovered_branches: allDiscovered.filter((b) => !b.dismissed_at).map(formatDiscoveredBranch) });
});

// POST /api/projects/:id/branches/:branchName/triage — take action on a discovered branch
router.post("/:id/branches/:branchName/triage", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) return res.status(400).json({ message: "Invalid project ID" });

  const branchName = decodeURIComponent(req.params.branchName as string);

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

  if (!project.github_repo_name || !project.github_repo_name.includes("/")) {
    return res.status(400).json({ message: "No GitHub repo linked to this project" });
  }

  const actionSchema = z.object({
    action: z.enum(["merge_to_default", "merge_to_platform", "assign_to_replit", "dismiss"]),
    platform_branch: z.string().optional(),
  });
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid action" });

  const { action, platform_branch } = parsed.data;
  const [owner, repo] = project.github_repo_name.split("/");

  const discoveredBranch = await storage.getDiscoveredBranchByName(projectId, branchName);

  if (action === "dismiss") {
    if (discoveredBranch) {
      await storage.dismissDiscoveredBranch(discoveredBranch.id, discoveredBranch.last_commit_sha);
    }
    await storage.addActivityLog(projectId, "branch_dismissed", `Branch "${branchName}" was dismissed`, { branch: branchName });
    return res.json({ message: "Branch dismissed" });
  }

  let token: string;
  try {
    token = await getAccessToken(req.session.userId!);
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    return res.status(401).json({ code: "github_token_missing", message: "GitHub access token not found. Please sign in again." });
  }

  if (action === "assign_to_replit") {
    const connections = await storage.getConnectionsByProject(projectId);
    const replitConn = connections.find((c) => c.platform === "replit");
    if (!replitConn) {
      return res.status(400).json({ message: "No Replit connection exists for this project" });
    }
    await storage.updateConnection(replitConn.id, { branch_name: branchName, status: "drifted", last_synced_at: new Date() });
    if (discoveredBranch) await storage.deleteDiscoveredBranch(discoveredBranch.id);
    await storage.addActivityLog(projectId, "branch_assigned", `Branch "${branchName}" assigned to Replit`, { branch: branchName, platform: "replit" });
    return res.json({ message: `Replit connection switched to branch ${branchName}` });
  }

  let defaultBranch: string;
  try {
    const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`) as { default_branch: string };
    defaultBranch = repoInfo.default_branch;
  } catch (err) {
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    return res.status(502).json({ message: "Failed to fetch repository info from GitHub" });
  }

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
    } else if (action === "merge_to_platform") {
      if (!platform_branch) {
        return res.status(400).json({ message: "platform_branch is required for merge_to_platform" });
      }
      const projectConnections = await storage.getConnectionsByProject(projectId);
      const validBranch = projectConnections.some((c) => c.branch_name === platform_branch);
      if (!validBranch) {
        return res.status(400).json({ message: "platform_branch must match a registered connection branch" });
      }
      await githubFetch(token, `/repos/${owner}/${repo}/merges`, {
        method: "POST",
        body: {
          base: platform_branch,
          head: branchName,
          commit_message: `Merge ${branchName} into ${platform_branch} via VibeSyncPro`,
        },
      });
    }

    if (discoveredBranch) await storage.deleteDiscoveredBranch(discoveredBranch.id);
    const target = action === "merge_to_default" ? defaultBranch : (platform_branch ?? "platform branch");
    await storage.addActivityLog(projectId, "branch_merged", `Branch "${branchName}" merged to ${target}`, { branch: branchName, action, target });
    return res.json({ message: "Branch merged successfully" });
  } catch (err) {
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      const base = action === "merge_to_default" ? defaultBranch : (platform_branch ?? defaultBranch);
      const conflictUrl = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branchName)}`;
      await storage.addActivityLog(projectId, "branch_conflict", `Conflict detected merging branch "${branchName}"`, { branch: branchName, action });
      return res.status(409).json({
        message: "These branches edited the same files differently. You'll need to resolve the conflicts on GitHub.",
        conflict_url: conflictUrl,
      });
    }
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`Triage error for branch ${branchName}:`, errorMessage);
    return res.status(502).json({ message: "Failed to merge branches on GitHub. Please try again." });
  }
});

router.use("/:id/connections/:connId/genius", geniusRouter);

export default router;
