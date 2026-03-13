import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Plus, Trash2, Monitor, Bot, Globe, RefreshCw, GitBranch,
  Search, Lock, Unlock, ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Platform = "replit" | "claude_code" | "computer";
type Status = "disconnected" | "connected" | "synced" | "drifted" | "conflict";

interface Connection {
  id: number;
  platform: Platform;
  branch_name: string | null;
  status: Status;
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
  const [addPlatform, setAddPlatform] = useState<Platform>("replit");
  const [addBranch, setAddBranch] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({ title: "Sync complete", description: "Branch statuses updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
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
          <h1 data-testid="text-project-name" className="text-3xl font-light text-foreground mb-1">
            {project.name}
          </h1>
          {project.description && (
            <p data-testid="text-project-description" className="text-muted-foreground mt-2">
              {project.description}
            </p>
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
            {project.platform_connections.map((conn) => (
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
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </main>

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
                    disabled={addConnection.isPending}
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
