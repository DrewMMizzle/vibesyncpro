import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { storage } from "../../storage";

const router = Router();

router.get("/me", requireAuth, async (req, res) => {
  const user = await storage.findUserById(req.session.userId!);
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
