import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getQueryFn, queryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Plus, Trash2, Monitor, Bot, Globe, ChevronDown,
} from "lucide-react";

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
  created_at: string | null;
  updated_at: string | null;
  platform_connections: Connection[];
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

const ALL_PLATFORMS: Platform[] = ["replit", "claude_code", "computer"];
const ALL_STATUSES: Status[] = ["disconnected", "connected", "synced", "drifted", "conflict"];

export default function ProjectPage() {
  const [, params] = useRoute("/projects/:id");
  const [, navigate] = useLocation();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [showAddModal, setShowAddModal] = useState(false);
  const [addPlatform, setAddPlatform] = useState<Platform>("replit");
  const [addBranch, setAddBranch] = useState("");

  const projectId = params?.id ? parseInt(params.id, 10) : null;

  const { data: project, isLoading } = useQuery<ProjectDetail>({
    queryKey: ["/api/projects", projectId],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId && isLoggedIn,
  });

  useEffect(() => {
    if (!authLoading && !isLoggedIn) navigate("/");
  }, [authLoading, isLoggedIn, navigate]);

  const addConnection = useMutation({
    mutationFn: async ({ platform, branch_name }: { platform: Platform; branch_name: string | null }) => {
      const res = await fetch(`/api/projects/${projectId}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ platform, branch_name }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to add connection");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      setShowAddModal(false);
      setAddBranch("");
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ connId, status }: { connId: number; status: Status }) => {
      const res = await fetch(`/api/projects/${projectId}/connections/${connId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    },
  });

  const deleteConnection = useMutation({
    mutationFn: async (connId: number) => {
      const res = await fetch(`/api/projects/${projectId}/connections/${connId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove connection");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
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

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Platform Connections
          </h2>
          {availablePlatforms.length > 0 && (
            <button
              data-testid="button-add-connection"
              onClick={() => {
                setAddPlatform(availablePlatforms[0]);
                setShowAddModal(true);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-foreground text-background hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Platform
            </button>
          )}
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
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Branch: {conn.branch_name}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <select
                        data-testid={`select-status-${conn.id}`}
                        value={conn.status}
                        onChange={(e) =>
                          updateStatus.mutate({ connId: conn.id, status: e.target.value as Status })
                        }
                        className={`appearance-none pl-3 pr-8 py-1.5 rounded-full text-xs font-medium cursor-pointer border-0 focus:outline-none focus:ring-2 focus:ring-foreground/20 ${STATUS_STYLES[conn.status]}`}
                      >
                        {ALL_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
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

      {/* Add connection modal */}
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
                      Branch name <span className="text-muted-foreground/50">(optional)</span>
                    </label>
                    <input
                      data-testid="input-branch-name"
                      type="text"
                      value={addBranch}
                      onChange={(e) => setAddBranch(e.target.value)}
                      placeholder="main"
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
                    />
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
