import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import {
  createProject,
  getProjectsByUser,
  getProjectById,
  getConnectionsByProject,
} from "../db/projects";

const router = Router();

// GET /api/projects — returns all projects for the current user
router.get("/", requireAuth, (req, res) => {
  const projects = getProjectsByUser(req.session.userId!);

  const result = projects.map((project) => {
    const connections = getConnectionsByProject(project.id);
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
  });

  return res.json(result);
});

// POST /api/projects — creates a new project
router.post("/", requireAuth, (req, res) => {
  const { name, description } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ message: "Project name is required" });
  }

  const project = createProject(
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

// GET /api/projects/:id — returns a single project with platform connections
router.get("/:id", requireAuth, (req, res) => {
  const projectId = parseInt(req.params.id as string, 10);
  if (isNaN(projectId)) {
    return res.status(400).json({ message: "Invalid project ID" });
  }

  const project = getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ message: "Project not found" });
  }

  // Ensure the project belongs to the current user
  if (project.user_id !== req.session.userId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const connections = getConnectionsByProject(project.id);

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
