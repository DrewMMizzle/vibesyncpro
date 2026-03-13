import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Plus, Trash2, Monitor, Bot, Globe, RefreshCw, GitBranch,
  Search, Lock, Unlock, ExternalLink, GitMerge, ArrowDownToLine, Zap, AlertTriangle,
  Eye, EyeOff, Send, FolderGit2, ChevronDown, ChevronRight, Pencil, Check, X, Settings,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Platform = "replit" | "claude_code" | "computer";
type Status = "disconnected" | "connected" | "synced" | "drifted" | "conflict";

interface Connection {
  id: number;
  platform: Platform;
  branch_name: string | null;
  status: Status;
  ahead_by: number;
  behind_by: number;
  last_synced_at: string | null;
}

interface ProjectDetail {
  id: number;
  name: string;
  description: string | null;
  github_repo_url: string | null;
  github_repo_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  platform_connections: Connection[];
}

interface DiscoveredBranchItem {
  id: number;
  branch_name: string;
  likely_platform: string | null;
  ahead_by_default: number;
  behind_by_default: number;
  ahead_by_parent: number;
  behind_by_parent: number;
  last_commit_sha: string | null;
  last_commit_at: string | null;
  dismissed_at: string | null;
  last_seen_at: string | null;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  default_branch: string;
  html_url: string;
  private: boolean;
}

interface GitHubBranch {
  name: string;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  replit: "Replit",
  claude_code: "Claude Code",
  computer: "Computer",
};

const PLATFORM_ICONS: Record<Platform, React.ReactNode> = {
  replit: <Globe className="w-5 h-5" />,
  claude_code: <Bot className="w-5 h-5" />,
  computer: <Monitor className="w-5 h-5" />,
};

const STATUS_STYLES: Record<Status, string> = {
  disconnected: "bg-muted text-muted-foreground",
  connected: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  synced: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  drifted: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  conflict: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const STATUS_LABELS: Record<Status, string> = {
  disconnected: "Disconnected",
  connected: "Connected",
  synced: "Synced",
  drifted: "Drifted",
  conflict: "Conflict",
};

const ALL_PLATFORMS: Platform[] = ["replit", "claude_code", "computer"];

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ProjectPage() {
  const [, params] = useRoute("/projects/:id");
  const [, navigate] = useLocation();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRepoModal, setShowRepoModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [addPlatform, setAddPlatform] = useState<Platform>("replit");
  const [addBranch, setAddBranch] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const { toast } = useToast();

  const projectId = params?.id ? parseInt(params.id, 10) : null;

  const { data: project, isLoading } = useQuery<ProjectDetail>({
    queryKey: ["/api/projects", projectId],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId && isLoggedIn,
  });

  const { data: repos, isLoading: reposLoading } = useQuery<GitHubRepo[]>({
    queryKey: ["/api/github/repos"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: showRepoModal && isLoggedIn,
  });

  const repoName = project?.github_repo_name;
  const [owner, repo] = repoName ? repoName.split("/") : [null, null];

  const { data: branches, isLoading: branchesLoading, isError: branchesError } = useQuery<GitHubBranch[]>({
    queryKey: ["/api/github/repos", owner, repo, "branches"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: showAddModal && !!owner && !!repo && isLoggedIn,
  });

  useEffect(() => {
    if (!authLoading && !isLoggedIn) navigate("/");
  }, [authLoading, isLoggedIn, navigate]);

  const linkRepo = useMutation({
    mutationFn: async (repoData: GitHubRepo) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}`, {
        github_repo_url: repoData.html_url,
        github_repo_name: repoData.full_name,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowRepoModal(false);
      toast({ title: "Repository linked" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to link repo", description: err.message, variant: "destructive" });
    },
  });

  const unlinkRepo = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}`, {
        github_repo_url: null,
        github_repo_name: null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Repository unlinked" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to unlink repo", description: err.message, variant: "destructive" });
    },
  });

  const addConnection = useMutation({
    mutationFn: async ({ platform, branch_name }: { platform: Platform; branch_name: string | null }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/connections`, { platform, branch_name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowAddModal(false);
      setAddBranch("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add platform", description: err.message, variant: "destructive" });
    },
  });

  const deleteConnection = useMutation({
    mutationFn: async (connId: number) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/connections/${connId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove platform", description: err.message, variant: "destructive" });
    },
  });

  const syncStatus = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/sync`);
      return res.json();
    },
    onSuccess: (data: { synced: boolean; errors?: Array<{ platform: string; error: string }> }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "branches", "discovered"] });
      if (data.synced) {
        toast({ title: "Sync complete", description: "All branch statuses updated" });
      } else {
        const failedPlatforms = data.errors?.map((e) => e.platform).join(", ") ?? "unknown";
        toast({ title: "Partial sync", description: `Some platforms failed to sync: ${failedPlatforms}`, variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const updateProject = useMutation({
    mutationFn: async (fields: { name?: string; description?: string | null }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}`, fields);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setEditingName(false);
      setEditingDesc(false);
      toast({ title: "Project updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const deleteProject = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/projects/${projectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project deleted" });
      navigate("/dashboard");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete project", description: err.message, variant: "destructive" });
    },
  });

  const [conflictInfo, setConflictInfo] = useState<{ connId: number; url: string } | null>(null);

  const resolveConnection = useMutation({
    mutationFn: async ({ connId, action }: { connId: number; action: "merge_to_default" | "update_from_default" }) => {
      const res = await fetch(`/api/projects/${projectId}/connections/${connId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json();
        if (res.status === 409 && body.conflict_url) {
          const error = new Error(body.message) as Error & { conflict_url: string };
          error.conflict_url = body.conflict_url;
          throw error;
        }
        throw new Error(body.message || "Resolve failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      syncStatus.mutate();
      toast({ title: "Resolved", description: "Branches merged successfully" });
      setConflictInfo(null);
    },
    onError: (err: Error & { conflict_url?: string }, variables) => {
      if (err.conflict_url) {
        setConflictInfo({ connId: variables.connId, url: err.conflict_url });
        toast({
          title: "Conflict detected",
          description: "These branches edited the same files differently. Open in GitHub to resolve.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Resolve failed", description: err.message, variant: "destructive" });
      }
    },
  });

  const [showDiscovered, setShowDiscovered] = useState(false);
  const [hasAutoExpanded, setHasAutoExpanded] = useState(false);
  const [triageConflictInfo, setTriageConflictInfo] = useState<{ branchName: string; url: string } | null>(null);

  const { data: discoveredData } = useQuery<{ discovered_branches: DiscoveredBranchItem[] }>({
    queryKey: ["/api/projects", projectId, "branches", "discovered"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId && isLoggedIn && !!project?.github_repo_name,
  });

  const discoveredBranches = discoveredData?.discovered_branches ?? [];

  useEffect(() => {
    if (discoveredBranches.length > 0 && !hasAutoExpanded) {
      setShowDiscovered(true);
      setHasAutoExpanded(true);
    }
  }, [discoveredBranches.length, hasAutoExpanded]);

  const scanBranches = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/branches/scan`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "branches", "discovered"] });
      toast({ title: "Scan complete", description: "Branch scan finished" });
    },
    onError: (err: Error) => {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    },
  });

  const triageBranch = useMutation({
    mutationFn: async ({ branchName, action, platform_branch }: { branchName: string; action: "merge_to_default" | "merge_to_platform" | "assign_to_replit" | "dismiss"; platform_branch?: string }) => {
      const res = await fetch(`/api/projects/${projectId}/branches/${encodeURIComponent(branchName)}/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, platform_branch }),
      });
      if (!res.ok) {
        const body = await res.json();
        if (res.status === 409 && body.conflict_url) {
          const error = new Error(body.message) as Error & { conflict_url: string };
          error.conflict_url = body.conflict_url;
          throw error;
        }
        throw new Error(body.message || "Triage failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "branches", "discovered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: "Done", description: "Action completed successfully" });
      setTriageConflictInfo(null);
      scanBranches.mutate();
    },
    onError: (err: Error & { conflict_url?: string }, variables) => {
      if (err.conflict_url) {
        setTriageConflictInfo({ branchName: variables.branchName, url: err.conflict_url });
        toast({
          title: "Conflict detected",
          description: "These branches edited the same files differently.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Action failed", description: err.message, variant: "destructive" });
      }
    },
  });

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isLoggedIn) return null;

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  const connectedPlatforms = new Set(project.platform_connections.map((c) => c.platform));
  const availablePlatforms = ALL_PLATFORMS.filter((p) => !connectedPlatforms.has(p));
  const filteredRepos = repos?.filter((r) =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  ) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 sm:px-8 py-4 flex items-center justify-between">
        <button
          data-testid="button-back"
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </button>
        <span className="text-sm font-medium tracking-wide text-muted-foreground/50 select-none">
          VibeSyncPro
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-6 sm:px-8 py-12">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                data-testid="input-edit-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editName.trim()) {
                    updateProject.mutate({ name: editName.trim() });
                  } else if (e.key === "Escape") {
                    setEditingName(false);
                  }
                }}
                className="text-3xl font-light text-foreground bg-transparent border-b-2 border-foreground/20 focus:border-foreground/50 outline-none w-full"
                autoFocus
              />
              <button
                data-testid="button-save-name"
                onClick={() => editName.trim() && updateProject.mutate({ name: editName.trim() })}
                disabled={updateProject.isPending || !editName.trim()}
                className="text-green-600 hover:text-green-700 disabled:opacity-50"
              >
                <Check className="w-5 h-5" />
              </button>
              <button
                data-testid="button-cancel-name"
                onClick={() => setEditingName(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="group flex items-center gap-2">
              <h1 data-testid="text-project-name" className="text-3xl font-light text-foreground mb-1">
                {project.name}
              </h1>
              <button
                data-testid="button-edit-name"
                onClick={() => { setEditName(project.name); setEditingName(true); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}

          {editingDesc ? (
            <div className="flex items-start gap-2 mt-2">
              <textarea
                data-testid="input-edit-description"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    updateProject.mutate({ description: editDesc.trim() || null });
                  } else if (e.key === "Escape") {
                    setEditingDesc(false);
                  }
                }}
                rows={2}
                className="text-muted-foreground bg-transparent border-b-2 border-foreground/20 focus:border-foreground/50 outline-none w-full resize-none"
                autoFocus
              />
              <button
                data-testid="button-save-description"
                onClick={() => updateProject.mutate({ description: editDesc.trim() || null })}
                disabled={updateProject.isPending}
                className="text-green-600 hover:text-green-700 disabled:opacity-50 mt-1"
              >
                <Check className="w-5 h-5" />
              </button>
              <button
                data-testid="button-cancel-description"
                onClick={() => setEditingDesc(false)}
                className="text-muted-foreground hover:text-foreground mt-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="group flex items-center gap-2 mt-2">
              <p data-testid="text-project-description" className="text-muted-foreground">
                {project.description || "No description"}
              </p>
              <button
                data-testid="button-edit-description"
                onClick={() => { setEditDesc(project.description ?? ""); setEditingDesc(true); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
        </motion.div>

        {/* GitHub Repo Section */}
        <div className="mb-10">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            GitHub Repository
          </h2>
          {project.github_repo_name ? (
            <div className="border border-border rounded-lg p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <GitBranch className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <a
                      href={project.github_repo_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="link-github-repo"
                      className="font-medium text-foreground hover:underline flex items-center gap-1.5"
                    >
                      {project.github_repo_name}
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                    </a>
                  </div>
                </div>
                <button
                  data-testid="button-unlink-repo"
                  onClick={() => unlinkRepo.mutate()}
                  disabled={unlinkRepo.isPending}
                  className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
                >
                  Unlink
                </button>
              </div>
            </div>
          ) : (
            <button
              data-testid="button-link-repo"
              onClick={() => {
                setRepoSearch("");
                setShowRepoModal(true);
              }}
              className="w-full border border-dashed border-border rounded-lg p-5 text-center hover:border-foreground/30 transition-colors group"
            >
              <GitBranch className="w-6 h-6 mx-auto text-muted-foreground/50 group-hover:text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground group-hover:text-foreground">
                Link a GitHub repository to enable branch sync
              </p>
            </button>
          )}
        </div>

        {/* Platform Connections Section */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Platform Connections
          </h2>
          <div className="flex items-center gap-2">
            {project.github_repo_name && project.platform_connections.length > 0 && (
              <button
                data-testid="button-sync"
                onClick={() => syncStatus.mutate()}
                disabled={syncStatus.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncStatus.isPending ? "animate-spin" : ""}`} />
                {syncStatus.isPending ? "Syncing..." : "Refresh Sync"}
              </button>
            )}
            {availablePlatforms.length > 0 && (
              <button
                data-testid="button-add-connection"
                onClick={() => {
                  setAddPlatform(availablePlatforms[0]);
                  setAddBranch("");
                  setShowAddModal(true);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-foreground text-background hover:opacity-90 transition-opacity"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Platform
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {project.platform_connections.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 border border-dashed border-border rounded-lg"
            >
              <p className="text-muted-foreground text-sm">
                No platforms connected yet. Add one to start tracking sync status.
              </p>
            </motion.div>
          )}

          <AnimatePresence>
            {project.platform_connections.map((conn) => {
              const isAhead = conn.status === "drifted" && conn.ahead_by > 0 && conn.behind_by === 0;
              const isBehind = conn.status === "drifted" && conn.behind_by > 0 && conn.ahead_by === 0;
              const isConflict = conn.status === "conflict";
              const showResolution = isAhead || isBehind || isConflict;
              const isResolving = resolveConnection.isPending;

              return (
                <motion.div
                  key={conn.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  data-testid={`card-connection-${conn.id}`}
                  className="border border-border rounded-lg p-5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">
                        {PLATFORM_ICONS[conn.platform]}
                      </span>
                      <div>
                        <span data-testid={`text-platform-${conn.id}`} className="font-medium text-foreground">
                          {PLATFORM_LABELS[conn.platform]}
                        </span>
                        {conn.branch_name && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <GitBranch className="w-3 h-3" />
                            {conn.branch_name}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span
                          data-testid={`badge-status-${conn.id}`}
                          className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[conn.status]}`}
                        >
                          {STATUS_LABELS[conn.status]}
                        </span>
                        {conn.last_synced_at && (
                          <p data-testid={`text-synced-at-${conn.id}`} className="text-[10px] text-muted-foreground/60 mt-1">
                            {timeAgo(conn.last_synced_at)}
                          </p>
                        )}
                      </div>

                      <button
                        data-testid={`button-delete-connection-${conn.id}`}
                        onClick={() => deleteConnection.mutate(conn.id)}
                        disabled={deleteConnection.isPending}
                        className="text-muted-foreground/40 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {showResolution && (
                    <div data-testid={`resolution-${conn.id}`} className="mt-4 pt-4 border-t border-border">
                      {isAhead && (
                        <div className="flex items-start justify-between gap-3">
                          <p data-testid={`text-resolution-${conn.id}`} className="text-sm text-muted-foreground">
                            This agent has {conn.ahead_by} new {conn.ahead_by === 1 ? "commit" : "commits"} ready to add to your project.
                          </p>
                          <button
                            data-testid={`button-merge-to-default-${conn.id}`}
                            onClick={() => resolveConnection.mutate({ connId: conn.id, action: "merge_to_default" })}
                            disabled={isResolving}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            <GitMerge className="w-3.5 h-3.5" />
                            {isResolving ? "Merging..." : "Merge to main"}
                          </button>
                        </div>
                      )}

                      {isBehind && (
                        <div className="flex items-start justify-between gap-3">
                          <p data-testid={`text-resolution-${conn.id}`} className="text-sm text-muted-foreground">
                            Your project has {conn.behind_by} new {conn.behind_by === 1 ? "commit" : "commits"} that this agent's branch doesn't have yet.
                          </p>
                          <button
                            data-testid={`button-update-from-default-${conn.id}`}
                            onClick={() => resolveConnection.mutate({ connId: conn.id, action: "update_from_default" })}
                            disabled={isResolving}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            <ArrowDownToLine className="w-3.5 h-3.5" />
                            {isResolving ? "Updating..." : "Update branch"}
                          </button>
                        </div>
                      )}

                      {isConflict && (
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <p data-testid={`text-resolution-${conn.id}`} className="text-sm text-muted-foreground">
                              Both your project ({conn.behind_by} {conn.behind_by === 1 ? "commit" : "commits"}) and this agent ({conn.ahead_by} {conn.ahead_by === 1 ? "commit" : "commits"}) have new changes that need to be combined.
                            </p>
                            <button
                              data-testid={`button-auto-resolve-${conn.id}`}
                              onClick={() => resolveConnection.mutate({ connId: conn.id, action: "merge_to_default" })}
                              disabled={isResolving}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-yellow-600 text-white hover:bg-yellow-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                            >
                              <Zap className="w-3.5 h-3.5" />
                              {isResolving ? "Resolving..." : "Auto-resolve"}
                            </button>
                          </div>

                          {conflictInfo && conflictInfo.connId === conn.id && (
                            <div data-testid={`conflict-message-${conn.id}`} className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                <div>
                                  <p className="text-sm text-red-700 dark:text-red-300">
                                    These branches edited the same files differently. You'll need to resolve the conflicts on GitHub.
                                  </p>
                                  <a
                                    href={conflictInfo.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    data-testid={`link-conflict-${conn.id}`}
                                    className="inline-flex items-center gap-1.5 mt-2 text-sm font-medium text-red-600 dark:text-red-400 hover:underline"
                                  >
                                    Open in GitHub
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Discovered Branches Section */}
        {project.github_repo_name && (
          <div className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <button
                data-testid="button-toggle-discovered"
                onClick={() => setShowDiscovered(!showDiscovered)}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
              >
                {showDiscovered ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                Discovered Branches
                {discoveredBranches.length > 0 && (
                  <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                    {discoveredBranches.length}
                  </span>
                )}
              </button>
              <button
                data-testid="button-scan-branches"
                onClick={() => scanBranches.mutate()}
                disabled={scanBranches.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 transition-all disabled:opacity-50"
              >
                <Search className={`w-3.5 h-3.5 ${scanBranches.isPending ? "animate-spin" : ""}`} />
                {scanBranches.isPending ? "Scanning..." : "Scan for branches"}
              </button>
            </div>

            <AnimatePresence>
              {showDiscovered && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-3 overflow-hidden"
                >
                  {discoveredBranches.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-border rounded-lg">
                      <FolderGit2 className="w-6 h-6 mx-auto text-muted-foreground/40 mb-2" />
                      <p data-testid="text-no-discovered" className="text-muted-foreground text-sm">
                        No extra branches found. Click "Scan for branches" to check.
                      </p>
                    </div>
                  ) : (
                    discoveredBranches.map((branch) => {
                      const platformLabel = branch.likely_platform
                        ? PLATFORM_LABELS[branch.likely_platform as Platform] ?? branch.likely_platform
                        : "unknown";
                      const hasReplit = project.platform_connections.some((c) => c.platform === "replit");
                      const likelyConn = branch.likely_platform
                        ? project.platform_connections.find((c) => c.platform === branch.likely_platform)
                        : null;
                      const isTriaging = triageBranch.isPending;

                      return (
                        <motion.div
                          key={branch.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          data-testid={`card-discovered-${branch.id}`}
                          className="border border-violet-200 dark:border-violet-800 rounded-lg p-5 bg-violet-50/30 dark:bg-violet-950/20"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <GitBranch className="w-4 h-4 text-violet-500 flex-shrink-0" />
                                <span data-testid={`text-discovered-name-${branch.id}`} className="font-medium text-foreground truncate">
                                  {branch.branch_name}
                                </span>
                              </div>

                              <p data-testid={`text-discovered-platform-${branch.id}`} className="text-xs text-muted-foreground mt-1 ml-6">
                                {branch.likely_platform
                                  ? `Looks like it came from your ${PLATFORM_LABELS[branch.likely_platform as Platform] ?? branch.likely_platform} agent`
                                  : "Origin unknown — not clearly linked to any connected agent"}
                              </p>

                              <p data-testid={`text-discovered-commits-${branch.id}`} className="text-sm text-muted-foreground mt-2 ml-6">
                                {branch.ahead_by_default > 0
                                  ? `${branch.ahead_by_default} new ${branch.ahead_by_default === 1 ? "commit" : "commits"} not yet in your project`
                                  : "No new commits ahead of your project"}
                                {branch.behind_by_default > 0 && ` · ${branch.behind_by_default} ${branch.behind_by_default === 1 ? "commit" : "commits"} behind`}
                              </p>

                              {branch.likely_platform && (
                                <p data-testid={`text-discovered-parent-${branch.id}`} className="text-xs text-muted-foreground mt-1 ml-6">
                                  vs {PLATFORM_LABELS[branch.likely_platform as Platform] ?? branch.likely_platform} branch: {branch.ahead_by_parent} ahead, {branch.behind_by_parent} behind
                                </p>
                              )}

                              {branch.last_commit_at && (
                                <p data-testid={`text-discovered-lastcommit-${branch.id}`} className="text-[10px] text-muted-foreground/50 mt-1 ml-6">
                                  Last commit {timeAgo(branch.last_commit_at)}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mt-4 ml-6 flex-wrap">
                            <button
                              data-testid={`button-triage-merge-default-${branch.id}`}
                              onClick={() => triageBranch.mutate({ branchName: branch.branch_name, action: "merge_to_default" })}
                              disabled={isTriaging}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                            >
                              <GitMerge className="w-3 h-3" />
                              {isTriaging ? "..." : "Merge to main"}
                            </button>

                            {hasReplit && (
                              <button
                                data-testid={`button-triage-assign-replit-${branch.id}`}
                                onClick={() => triageBranch.mutate({ branchName: branch.branch_name, action: "assign_to_replit" })}
                                disabled={isTriaging}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                              >
                                <Send className="w-3 h-3" />
                                {isTriaging ? "..." : "Send to Replit"}
                              </button>
                            )}

                            {likelyConn && likelyConn.branch_name && (
                              <button
                                data-testid={`button-triage-merge-platform-${branch.id}`}
                                onClick={() => triageBranch.mutate({ branchName: branch.branch_name, action: "merge_to_platform", platform_branch: likelyConn.branch_name! })}
                                disabled={isTriaging}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
                              >
                                <ArrowDownToLine className="w-3 h-3" />
                                {isTriaging ? "..." : `Merge into ${platformLabel} branch`}
                              </button>
                            )}

                            <button
                              data-testid={`button-triage-dismiss-${branch.id}`}
                              onClick={() => triageBranch.mutate({ branchName: branch.branch_name, action: "dismiss" })}
                              disabled={isTriaging}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 transition-all disabled:opacity-50"
                            >
                              <EyeOff className="w-3 h-3" />
                              Dismiss
                            </button>
                          </div>

                          {triageConflictInfo && triageConflictInfo.branchName === branch.branch_name && (
                            <div data-testid={`conflict-triage-${branch.id}`} className="mt-3 ml-6 p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                <div>
                                  <p className="text-sm text-red-700 dark:text-red-300">
                                    These branches edited the same files differently. You'll need to resolve the conflicts on GitHub.
                                  </p>
                                  <a
                                    href={triageConflictInfo.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    data-testid={`link-triage-conflict-${branch.id}`}
                                    className="inline-flex items-center gap-1.5 mt-2 text-sm font-medium text-red-600 dark:text-red-400 hover:underline"
                                  >
                                    Open in GitHub
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      );
                    })
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {/* Danger Zone */}
        <div className="mt-16 pt-8 border-t border-red-200 dark:border-red-900">
          <h2 className="text-sm font-medium text-red-600 dark:text-red-400 uppercase tracking-wider mb-4">
            Danger Zone
          </h2>
          <div className="border border-red-200 dark:border-red-900 rounded-lg p-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Delete this project</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                This will permanently remove this project, all connected platforms, and discovered branches.
              </p>
            </div>
            <button
              data-testid="button-delete-project"
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black z-40"
              onClick={() => !deleteProject.isPending && setShowDeleteConfirm(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-background border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground">Delete project?</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  Are you sure you want to delete <strong>{project.name}</strong>? This action cannot be undone. All connected platforms and discovered branches will also be removed.
                </p>
                <div className="flex gap-3">
                  <button
                    data-testid="button-cancel-delete"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleteProject.isPending}
                    className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    data-testid="button-confirm-delete"
                    onClick={() => deleteProject.mutate()}
                    disabled={deleteProject.isPending}
                    className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {deleteProject.isPending ? "Deleting..." : "Delete permanently"}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Link Repo Modal */}
      <AnimatePresence>
        {showRepoModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black z-40"
              onClick={() => setShowRepoModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md shadow-xl max-h-[80vh] flex flex-col">
                <h3 className="text-lg font-medium text-foreground mb-4">Link GitHub Repository</h3>

                <div className="relative mb-4">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    data-testid="input-repo-search"
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search repositories..."
                    className="w-full border border-border rounded-lg pl-9 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
                    autoFocus
                  />
                </div>

                <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
                  {reposLoading ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Loading repos...</p>
                  ) : filteredRepos.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No repos found</p>
                  ) : (
                    filteredRepos.map((r) => (
                      <button
                        key={r.full_name}
                        data-testid={`button-repo-${r.full_name}`}
                        onClick={() => linkRepo.mutate(r)}
                        disabled={linkRepo.isPending}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted transition-colors flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {r.private ? (
                            <Lock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          ) : (
                            <Unlock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          )}
                          <span className="text-sm text-foreground truncate">{r.full_name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground/50 group-hover:text-muted-foreground flex-shrink-0 ml-2">
                          {r.default_branch}
                        </span>
                      </button>
                    ))
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-border">
                  <button
                    data-testid="button-cancel-repo"
                    onClick={() => setShowRepoModal(false)}
                    className="w-full px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add Platform Connection Modal */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black z-40"
              onClick={() => setShowAddModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-background border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
                <h3 className="text-lg font-medium text-foreground mb-5">Add Platform</h3>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1.5 block">Platform</label>
                    <select
                      data-testid="select-add-platform"
                      value={addPlatform}
                      onChange={(e) => setAddPlatform(e.target.value as Platform)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
                    >
                      {availablePlatforms.map((p) => (
                        <option key={p} value={p}>
                          {PLATFORM_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-1.5 block">
                      Branch {!project.github_repo_name && <span className="text-muted-foreground/50">(link a repo first for branch picker)</span>}
                    </label>
                    {project.github_repo_name && branchesLoading ? (
                      <p className="text-sm text-muted-foreground py-2">Loading branches...</p>
                    ) : project.github_repo_name && branchesError ? (
                      <p className="text-sm text-red-500 py-2">Failed to load branches. Check your repo access.</p>
                    ) : project.github_repo_name && branches ? (
                      <select
                        data-testid="select-branch"
                        value={addBranch}
                        onChange={(e) => setAddBranch(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
                      >
                        <option value="">Select a branch...</option>
                        {branches.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        data-testid="input-branch-name"
                        type="text"
                        value={addBranch}
                        onChange={(e) => setAddBranch(e.target.value)}
                        placeholder="e.g. replit-agent-branch"
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
                      />
                    )}
                  </div>
                </div>

                {addConnection.error && (
                  <p className="text-sm text-red-500 mt-3">
                    {(addConnection.error as Error).message}
                  </p>
                )}

                <div className="flex gap-3 mt-6">
                  <button
                    data-testid="button-cancel-add"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    data-testid="button-confirm-add"
                    onClick={() =>
                      addConnection.mutate({
                        platform: addPlatform,
                        branch_name: addBranch.trim() || null,
                      })
                    }
                    disabled={addConnection.isPending || (!!project.github_repo_name && !addBranch.trim())}
                    className="flex-1 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {addConnection.isPending ? "Adding..." : "Add"}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
