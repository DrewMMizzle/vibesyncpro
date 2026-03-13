import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { getQueryFn } from "@/lib/queryClient";
import {
  LogOut, FolderOpen, Plus, Globe, Bot, Monitor,
  AlertTriangle, CheckCircle2, Clock,
} from "lucide-react";
import { motion } from "framer-motion";

type Status = "disconnected" | "connected" | "synced" | "drifted" | "conflict";

interface ConnectionItem {
  id: number;
  platform: string;
  status: Status;
  last_synced_at: string | null;
}

interface ProjectItem {
  id: number;
  name: string;
  description: string | null;
  created_at: string | null;
  platform_connections: ConnectionItem[];
}

const PLATFORM_ICONS: Record<string, typeof Globe> = {
  replit: Globe,
  claude_code: Bot,
  computer: Monitor,
};

const STATUS_DOT: Record<Status, string> = {
  synced: "bg-green-500",
  connected: "bg-blue-500",
  drifted: "bg-yellow-500",
  conflict: "bg-red-500",
  disconnected: "bg-muted-foreground/30",
};

const STATUS_LABEL: Record<Status, string> = {
  synced: "Synced",
  connected: "Connected",
  drifted: "Drifted",
  conflict: "Conflict",
  disconnected: "Disconnected",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getLatestSync(connections: ConnectionItem[]): string | null {
  let latest: string | null = null;
  for (const c of connections) {
    if (c.last_synced_at && (!latest || c.last_synced_at > latest)) {
      latest = c.last_synced_at;
    }
  }
  return latest;
}

function getWorstStatus(connections: ConnectionItem[]): Status | null {
  if (connections.length === 0) return null;
  const priority: Status[] = ["conflict", "drifted", "disconnected", "connected", "synced"];
  for (const s of priority) {
    if (connections.some((c) => c.status === s)) return s;
  }
  return null;
}

export default function Dashboard() {
  const { user, isLoading: authLoading, isLoggedIn } = useAuth();
  const [, navigate] = useLocation();

  const { data: projects, isLoading: projectsLoading } = useQuery<ProjectItem[]>({
    queryKey: ["/api/projects"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: isLoggedIn,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!authLoading && !isLoggedIn) {
      navigate("/");
    }
  }, [authLoading, isLoggedIn, navigate]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p data-testid="text-loading" className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return null;
  }

  const handleLogout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 sm:px-8 py-4 flex items-center justify-between">
        <span
          data-testid="text-wordmark"
          className="text-sm font-medium tracking-wide text-muted-foreground/50 select-none"
        >
          VibeSyncPro
        </span>
        <div className="flex items-center gap-4">
          <span data-testid="text-username" className="text-sm text-muted-foreground">
            {user?.username}
          </span>
          <button
            data-testid="button-logout"
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 sm:px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 data-testid="text-dashboard-title" className="text-2xl font-light text-foreground">
            Your Projects
          </h1>
          <button
            data-testid="button-new-project"
            onClick={() => navigate("/onboard")}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>

        {projectsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : !projects || projects.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <FolderOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p data-testid="text-empty-state" className="text-muted-foreground">
              No projects yet. Create your first one!
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            {projects.map((project, index) => {
              const worst = getWorstStatus(project.platform_connections);
              const hasConflict = project.platform_connections.some((c) => c.status === "conflict");
              const hasDrift = project.platform_connections.some((c) => c.status === "drifted");
              const latestSync = getLatestSync(project.platform_connections);

              return (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  data-testid={`card-project-${project.id}`}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className={`border rounded-lg p-5 hover:shadow-sm transition-all cursor-pointer ${
                    hasConflict
                      ? "border-red-300 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10"
                      : hasDrift
                        ? "border-yellow-300 dark:border-yellow-800 bg-yellow-50/20 dark:bg-yellow-950/10"
                        : "border-border hover:border-foreground/30"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 data-testid={`text-project-name-${project.id}`} className="font-medium text-foreground truncate">
                          {project.name}
                        </h2>
                        {hasConflict && (
                          <span data-testid={`badge-conflict-${project.id}`} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 shrink-0">
                            <AlertTriangle className="w-3 h-3" />
                            Conflict
                          </span>
                        )}
                        {!hasConflict && hasDrift && (
                          <span data-testid={`badge-drift-${project.id}`} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300 shrink-0">
                            Drifted
                          </span>
                        )}
                        {worst === "synced" && (
                          <CheckCircle2 data-testid={`icon-synced-${project.id}`} className="w-4 h-4 text-green-500 shrink-0" />
                        )}
                      </div>
                      {project.description && (
                        <p data-testid={`text-project-desc-${project.id}`} className="text-sm text-muted-foreground mt-1 truncate">
                          {project.description}
                        </p>
                      )}

                      {project.platform_connections.length > 0 && (
                        <div className="flex items-center gap-3 mt-3">
                          {project.platform_connections.map((conn) => {
                            const Icon = PLATFORM_ICONS[conn.platform] || Globe;
                            return (
                              <div
                                key={conn.id}
                                data-testid={`status-indicator-${project.id}-${conn.platform}`}
                                className="flex items-center gap-1.5"
                                title={`${conn.platform === "claude_code" ? "Claude Code" : conn.platform === "replit" ? "Replit" : "Computer"}: ${STATUS_LABEL[conn.status] || conn.status}`}
                              >
                                <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />
                                <span className={`w-2 h-2 rounded-full ${STATUS_DOT[conn.status] || "bg-muted-foreground/30"}`} />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0 ml-4">
                      {project.created_at && (
                        <span data-testid={`text-project-date-${project.id}`} className="text-xs text-muted-foreground/60">
                          {new Date(project.created_at).toLocaleDateString()}
                        </span>
                      )}
                      {latestSync && (
                        <span data-testid={`text-last-synced-${project.id}`} className="flex items-center gap-1 text-xs text-muted-foreground/50">
                          <Clock className="w-3 h-3" />
                          Synced {timeAgo(latestSync)}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </main>
    </div>
  );
}
