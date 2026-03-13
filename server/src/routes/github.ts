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

async function githubFetch(token: string, path: string) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
  return res.json();
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

export { githubFetch, getAccessToken };
export default router;
