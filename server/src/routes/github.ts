import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { storage } from "../../storage";

const router = Router();
const GITHUB_API = "https://api.github.com";

async function getAccessToken(userId: number): Promise<string> {
  const user = await storage.findUserById(userId);
  if (!user || !user.access_token) {
    throw new Error("No GitHub access token found");
  }
  return user.access_token;
}

async function githubFetch(token: string, path: string, options?: { method?: string; body?: Record<string, unknown> }) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!res.ok) {
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
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GitHub fork error:", message);
    return res.status(502).json({ message: "Failed to fork repository" });
  }
});

export { githubFetch, getAccessToken };
export default router;
