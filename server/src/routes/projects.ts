import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { storage } from "../../storage";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const projects = await storage.getProjectsByUser(req.session.userId!);

  const result = await Promise.all(
    projects.map(async (project) => {
      const connections = await storage.getConnectionsByProject(project.id);
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        github_repo_url: project.github_repo_url,
        github_repo_name: project.github_repo_name,
        created_at: project.created_at,
        platform_connections: connections.map((c) => ({
          id: c.id,
          platform: c.platform,
          branch_name: c.branch_name,
          status: c.status,
          last_synced_at: c.last_synced_at,
        })),
      };
    })
  );

  return res.json(result);
});

router.post("/", requireAuth, async (req, res) => {
  const { name, description } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ message: "Project name is required" });
  }

  const project = await storage.createProject(
    req.session.userId!,
    name.trim(),
    description?.trim() || null,
  );

  return res.status(201).json({
    id: project.id,
    name: project.name,
    description: project.description,
    github_repo_url: project.github_repo_url,
    github_repo_name: project.github_repo_name,
    created_at: project.created_at,
    platform_connections: [],
  });
});

router.get("/:id", requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ message: "Invalid project ID" });
  }

  const project = await storage.getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ message: "Project not found" });
  }

  if (project.user_id !== req.session.userId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const connections = await storage.getConnectionsByProject(project.id);

  return res.json({
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
      status: c.status,
      last_synced_at: c.last_synced_at,
    })),
  });
});

export default router;
