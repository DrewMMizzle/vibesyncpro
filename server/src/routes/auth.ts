import { Router } from "express";

const router = Router();

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const SCOPES = "repo read:user";

// In-memory token store (will be replaced with database later)
const tokenStore = new Map<string, string>();

// GET /auth/github — redirect to GitHub OAuth
router.get("/github", (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ message: "GitHub OAuth is not configured" });
  }

  const callbackUrl =
    process.env.GITHUB_CALLBACK_URL || "http://localhost:5000/auth/github/callback";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: SCOPES,
  });

  return res.redirect(`${GITHUB_AUTH_URL}?${params.toString()}`);
});

// GET /auth/github/callback — exchange code for token
router.get("/github/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    return res.status(400).json({ message: "Missing code parameter" });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ message: "GitHub OAuth is not configured" });
  }

  const callbackUrl =
    process.env.GITHUB_CALLBACK_URL || "http://localhost:5000/auth/github/callback";

  try {
    // Exchange code for access token
    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      return res.status(502).json({ message: "Failed to exchange code for token" });
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      return res.status(401).json({
        message: tokenData.error_description || "OAuth authorization failed",
      });
    }

    const accessToken = tokenData.access_token;

    // Fetch user info from GitHub
    const userResponse = await fetch(GITHUB_USER_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!userResponse.ok) {
      return res.status(502).json({ message: "Failed to fetch GitHub user info" });
    }

    const userData = (await userResponse.json()) as {
      login: string;
      avatar_url: string;
    };

    // Store token in memory
    tokenStore.set(userData.login, accessToken);

    // Save to session
    req.session.githubAccessToken = accessToken;
    req.session.githubUser = {
      username: userData.login,
      avatarUrl: userData.avatar_url,
    };

    // Redirect to frontend with success
    return res.redirect("/?auth=success");
  } catch (error) {
    console.error("GitHub OAuth callback error:", error);
    return res.status(500).json({ message: "Internal server error during OAuth" });
  }
});

// GET /auth/me — return current user info
router.get("/me", (req, res) => {
  if (!req.session.githubUser) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  return res.json({
    username: req.session.githubUser.username,
    avatarUrl: req.session.githubUser.avatarUrl,
  });
});

// POST /auth/logout — clear session
router.post("/logout", (req, res) => {
  const username = req.session.githubUser?.username;
  if (username) {
    tokenStore.delete(username);
  }

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Failed to logout" });
    }
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out" });
  });
});

export default router;
