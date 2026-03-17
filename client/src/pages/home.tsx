import { useEffect } from "react";
import { motion } from "framer-motion";
import { Github, GitBranch, Merge, Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

export default function Home() {
  const { isLoggedIn, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && isLoggedIn) navigate("/dashboard");
  }, [isLoading, isLoggedIn, navigate]);

  if (isLoading || isLoggedIn) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 sm:px-10 py-5">
        <span
          data-testid="text-wordmark"
          className="text-sm font-semibold tracking-wide text-foreground/80 select-none"
        >
          VibeSyncPro
        </span>
        <a
          href="/auth/github?redirect=/dashboard"
          data-testid="link-login"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Log in
        </a>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl mx-auto text-center"
        >
          <h1
            data-testid="text-hero-headline"
            className="text-4xl sm:text-5xl md:text-6xl font-light tracking-tight text-foreground leading-[1.1]"
          >
            One pane for all your AI&nbsp;agents.
          </h1>
          <p
            data-testid="text-hero-subheadline"
            className="mt-6 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed"
          >
            VibeSyncPro connects to your GitHub repos and watches every branch your AI agents touch — Replit, Claude Code, and Computer Use — telling you exactly what's in sync, what's drifted, and what needs&nbsp;fixing.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/auth/github?redirect=/onboard"
              data-testid="button-signup"
              className="inline-flex items-center gap-2.5 px-7 py-3 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              <Github className="w-4.5 h-4.5" />
              Sign up with GitHub
            </a>
          </div>
        </motion.div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mt-24 mb-16 w-full max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          <div
            className="rounded-xl border border-border p-6"
            data-testid="card-feature-drift"
          >
            <div className="w-9 h-9 rounded-full bg-foreground/5 flex items-center justify-center mb-4">
              <GitBranch className="w-4 h-4 text-foreground/70" />
            </div>
            <h3 className="font-medium text-foreground text-sm">Drift detection</h3>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              Know the moment a branch falls behind.
            </p>
          </div>

          <div
            className="rounded-xl border border-border p-6"
            data-testid="card-feature-conflict"
          >
            <div className="w-9 h-9 rounded-full bg-foreground/5 flex items-center justify-center mb-4">
              <Merge className="w-4 h-4 text-foreground/70" />
            </div>
            <h3 className="font-medium text-foreground text-sm">Conflict resolution</h3>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              Merge or update branches without leaving the dashboard.
            </p>
          </div>

          <div
            className="rounded-xl border border-border p-6"
            data-testid="card-feature-ghost"
          >
            <div className="w-9 h-9 rounded-full bg-foreground/5 flex items-center justify-center mb-4">
              <Search className="w-4 h-4 text-foreground/70" />
            </div>
            <h3 className="font-medium text-foreground text-sm">Ghost branch cleanup</h3>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              Automatically surface unregistered branches created by AI&nbsp;tools.
            </p>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="px-6 sm:px-10 py-6 text-center">
        <p className="text-xs text-muted-foreground/70">
          &copy; {new Date().getFullYear()} VibeSyncPro
        </p>
      </footer>
    </div>
  );
}
