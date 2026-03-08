import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { findUserById } from "../db/users";

const router = Router();

// GET /api/me — returns current authenticated user
router.get("/me", requireAuth, (req, res) => {
  const user = findUserById(req.session.userId!);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json({
    id: user.id,
    username: user.username,
    avatar_url: user.avatar_url,
    created_at: user.created_at,
  });
});

export default router;
