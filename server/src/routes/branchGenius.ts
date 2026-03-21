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

// GET /api/projects/:id/branches/:branchName/genius/conflicts?targetBranch=<branch>
router.get("/conflicts", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  const branchName = req.params.branchName as string;
  const targetBranch = req.query.targetBranch as string | undefined;

  if (isNaN(projectId) || !branchName) return res.status(400).json({ message: "Invalid parameters" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });
  if (!project.github_repo_name?.includes("/")) {
    return res.status(400).json({ message: "No GitHub repo linked to this project" });
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

  const baseBranch = targetBranch ?? defaultBranch;
  const headBranch = branchName;

  type FileChange = { filename: string; status: string };
  let fwdFiles: FileChange[] = [];
  let bwdFiles: FileChange[] = [];
  try {
    const [fwd, bwd] = await Promise.all([
      githubFetch(token, `/repos/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}`) as Promise<{ files?: FileChange[] }>,
      githubFetch(token, `/repos/${owner}/${repo}/compare/${encodeURIComponent(headBranch)}...${encodeURIComponent(baseBranch)}`) as Promise<{ files?: FileChange[] }>,
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
    return res.status(502).json({ message: "Failed to compare branches on GitHub" });
  }

  const headChangedFiles = new Set(fwdFiles.map((f) => f.filename));
  const baseChangedFiles = new Set(bwdFiles.map((f) => f.filename));
  const overlappingPaths = [...headChangedFiles].filter((f) => baseChangedFiles.has(f));

  const conflictingPaths = overlappingPaths.length > 0
    ? overlappingPaths
    : fwdFiles.filter((f) => f.status === "modified" || f.status === "added").map((f) => f.filename);

  if (conflictingPaths.length === 0) {
    return res.json({ files: [], baseBranch, headBranch, message: "No conflicting files detected." });
  }

  type ConflictFile = { path: string; baseContent: string; headContent: string; headSha: string };
  const files: ConflictFile[] = [];

  for (const filePath of conflictingPaths.slice(0, 12)) {
    try {
      const [baseFile, headFile] = await Promise.all([
        githubFetch(token, `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(baseBranch)}`),
        githubFetch(token, `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(headBranch)}`),
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

  return res.json({ files, baseBranch, headBranch });
});

// POST /api/projects/:id/branches/:branchName/genius/suggest
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

## "${baseBranch}" branch (the target branch):
\`\`\`
${baseContent.slice(0, 10000)}
\`\`\`

## "${headBranch}" branch (the incoming branch with new changes):
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

    const mergedMatch = text.match(/MERGED_CODE:\n([\s\S]*?)(?:\nEXPLANATION:|$)/);
    const explanationMatch = text.match(/EXPLANATION:\n([\s\S]*?)$/);

    const resolution = mergedMatch?.[1]?.trim() ?? text.trim();
    const explanation = explanationMatch?.[1]?.trim() ?? "";

    return res.json({ resolution, explanation });
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      return res.status(504).json({ message: "Gemini took too long to respond. Please try again." });
    }
    console.error("Gemini request failed:", err instanceof Error ? err.message : "unknown");
    return res.status(502).json({ message: "Could not reach Gemini. Please try again." });
  }
});

// POST /api/projects/:id/branches/:branchName/genius/apply
router.post("/apply", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  const branchName = req.params.branchName as string;
  if (isNaN(projectId) || !branchName) return res.status(400).json({ message: "Invalid parameters" });

  const project = await storage.getProjectById(projectId);
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (project.user_id !== req.session.userId) return res.status(403).json({ message: "Forbidden" });
  if (!project.github_repo_name?.includes("/")) {
    return res.status(400).json({ message: "No GitHub repo linked" });
  }

  const { resolutions, targetBranch } = req.body as {
    resolutions: { path: string; content: string; sha: string }[];
    targetBranch?: string;
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

  let defaultBranch: string;
  try {
    const repoInfo = await githubFetch(token, `/repos/${owner}/${repo}`) as { default_branch: string };
    defaultBranch = repoInfo.default_branch;
  } catch {
    return res.status(502).json({ message: "Failed to fetch repo info." });
  }

  const baseBranch = targetBranch ?? defaultBranch;

  const failedFiles: string[] = [];
  for (const { path, content, sha } of resolutions) {
    try {
      await githubFetch(token, `/repos/${owner}/${repo}/contents/${path}`, {
        method: "PUT",
        body: {
          message: `Conflict Genius: resolve ${path.split("/").pop()}`,
          content: Buffer.from(content, "utf8").toString("base64"),
          sha,
          branch: branchName,
        },
      });
    } catch (err) {
      console.error(`Failed to write ${path}:`, err instanceof Error ? err.message : "unknown");
      failedFiles.push(path);
    }
  }

  if (failedFiles.length > 0) {
    return res.status(502).json({
      message: `Could not update ${failedFiles.length} file(s): ${failedFiles.map((f) => f.split("/").pop()).join(", ")}`,
    });
  }

  let mergeSucceeded = false;
  let mergeFailedMessage: string | null = null;

  try {
    await githubFetch(token, `/repos/${owner}/${repo}/merges`, {
      method: "POST",
      body: {
        base: baseBranch,
        head: branchName,
        commit_message: `Conflict Genius: merge ${branchName} into ${baseBranch} after resolving ${resolutions.length} conflict${resolutions.length === 1 ? "" : "s"} via VibeSyncPro`,
      },
    });
    mergeSucceeded = true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      mergeFailedMessage = "Resolutions were applied but the branches still have a deep history conflict. You may need to resolve any remaining conflicts manually on GitHub.";
    } else {
      return res.status(502).json({ message: "Files were saved but the merge still failed. Try running a sync." });
    }
  }

  await storage.addActivityLog(
    projectId,
    mergeSucceeded ? "resolve_success" : "resolve_partial",
    mergeSucceeded
      ? `Conflict Genius resolved ${resolutions.length} file${resolutions.length === 1 ? "" : "s"} and merged ${branchName} into ${baseBranch}`
      : `Conflict Genius applied resolutions to ${resolutions.length} file${resolutions.length === 1 ? "" : "s"} on ${branchName} — merge still requires manual action`,
    { branch: branchName, target: baseBranch, files: resolutions.length }
  );

  return res.json({
    success: mergeSucceeded,
    message: mergeFailedMessage ?? undefined,
  });
});

export default router;
