import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { getQueryFn } from "@/lib/queryClient";
import { LogOut, FolderOpen, Plus } from "lucide-react";
import { motion } from "framer-motion";

interface ProjectItem {
  id: number;
  name: string;
  description: string | null;
  created_at: string | null;
  platform_connections: Array<{
    id: number;
    platform: string;
    status: string;
  }>;
}

export default function Dashboard() {
  const { user, isLoading: authLoading, isLoggedIn } = useAuth();
  const [, navigate] = useLocation();

  const { data: projects, isLoading: projectsLoading } = useQuery<ProjectItem[]>({
    queryKey: ["/api/projects"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: isLoggedIn,
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
            onClick={() => navigate("/")}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>

        {projectsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
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
            {projects.map((project, index) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                data-testid={`card-project-${project.id}`}
                className="border border-border rounded-lg p-5 hover:border-foreground/20 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 data-testid={`text-project-name-${project.id}`} className="font-medium text-foreground">
                      {project.name}
                    </h2>
                    {project.description && (
                      <p data-testid={`text-project-desc-${project.id}`} className="text-sm text-muted-foreground mt-1">
                        {project.description}
                      </p>
                    )}
                  </div>
                  {project.created_at && (
                    <span data-testid={`text-project-date-${project.id}`} className="text-xs text-muted-foreground/60">
                      {new Date(project.created_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </main>
    </div>
  );
}
