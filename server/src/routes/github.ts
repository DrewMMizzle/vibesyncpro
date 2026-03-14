import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { storage } from "../../storage";
import { analyzeLimiter } from "../middleware/rateLimiter";

const router = Router();
const GITHUB_API = "https://api.github.com";

class NoGitHubTokenError extends Error {
  constructor() {
    super("No GitHub access token found");
    this.name = "NoGitHubTokenError";
  }
}

class GitHubTokenRevokedError extends Error {
  constructor() {
    super("Your GitHub access has expired or been revoked. Please sign in again.");
    this.name = "GitHubTokenRevokedError";
  }
}

async function getAccessToken(userId: number): Promise<string> {
  const user = await storage.findUserById(userId);
  if (!user || !user.access_token) {
    throw new NoGitHubTokenError();
  }
  return user.access_token;
}

const FETCH_TIMEOUT_MS = 10_000;

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url.split("?")[0];
  }
}

class FetchTimeoutError extends Error {
  constructor(url: string) {
    super(`Request timed out after ${FETCH_TIMEOUT_MS}ms: ${sanitizeUrl(url)}`);
    this.name = "FetchTimeoutError";
  }
}

class GitHubRateLimitError extends Error {
  resetAt: Date;
  constructor(resetTimestamp: number) {
    const resetDate = new Date(resetTimestamp * 1000);
    const timeStr = resetDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    super(`GitHub API rate limit reached. Resets at ${timeStr}.`);
    this.name = "GitHubRateLimitError";
    this.resetAt = resetDate;
  }
}

function createTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(FETCH_TIMEOUT_MS);
}

async function githubFetch(token: string, path: string, options?: { method?: string; body?: Record<string, unknown> }) {
  const url = `${GITHUB_API}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
      signal: createTimeoutSignal(),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new FetchTimeoutError(url);
    }
    throw err;
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new GitHubTokenRevokedError();
    }
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const resetHeader = res.headers.get("x-ratelimit-reset");
      if (remaining === "0" && resetHeader) {
        throw new GitHubRateLimitError(parseInt(resetHeader, 10));
      }
    }
    const body = await res.text();
    const error = new Error(`GitHub API error ${res.status}: ${body}`);
    (error as GitHubApiError).statusCode = res.status;
    throw error;
  }
  if (res.status === 204) {
    return null;
  }
  return res.json();
}

interface GitHubApiError extends Error {
  statusCode?: number;
}

router.get("/repos", requireAuth, async (req, res) => {
  try {
    const token = await getAccessToken(req.session.userId!);
    const page = parseInt(req.query.page as string) || 1;
    const perPage = parseInt(req.query.per_page as string) || 100;
    const repos = await githubFetch(
      token,
      `/user/repos?sort=updated&per_page=${perPage}&page=${page}&type=all`
    ) as Array<{ name: string; full_name: string; default_branch: string; html_url: string; private: boolean }>;

    return res.json(
      repos.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        default_branch: r.default_branch,
        html_url: r.html_url,
        private: r.private,
      }))
    );
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GitHub repos error:", message);
    return res.status(502).json({ message: "Failed to fetch repos from GitHub" });
  }
});

router.get("/repos/:owner/:repo/branches", requireAuth, async (req, res) => {
  try {
    const token = await getAccessToken(req.session.userId!);
    const { owner, repo } = req.params;
    const branches = await githubFetch(
      token,
      `/repos/${owner}/${repo}/branches?per_page=100`
    ) as Array<{ name: string }>;

    return res.json(branches.map((b) => ({ name: b.name })));
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GitHub branches error:", message);
    return res.status(502).json({ message: "Failed to fetch branches from GitHub" });
  }
});

router.get("/repos/public", requireAuth, async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ message: "url query parameter is required" });

  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return res.status(400).json({ message: "Invalid GitHub URL" });

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");

  try {
    const token = await getAccessToken(req.session.userId!);
    const data = await githubFetch(token, `/repos/${owner}/${repo}`) as {
      full_name: string; name: string; default_branch: string; html_url: string; description: string | null; private: boolean;
    };
    return res.json({
      full_name: data.full_name,
      name: data.name,
      default_branch: data.default_branch,
      html_url: data.html_url,
      description: data.description,
      private: data.private,
    });
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
    const ghErr = err as GitHubApiError;
    if (ghErr.statusCode === 404) {
      return res.status(404).json({ message: "Repository not found" });
    }
    return res.status(502).json({ message: "Failed to reach GitHub API" });
  }
});

router.post("/fork", requireAuth, async (req, res) => {
  const { repo_full_name } = req.body as { repo_full_name?: string };
  if (!repo_full_name || !repo_full_name.includes("/")) {
    return res.status(400).json({ message: "repo_full_name is required (owner/repo)" });
  }

  try {
    const token = await getAccessToken(req.session.userId!);
    const [owner, repo] = repo_full_name.split("/");
    const forked = await githubFetch(token, `/repos/${owner}/${repo}/forks`, {
      method: "POST",
      body: {},
    }) as { full_name: string; name: string; default_branch: string; html_url: string; private: boolean };

    return res.status(201).json({
      full_name: forked.full_name,
      name: forked.name,
      default_branch: forked.default_branch,
      html_url: forked.html_url,
      private: forked.private,
    });
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GitHub fork error:", message);
    return res.status(502).json({ message: "Failed to fork repository" });
  }
});

router.post("/repos/analyze", requireAuth, analyzeLimiter, async (req, res) => {
  const { repo_full_name } = req.body as { repo_full_name?: string };
  if (!repo_full_name || !repo_full_name.includes("/")) {
    return res.status(400).json({ message: "repo_full_name is required (owner/repo)" });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(503).json({ message: "Analysis service not configured" });
  }

  try {
    const token = await getAccessToken(req.session.userId!);
    const [owner, repo] = repo_full_name.split("/");

    const repoData = await githubFetch(token, `/repos/${owner}/${repo}`) as {
      description: string | null;
      default_branch: string;
      language: string | null;
      name: string;
    };

    let languages: Record<string, number> = {};
    try {
      languages = await githubFetch(token, `/repos/${owner}/${repo}/languages`) as Record<string, number>;
    } catch { /* ignore */ }

    let rootFiles: string[] = [];
    try {
      const contents = await githubFetch(token, `/repos/${owner}/${repo}/contents/`) as Array<{ name: string; type: string }>;
      rootFiles = contents.slice(0, 40).map((f) => f.type === "dir" ? `${f.name}/` : f.name);
    } catch { /* ignore */ }

    let readmeText = "";
    try {
      const readme = await githubFetch(token, `/repos/${owner}/${repo}/readme`) as { content: string };
      readmeText = Buffer.from(readme.content, "base64").toString("utf-8").slice(0, 4000);
    } catch { /* ignore */ }

    const languageList = Object.keys(languages).slice(0, 6).join(", ");
    const prompt = `You are analyzing a GitHub repository for its developer. Based on the information below, provide:
1. A 2-3 sentence plain-English description of what this project does (written for the developer who built it, concise and factual)
2. A JSON array of up to 5 specific technologies/frameworks detected (e.g. "React", "TypeScript", "PostgreSQL", "Express", "Tailwind")

Respond ONLY with valid JSON in this exact format: {"summary": "...", "stack": ["...", "..."]}

Repository: ${repo_full_name}
Description: ${repoData.description || "none"}
Primary language: ${repoData.language || "unknown"}
All languages: ${languageList || "unknown"}
Root files: ${rootFiles.join(", ") || "unknown"}
README (first 4000 chars):
${readmeText || "No README found"}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
    let geminiRes: Response;
    try {
      geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 512,
          },
        }),
        signal: createTimeoutSignal(),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
        throw new FetchTimeoutError(geminiUrl);
      }
      throw err;
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      throw new Error(`Gemini API error ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };

    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let parsed: { summary?: string; stack?: string[] } = {};
    try {
      parsed = JSON.parse(rawText);
    } catch { /* ignore */ }

    return res.json({
      summary: parsed.summary ?? repoData.description ?? "",
      stack: Array.isArray(parsed.stack) ? parsed.stack.slice(0, 5) : [],
      repo_name: repoData.name,
      default_branch: repoData.default_branch,
    });
  } catch (err) {
    if (err instanceof NoGitHubTokenError) {
      return res.status(401).json({ code: "github_token_missing", message: err.message });
    }
    if (err instanceof GitHubTokenRevokedError) {
      return res.status(401).json({ code: "github_token_revoked", message: err.message });
    }
    if (err instanceof GitHubRateLimitError) {
      return res.status(429).json({ message: err.message });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Analyze error:", message);
    return res.status(502).json({ message: "Failed to analyze repository" });
  }
});

export { githubFetch, getAccessToken, FetchTimeoutError, GitHubRateLimitError, NoGitHubTokenError, GitHubTokenRevokedError };
export default router;
