import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Github, GitFork, Globe, Bot, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

type EntryPath = "fresh" | "replit" | "claude_code" | "existing" | "fork";

const PATH_CARDS: { id: EntryPath; icon: typeof Globe; title: string; desc: string }[] = [
  { id: "fresh", icon: Sparkles, title: "Start a new project", desc: "I have an idea and want to begin from scratch" },
  { id: "replit", icon: Globe, title: "Already building in Replit", desc: "I have a Replit project I want to sync" },
  { id: "claude_code", icon: Bot, title: "Using Claude Code", desc: "I have a branch Claude Code is working on" },
  { id: "existing", icon: Github, title: "I have a GitHub repo", desc: "Connect an existing repository" },
  { id: "fork", icon: GitFork, title: "Fork a public repo", desc: "Copy someone else's repo and build on it" },
];

function hasStayParam() {
  return new URLSearchParams(window.location.search).has("stay");
}

export default function Home() {
  const { user, isLoggedIn, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [stay] = useState(hasStayParam);

  useEffect(() => {
    if (!authLoading && isLoggedIn && !stay) {
      const timer = setTimeout(() => navigate("/dashboard"), 1500);
      return () => clearTimeout(timer);
    }
  }, [authLoading, isLoggedIn, stay, navigate]);

  const handlePickPath = (path: EntryPath) => {
    if (!isLoggedIn) {
      sessionStorage.setItem("onboard_path", path);
      window.location.href = `/auth/github?redirect=${encodeURIComponent("/onboard")}`;
      return;
    }
    navigate(`/onboard?path=${path}`);
  };

  const showPathPicker = stay || (!authLoading && !isLoggedIn);
  const showWelcomeBack = !authLoading && isLoggedIn && !stay;

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <header className="absolute top-0 left-0 p-6 sm:p-8 z-10">
        <span
          data-testid="text-wordmark"
          className="text-sm font-medium tracking-wide text-muted-foreground/50 select-none"
        >
          VibeSyncPro
        </span>
      </header>

      <main className="min-h-screen w-full flex items-center justify-center p-6 sm:p-12" style={{ paddingBottom: "10vh" }}>
        <div className="w-full max-w-2xl mx-auto">
          {authLoading && !stay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="flex items-center justify-center"
              data-testid="loading-state"
            >
              <Loader2 className="w-6 h-6 text-muted-foreground/40 animate-spin" />
            </motion.div>
          )}

          {showWelcomeBack && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center gap-8 text-center"
              data-testid="welcome-back-view"
            >
              <motion.h1
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                data-testid="text-welcome-back"
                className="text-4xl sm:text-5xl md:text-6xl font-light text-foreground/80 tracking-tight"
              >
                Welcome back{user?.username ? `, ${user.username}` : ""}
              </motion.h1>

              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.4 }}
                data-testid="button-go-to-dashboard"
                onClick={() => navigate("/dashboard")}
                className="flex items-center gap-3 px-8 py-4 rounded-lg border border-border hover:border-foreground/30 hover:shadow-sm transition-all group"
              >
                <span className="font-medium text-foreground">Go to Dashboard</span>
                <ArrowRight className="w-5 h-5 text-foreground/60 group-hover:translate-x-0.5 transition-transform" />
              </motion.button>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.4 }}
                className="text-sm text-muted-foreground"
              >
                Redirecting automatically…
              </motion.p>
            </motion.div>
          )}

          {showPathPicker && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col gap-10"
            >
              <motion.h1
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                data-testid="text-heading"
                className="text-4xl sm:text-5xl md:text-6xl font-light text-foreground/80 tracking-tight"
              >
                How are you building?
              </motion.h1>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35, duration: 0.5 }}
                className="grid gap-3"
              >
                {PATH_CARDS.map((card, i) => (
                  <motion.button
                    key={card.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + i * 0.06, duration: 0.4 }}
                    data-testid={`button-path-${card.id}`}
                    onClick={() => handlePickPath(card.id)}
                    disabled={authLoading}
                    className="flex items-center gap-4 p-5 rounded-lg border border-border hover:border-foreground/30 hover:shadow-sm transition-all text-left group disabled:opacity-50"
                  >
                    <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center flex-shrink-0 group-hover:bg-foreground/10 transition-colors">
                      <card.icon className="w-5 h-5 text-foreground/60" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{card.title}</p>
                      <p className="text-sm text-muted-foreground">{card.desc}</p>
                    </div>
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
}
