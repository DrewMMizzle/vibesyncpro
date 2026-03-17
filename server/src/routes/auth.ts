import { Router } from "express";
import crypto from "crypto";
import { storage } from "../../storage";

const router = Router();

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const SCOPES = "repo read:user";

const ALLOWED_REDIRECTS = ["/onboard", "/dashboard"];

declare module "express-session" {
  interface SessionData {
    oauthState?: string;
    postAuthRedirect?: string;
  }
}

router.get("/github", (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ message: "GitHub OAuth is not configured" });
  }

  const callbackUrl =
    process.env.GITHUB_CALLBACK_URL || "http://localhost:5000/auth/github/callback";

  const redirect = req.query.redirect as string | undefined;
  if (redirect && ALLOWED_REDIRECTS.includes(redirect)) {
    req.session.postAuthRedirect = redirect;
  }

  const state = crypto.randomBytes(32).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: SCOPES,
    state,
  });

  req.session.save((err) => {
    if (err) {
      console.error("Failed to save session before OAuth redirect:", err);
      return res.status(500).json({ message: "Session error" });
    }
    return res.redirect(`${GITHUB_AUTH_URL}?${params.toString()}`);
  });
});

router.get("/github/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code) {
    return res.status(400).json({ message: "Missing code parameter" });
  }

  if (!state || state !== req.session.oauthState) {
    return res.status(403).json({ message: "Invalid OAuth state" });
  }
  delete req.session.oauthState;

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ message: "GitHub OAuth is not configured" });
  }

  const callbackUrl =
    process.env.GITHUB_CALLBACK_URL || "http://localhost:5000/auth/github/callback";

  const OAUTH_TIMEOUT_MS = 10_000;

  try {
    const oauthController = new AbortController();
    const oauthTimeout = setTimeout(() => oauthController.abort(), OAUTH_TIMEOUT_MS);

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(GITHUB_TOKEN_URL, {
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
        signal: oauthController.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.error("OAuth token exchange timed out");
        return res.redirect("/?error=oauth_timeout");
      }
      throw err;
    } finally {
      clearTimeout(oauthTimeout);
    }

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

    const userController = new AbortController();
    const userTimeout = setTimeout(() => userController.abort(), OAUTH_TIMEOUT_MS);

    let userResponse: Response;
    try {
      userResponse = await fetch(GITHUB_USER_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        signal: userController.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.error("GitHub user info fetch timed out");
        return res.redirect("/?error=oauth_timeout");
      }
      throw err;
    } finally {
      clearTimeout(userTimeout);
    }

    if (!userResponse.ok) {
      return res.status(502).json({ message: "Failed to fetch GitHub user info" });
    }

    const userData = (await userResponse.json()) as {
      id: number;
      login: string;
      avatar_url: string;
    };

    const user = await storage.upsertUser(
      String(userData.id),
      userData.login,
      userData.avatar_url,
      accessToken,
    );

    req.session.userId = user.id;

    const postAuthRedirect = req.session.postAuthRedirect;
    delete req.session.postAuthRedirect;
    const redirectTo = postAuthRedirect && ALLOWED_REDIRECTS.includes(postAuthRedirect)
      ? postAuthRedirect
      : "/dashboard";

    return res.redirect(redirectTo);
  } catch (error) {
    console.error("GitHub OAuth callback error:", error);
    return res.status(500).json({ message: "Internal server error during OAuth" });
  }
});

router.get("/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  const user = await storage.findUserById(req.session.userId);
  if (!user) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  return res.json({
    id: user.id,
    username: user.username,
    avatarUrl: user.avatar_url,
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Failed to logout" });
    }
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out" });
  });
});

export default router;
