import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Github, GitBranch, Merge, Search, Globe, Bot, Monitor } from "lucide-react";
import { SiGithub, SiReplit, SiClaude } from "react-icons/si";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

function ProductVisual() {
  const rows: Array<{
    Icon: React.ComponentType<{ className?: string }>;
    label: string;
    branch: string;
    status: string;
    pillClass: string;
  }> = [
    {
      Icon: Globe,
      label: "Replit",
      branch: "agent/main",
      status: "Up to date",
      pillClass: "bg-foreground text-background",
    },
    {
      Icon: Bot,
      label: "Claude Code",
      branch: "claude/feature-auth",
      status: "Out of sync",
      pillClass: "bg-foreground/10 text-foreground/70",
    },
    {
      Icon: Monitor,
      label: "Computer",
      branch: "computer/refactor",
      status: "Needs attention",
      pillClass: "border border-foreground/20 text-foreground/50",
    },
  ];

  return (
    <div className="rounded-2xl border border-border bg-white dark:bg-[#0D0D0D] shadow-[0_8px_48px_rgba(0,0,0,0.07)] dark:shadow-[0_8px_48px_rgba(0,0,0,0.5)] overflow-hidden">
      <div className="border-b border-border px-5 py-3 flex items-center gap-3 bg-[#FAFAFA] dark:bg-[#131313]">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-foreground/10" />
          <div className="w-2.5 h-2.5 rounded-full bg-foreground/10" />
          <div className="w-2.5 h-2.5 rounded-full bg-foreground/10" />
        </div>
        <span className="text-[11px] text-muted-foreground/50 tracking-wide ml-1 select-none">
          VibeSyncPro — my-saas-app
        </span>
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-medium text-foreground/35 uppercase tracking-[0.12em] select-none">
            AI Agents
          </p>
          <span className="text-[10px] text-muted-foreground/40 select-none">Synced 2 min ago</span>
        </div>
        {rows.map(({ Icon, label, branch, status, pillClass }) => (
          <div
            key={label}
            className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
          >
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground/50">
                <Icon className="w-4 h-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1 mt-0.5">
                  <GitBranch className="w-3 h-3" />
                  {branch}
                </p>
              </div>
            </div>
            <span
              className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap ${pillClass}`}
            >
              {status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { isLoggedIn, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isLoading && isLoggedIn) navigate("/dashboard");
  }, [isLoading, isLoggedIn, navigate]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (isLoading || isLoggedIn) return null;

  const features = [
    {
      Icon: GitBranch,
      title: "Drift detection",
      desc: "Know the moment a branch falls behind.",
      stat: "Catches drift in under 30 seconds",
      testId: "card-feature-drift",
    },
    {
      Icon: Merge,
      title: "Conflict resolution",
      desc: "Merge or update branches without leaving the dashboard.",
      stat: "Fix conflicts in one click",
      testId: "card-feature-conflict",
    },
    {
      Icon: Search,
      title: "Ghost branch cleanup",
      desc: "Automatically surface unregistered branches created by AI tools.",
      stat: "Zero branches left behind",
      testId: "card-feature-ghost",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F9F8F6] dark:bg-[#141412]">
      {/* Nav */}
      <nav
        className={`sticky top-0 z-50 flex items-center justify-between px-6 sm:px-10 py-5 transition-all duration-300 ${
          scrolled
            ? "backdrop-blur-md bg-[#F9F8F6]/80 dark:bg-[#141412]/80 border-b border-border"
            : ""
        }`}
      >
        <span
          data-testid="text-wordmark"
          className="text-sm font-semibold tracking-wide text-foreground/80 select-none"
        >
          VibeSyncPro
        </span>
        <div className="flex items-center gap-6">
          <a
            href="#features"
            data-testid="link-how-it-works"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            How it works
          </a>
          <a
            href="/auth/github?redirect=/dashboard"
            data-testid="link-login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Log in
          </a>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center px-6 sm:px-10 pt-14 pb-8">
        <div className="relative w-full max-w-3xl mx-auto text-center">
          {/* Radial gradient backdrop */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -top-20 flex items-center justify-center overflow-hidden"
          >
            <div
              className="w-[700px] h-[500px] rounded-full opacity-60"
              style={{
                background:
                  "radial-gradient(ellipse at center, rgba(0,0,0,0.04) 0%, transparent 70%)",
              }}
            />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <h1
              data-testid="text-hero-headline"
              className="text-4xl sm:text-5xl md:text-6xl font-light text-foreground"
              style={{ letterSpacing: "-0.03em", lineHeight: "1.05" }}
            >
              One pane for all your AI&nbsp;agents.
            </h1>
            <p
              data-testid="text-hero-subheadline"
              className="mt-6 text-base sm:text-lg max-w-xl mx-auto leading-relaxed"
              style={{ color: "#7b8fa8" }}
            >
              VibeSyncPro connects to your GitHub repos and watches every branch
              your AI agents touch — Replit, Claude Code, and Computer Use —
              telling you exactly what's in sync, what's drifted, and what
              needs&nbsp;fixing.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="/auth/github?redirect=/onboard"
                data-testid="button-signup"
                className="inline-flex items-center gap-2.5 px-7 py-3 rounded-lg bg-foreground text-background text-sm font-medium transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_4px_20px_rgba(0,0,0,0.14)] active:scale-[0.99]"
              >
                <Github className="w-5 h-5" />
                Sign up with GitHub
              </a>
            </div>
          </motion.div>
        </div>

        {/* Product visual */}
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="mt-14 w-full max-w-lg mx-auto"
        >
          <ProductVisual />
        </motion.div>

        {/* Social proof strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.38, duration: 0.5 }}
          className="mt-8 flex items-center gap-4 text-muted-foreground/40"
          data-testid="strip-works-with"
        >
          <span className="text-xs tracking-wide select-none">Works with</span>
          <div className="flex items-center gap-3.5">
            <SiGithub className="w-4 h-4" aria-label="GitHub" />
            <SiReplit className="w-4 h-4" aria-label="Replit" />
            <SiClaude className="w-4 h-4" aria-label="Claude" />
          </div>
        </motion.div>

        {/* Features */}
        <motion.div
          id="features"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mt-16 mb-16 w-full max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          {features.map(({ Icon, title, desc, stat, testId }) => (
            /* Gradient border wrapper — transparent by default, subtle gradient on hover */
            <div
              key={testId}
              className="p-px rounded-xl bg-gradient-to-br from-border/0 to-border/0 hover:from-foreground/20 hover:to-foreground/5 transition-all duration-300 group"
              data-testid={testId}
            >
              <div className="rounded-[11px] p-6 bg-white/90 dark:bg-[#0D0D0D]/90 backdrop-blur-sm shadow-sm group-hover:shadow-md transition-all duration-300 h-full">
                <div className="w-11 h-11 rounded-full bg-foreground/5 group-hover:bg-foreground/[0.08] flex items-center justify-center mb-4 transition-colors duration-300">
                  <Icon className="w-6 h-6 text-foreground/60" />
                </div>
                <h3 className="font-medium text-foreground text-sm">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{desc}</p>
                <p className="mt-3 text-[11px] text-muted-foreground/45 font-medium">{stat}</p>
              </div>
            </div>
          ))}
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
