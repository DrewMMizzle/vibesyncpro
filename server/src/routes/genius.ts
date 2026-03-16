import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { storage } from "../../storage";
import {
  githubFetch,
  getAccessToken,
  NoGitHubTokenError,
  GitHubTokenRevokedError,
  GitHubRateLimitError,
} from "./github";

const router = Router({ mergeParams: true });

// GET /api/projects/:id/connections/:connId/genius/conflicts
// Analyze both branches and return conflicting file contents
router.get("/conflicts", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  const connId = parseInt(req.params.connId as string, 10);
  if (isNaN(projectId) || isNaN(connId)) return res.status(400).json({ message: "Invalid ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });
  if (!project.github_repo_name?.includes("/")) {
    return res.status(400).json({ message: "No GitHub repo linked to this project" });
  }

  const conn = await storage.getConnectionById(connId);
  if (!conn || conn.project_id !== projectId) return res.status(404).json({ message: "Connection not found" });
  if (!conn.branch_name) return res.status(400).json({ message: "No branch set on this connection" });

  let token: string;
  try {
    token = await getAccessToken(req.session.userId!);
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    return res.status(401).json({ code: "github_token_missing", message: "Please sign in again." });
  }

  const [owner, repo] = project.github_repo_name.split("/");

  let defaultBranch: string;
  try {
    const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`) as { default_branch: string };
    defaultBranch = repoInfo.default_branch;
  } catch (err) {
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: (err as Error).message });
    }
    return res.status(502).json({ message: "Failed to fetch repo info from GitHub" });
  }

  const agentBranch = conn.branch_name;

  type FileChange = { filename: string; status: string };

  let fwdFiles: FileChange[] = [];
  let bwdFiles: FileChange[] = [];
  try {
    const [fwd, bwd] = await Promise.all([
      githubFetch(token, `/repos/${owner}/${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(agentBranch)}`) as Promise<{ files?: FileChange[] }>,
      githubFetch(token, `/repos/${owner}/${repo}/compare/${encodeURIComponent(agentBranch)}...${encodeURIComponent(defaultBranch)}`) as Promise<{ files?: FileChange[] }>,
    ]);
    fwdFiles = fwd.files ?? [];
    bwdFiles = bwd.files ?? [];
  } catch (err) {
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: (err as Error).message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: (err as Error).message });
    }
    if ((err as { statusCode?: number }).statusCode === 404) {
      return res.status(404).json({ message: `Branch '${agentBranch}' was not found in this repository. It may have been renamed or deleted — update the branch name on this connection.` });
    }
    return res.status(502).json({ message: "Failed to compare branches on GitHub" });
  }

  const agentChangedFiles = new Set(fwdFiles.map((f) => f.filename));
  const mainChangedFiles = new Set(bwdFiles.map((f) => f.filename));
  const overlappingPaths = [...agentChangedFiles].filter((f) => mainChangedFiles.has(f));

  // If no overlapping files found (e.g. main has no new commits the agent lacks),
  // fall back to all files that differ between the branches so Genius can still review them.
  const conflictingPaths = overlappingPaths.length > 0
    ? overlappingPaths
    : fwdFiles.filter((f) => f.status === "modified" || f.status === "added").map((f) => f.filename);

  if (conflictingPaths.length === 0) {
    return res.json({ files: [], defaultBranch, agentBranch, message: "No conflicting files detected. Try resyncing." });
  }

  type ConflictFile = {
    path: string;
    baseContent: string;
    headContent: string;
    headSha: string;
  };

  const files: ConflictFile[] = [];
  for (const filePath of conflictingPaths.slice(0, 12)) {
    try {
      const [baseFile, headFile] = await Promise.all([
        githubFetch(token, `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(defaultBranch)}`),
        githubFetch(token, `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(agentBranch)}`),
      ]) as [{ content: string; sha: string }, { content: string; sha: string }];

      files.push({
        path: filePath,
        baseContent: Buffer.from(baseFile.content.replace(/\s/g, ""), "base64").toString("utf8"),
        headContent: Buffer.from(headFile.content.replace(/\s/g, ""), "base64").toString("utf8"),
        headSha: headFile.sha,
      });
    } catch (err) {
      console.warn(`Could not fetch content for ${filePath}:`, err instanceof Error ? err.message : "unknown");
    }
  }

  return res.json({ files, defaultBranch, agentBranch });
});

// POST /api/projects/:id/connections/:connId/genius/suggest
// Ask Gemini to resolve a single conflicting file
router.post("/suggest", requireAuth, async (req, res) => {
  const { path, baseContent, headContent, baseBranch, headBranch } = req.body as {
    path: string;
    baseContent: string;
    headContent: string;
    baseBranch: string;
    headBranch: string;
  };

  if (!path || baseContent === undefined || headContent === undefined) {
    return res.status(400).json({ message: "Missing required fields: path, baseContent, headContent" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ message: "Gemini API key not configured (GEMINI_API_KEY)" });

  const fileName = path.split("/").pop() ?? path;
  const prompt = `You are an expert software engineer performing a git merge. Two branches have diverged and both modified the same file. Your job is to produce a clean merged version that preserves all meaningful changes from both sides.

File: ${fileName}
Full path: ${path}

## "${baseBranch}" branch (the project's main line):
\`\`\`
${baseContent.slice(0, 10000)}
\`\`\`

## "${headBranch}" branch (the AI agent's work):
\`\`\`
${headContent.slice(0, 10000)}
\`\`\`

Merge these intelligently. Keep all important code from both sides. Resolve any logical contradictions by preferring the more complete or correct implementation. Return your response in EXACTLY this format with no preamble:

MERGED_CODE:
<complete merged file content here — no markdown fences>

EXPLANATION:
<1-3 sentences describing what you merged and any decisions you made>`;

  try {
    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.15, maxOutputTokens: 32768 },
        }),
        signal: AbortSignal.timeout(45_000),
      }
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errBody.slice(0, 300));
      return res.status(502).json({ message: "Gemini API returned an error. Please try again." });
    }

    const data = await geminiRes.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const codeMatch = text.match(/MERGED_CODE:\n([\s\S]*?)(?=\nEXPLANATION:|$)/);
    const explanationMatch = text.match(/EXPLANATION:\n([\s\S]*?)$/);

    const resolution = codeMatch ? codeMatch[1].trim() : text.trim();
    const explanation = explanationMatch
      ? explanationMatch[1].trim()
      : "Merged changes from both branches.";

    return res.json({ resolution, explanation });
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      return res.status(504).json({ message: "Gemini took too long to respond. Please try again." });
    }
    console.error("Gemini request failed:", err instanceof Error ? err.message : "unknown");
    return res.status(502).json({ message: "Could not reach Gemini. Please try again." });
  }
});

// POST /api/projects/:id/connections/:connId/genius/apply
// Write resolved files to the agent branch and attempt merge
router.post("/apply", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  const connId = parseInt(req.params.connId as string, 10);
  if (isNaN(projectId) || isNaN(connId)) return res.status(400).json({ message: "Invalid ID" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });
  if (!project.github_repo_name?.includes("/")) {
    return res.status(400).json({ message: "No GitHub repo linked" });
  }

  const conn = await storage.getConnectionById(connId);
  if (!conn || conn.project_id !== projectId) return res.status(404).json({ message: "Connection not found" });
  if (!conn.branch_name) return res.status(400).json({ message: "No branch set on this connection" });

  const { resolutions } = req.body as {
    resolutions: { path: string; content: string; sha: string }[];
  };
  if (!Array.isArray(resolutions) || resolutions.length === 0) {
    return res.status(400).json({ message: "No resolutions provided" });
  }

  let token: string;
  try {
    token = await getAccessToken(req.session.userId!);
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: (err as Error).message });
    }
    return res.status(401).json({ code: "github_token_missing", message: "Please sign in again." });
  }

  const [owner, repo] = project.github_repo_name.split("/");
  const agentBranch = conn.branch_name;

  const failedFiles: string[] = [];
  for (const { path, content, sha } of resolutions) {
    try {
      await githubFetch(token, `/repos/${owner}/${repo}/contents/${path}`, {
        method: "PUT",
        body: {
          message: `Conflict Genius: resolve ${path.split("/").pop()}`,
          content: Buffer.from(content, "utf8").toString("base64"),
          sha,
          branch: agentBranch,
        },
      });
    } catch (err) {
      console.error(`Failed to write ${path}:`, err instanceof Error ? err.message : "unknown");
      failedFiles.push(path);
    }
  }

  if (failedFiles.length > 0) {
    return res.status(502).json({ message: `Could not update ${failedFiles.length} file(s): ${failedFiles.map((f) => f.split("/").pop()).join(", ")}` });
  }

  let defaultBranch: string;
  try {
    const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`) as { default_branch: string };
    defaultBranch = repoInfo.default_branch;
  } catch {
    return res.status(502).json({ message: "Failed to fetch repo info. Files were saved but merge could not be attempted." });
  }

  let mergeSucceeded = false;
  let mergeFailedMessage: string | null = null;

  try {
    await githubFetch(token, `/repos/${owner}/${repo}/merges`, {
      method: "POST",
      body: {
        base: defaultBranch,
        head: agentBranch,
        commit_message: `Conflict Genius: merge ${agentBranch} after resolving ${resolutions.length} conflict${resolutions.length === 1 ? "" : "s"} via VibeSyncPro`,
      },
    });
    mergeSucceeded = true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      mergeFailedMessage = conn.platform === "replit"
        ? "Resolutions were applied but the branches still have a deep history conflict. In the Replit Git pane, pull first to get the applied changes, then push your branch."
        : "Resolutions were applied but the branches still have a deep history conflict. Run `git pull` first to get the applied changes, then `git push`.";
    } else {
      return res.status(502).json({ message: "Files were saved but the merge still failed. Try running a sync." });
    }
  }

  // Always do a fresh comparison and update status — this prevents the infinite conflict loop
  // by reflecting the true current state (drifted, not conflict, when behind_by=0).
  const comparison = await githubFetch(
    token,
    `/repos/${owner}/${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(agentBranch)}`
  ) as { ahead_by: number; behind_by: number };

  let newStatus = "synced";
  if (mergeSucceeded) {
    if (comparison.ahead_by > 0 && comparison.behind_by > 0) newStatus = "conflict";
    else if (comparison.ahead_by > 0 || comparison.behind_by > 0) newStatus = "drifted";
  } else {
    // Merge failed — update to drifted (not conflict) so user isn't trapped in a loop.
    // The branches still differ but Conflict Genius has done what it can.
    newStatus = comparison.ahead_by > 0 || comparison.behind_by > 0 ? "drifted" : "synced";
  }

  await storage.updateConnection(conn.id, {
    status: newStatus,
    ahead_by: comparison.ahead_by,
    behind_by: comparison.behind_by,
    last_synced_at: new Date(),
  });

  await storage.addActivityLog(
    projectId,
    mergeSucceeded ? "resolve_success" : "resolve_partial",
    mergeSucceeded
      ? `Conflict Genius resolved ${resolutions.length} file${resolutions.length === 1 ? "" : "s"} and merged ${agentBranch}`
      : `Conflict Genius applied resolutions to ${resolutions.length} file${resolutions.length === 1 ? "" : "s"} on ${agentBranch} — merge still requires manual action`,
    { platform: conn.platform, branch: agentBranch, files: resolutions.length }
  );

  return res.json({
    success: mergeSucceeded,
    status: newStatus,
    ahead_by: comparison.ahead_by,
    behind_by: comparison.behind_by,
    message: mergeFailedMessage ?? undefined,
  });
});

export default router;
