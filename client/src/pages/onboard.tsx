import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight, ArrowLeft, Check, Sparkles, Github, GitFork,
  Monitor, Bot, Globe, GitBranch, Zap, Search, Loader2,
  ExternalLink, Copy, Terminal,
} from "lucide-react";

type Platform = "replit" | "claude_code" | "computer";
type EntryPath = "fresh" | "replit" | "claude_code" | "existing" | "fork";
type StepId = "picker" | "repo" | "fork_url" | "analyze" | "agents" | "name" | "review";

interface AnalysisResult {
  summary: string;
  stack: string[];
  repo_name: string;
  default_branch: string;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  default_branch: string;
  html_url: string;
  private: boolean;
  description?: string | null;
}

interface GitHubBranch {
  name: string;
}

interface PlatformSetup {
  enabled: boolean;
  branch_name: string | null;
}

const PLATFORM_META: Record<Platform, { label: string; icon: typeof Globe; description: string }> = {
  replit: { label: "Replit Agent", icon: Globe, description: "Working in Replit's cloud IDE" },
  claude_code: { label: "Claude Code", icon: Bot, description: "Using Claude Code on a branch" },
  computer: { label: "Computer Use", icon: Monitor, description: "Running locally or via computer use" },
};

const AI_BRANCH_PATTERNS: Record<Platform, RegExp[]> = {
  replit: [/^replit[-/]/i, /^replit$/i, /agent[-/]replit/i],
  claude_code: [/^claude[-/]/i, /^claude$/i, /agent[-/]claude/i],
  computer: [/^computer[-/]/i, /^local[-/]/i],
};

const PATH_CARDS: { id: EntryPath; icon: typeof Globe; title: string; desc: string }[] = [
  { id: "fresh", icon: Sparkles, title: "Start a new project", desc: "I have an idea and want to begin from scratch" },
  { id: "replit", icon: Globe, title: "Already building in Replit", desc: "I have a Replit project I want to sync" },
  { id: "claude_code", icon: Bot, title: "Using Claude Code", desc: "I have a branch Claude Code is working on" },
  { id: "existing", icon: Github, title: "I have a GitHub repo", desc: "Connect an existing repository" },
  { id: "fork", icon: GitFork, title: "Fork a public repo", desc: "Copy someone else's repo and build on it" },
];

function getStepsForPath(path: EntryPath): StepId[] {
  switch (path) {
    case "fresh":
      return ["name", "repo", "agents", "review"];
    case "fork":
      return ["fork_url", "analyze", "agents", "name", "review"];
    case "replit":
    case "claude_code":
    case "existing":
      return ["repo", "analyze", "agents", "name", "review"];
  }
}

function suggestBranch(branches: GitHubBranch[], platform: Platform): string | null {
  for (const b of branches) {
    for (const pat of AI_BRANCH_PATTERNS[platform]) {
      if (pat.test(b.name)) return b.name;
    }
  }
  return null;
}

function sortBranches(branches: GitHubBranch[], platform: Platform): GitHubBranch[] {
  const suggested = new Set<string>();
  for (const b of branches) {
    for (const pat of AI_BRANCH_PATTERNS[platform]) {
      if (pat.test(b.name)) { suggested.add(b.name); break; }
    }
  }
  return [
    ...branches.filter((b) => suggested.has(b.name)),
    ...branches.filter((b) => !suggested.has(b.name)),
  ];
}

const transition = { duration: 0.45, ease: [0.22, 1, 0.36, 1] };

export default function OnboardPage() {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [entryPath, setEntryPath] = useState<EntryPath | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [forkUrl, setForkUrl] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [existingRepoUrl, setExistingRepoUrl] = useState("");
  const [existingUrlMode, setExistingUrlMode] = useState(false);
  const [resolvedForkRepo, setResolvedForkRepo] = useState<GitHubRepo | null>(null);
  const [platforms, setPlatforms] = useState<Record<Platform, PlatformSetup>>({
    replit: { enabled: false, branch_name: null },
    claude_code: { enabled: false, branch_name: null },
    computer: { enabled: false, branch_name: null },
  });
  const [isLaunching, setIsLaunching] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const steps = useMemo<StepId[]>(() => {
    if (!entryPath) return ["picker"];
    return getStepsForPath(entryPath);
  }, [entryPath]);

  const currentStep = steps[stepIndex] ?? "picker";
  const totalDots = steps.length;

  useEffect(() => {
    if (!authLoading && !isLoggedIn) {
      const params = new URLSearchParams(window.location.search);
      const urlPath = params.get("path");
      const storedPath = sessionStorage.getItem("onboard_path");
      const pathToPreserve = urlPath || storedPath;
      if (urlPath && !storedPath) {
        sessionStorage.setItem("onboard_path", urlPath);
      }
      const redirectUrl = pathToPreserve
        ? `/onboard?path=${pathToPreserve}`
        : "/onboard";
      window.location.href = `/auth/github?redirect=${encodeURIComponent(redirectUrl)}`;
    }
  }, [authLoading, isLoggedIn]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pathParam = params.get("path") as EntryPath | null;
    const storedPath = sessionStorage.getItem("onboard_path") as EntryPath | null;

    const resolvedPath = pathParam || storedPath;
    if (storedPath) sessionStorage.removeItem("onboard_path");

    if (resolvedPath && ["fresh", "replit", "claude_code", "existing", "fork"].includes(resolvedPath)) {
      setEntryPath(resolvedPath);
      setStepIndex(0);

      if (resolvedPath === "replit") {
        setPlatforms((prev) => ({ ...prev, replit: { enabled: true, branch_name: null } }));
      } else if (resolvedPath === "claude_code") {
        setPlatforms((prev) => ({ ...prev, claude_code: { enabled: true, branch_name: null } }));
      }
    }

    const name = params.get("name");
    if (name) setProjectName(name);
  }, []);

  useEffect(() => {
    if (currentStep === "name" && nameInputRef.current) nameInputRef.current.focus();
  }, [currentStep]);

  const { data: repos, isLoading: reposLoading } = useQuery<GitHubRepo[]>({
    queryKey: ["/api/github/repos"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: isLoggedIn && currentStep === "repo" && !existingUrlMode,
  });

  const repoOwner = selectedRepo?.full_name?.split("/")[0];
  const repoName = selectedRepo?.full_name?.split("/")[1];

  const { data: branches } = useQuery<GitHubBranch[]>({
    queryKey: ["/api/github/repos", repoOwner, repoName, "branches"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!selectedRepo && currentStep === "agents",
  });

  const lookupPublicRepo = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("GET", `/api/github/repos/public?url=${encodeURIComponent(url)}`);
      return res.json() as Promise<GitHubRepo>;
    },
  });

  const forkRepoMutation = useMutation({
    mutationFn: async (repoFullName: string) => {
      const res = await apiRequest("POST", `/api/github/fork`, { repo_full_name: repoFullName });
      return res.json() as Promise<GitHubRepo>;
    },
  });

  const analyzeRepoMutation = useMutation({
    mutationFn: async (repoFullName: string) => {
      const res = await apiRequest("POST", "/api/github/repos/analyze", { repo_full_name: repoFullName });
      return res.json() as Promise<AnalysisResult>;
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      if (!projectName.trim() && data.repo_name) {
        setProjectName(data.repo_name.replace(/[-_]/g, " "));
      }
    },
  });

  useEffect(() => {
    if (currentStep === "analyze" && selectedRepo && !analysisResult && !analyzeRepoMutation.isPending && !analyzeRepoMutation.isError) {
      analyzeRepoMutation.mutate(selectedRepo.full_name);
    }
  }, [currentStep, selectedRepo]);

  const filteredRepos = repos?.filter((r) =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  ) ?? [];

  const goNext = () => setStepIndex((s) => Math.min(s + 1, steps.length - 1));
  const goBack = () => {
    if (stepIndex === 0 && entryPath) {
      setEntryPath(null);
      setStepIndex(0);
      return;
    }
    setStepIndex((s) => Math.max(s - 1, 0));
  };

  const handlePickPath = (path: EntryPath) => {
    setEntryPath(path);
    setStepIndex(0);
    const freshPlatforms: Record<Platform, PlatformSetup> = {
      replit: { enabled: false, branch_name: null },
      claude_code: { enabled: false, branch_name: null },
      computer: { enabled: false, branch_name: null },
    };
    if (path === "replit") {
      freshPlatforms.replit = { enabled: true, branch_name: null };
    } else if (path === "claude_code") {
      freshPlatforms.claude_code = { enabled: true, branch_name: null };
    }
    setPlatforms(freshPlatforms);
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (projectName.trim()) goNext();
  };

  const handleSelectRepo = (repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setAnalysisResult(null);
    analyzeRepoMutation.reset();
    goNext();
  };

  const handleExistingUrlResolve = async () => {
    if (!existingRepoUrl.trim()) return;
    try {
      const repo = await lookupPublicRepo.mutateAsync(existingRepoUrl.trim());
      setSelectedRepo(repo);
      setAnalysisResult(null);
      analyzeRepoMutation.reset();
      goNext();
    } catch (err) {
      toast({ title: "Couldn't find that repo", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleForkUrlResolve = async () => {
    if (!forkUrl.trim()) return;
    lookupPublicRepo.reset();
    setResolvedForkRepo(null);
    try {
      const publicRepo = await lookupPublicRepo.mutateAsync(forkUrl.trim());
      if (publicRepo.private) {
        toast({ title: "Private repo", description: "This repository is private. Use 'I have a GitHub repo' instead.", variant: "destructive" });
        return;
      }
      setResolvedForkRepo(publicRepo);
    } catch (err) {
      toast({ title: "Couldn't find that repo", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleForkConfirm = async () => {
    if (!resolvedForkRepo) return;
    try {
      const forked = await forkRepoMutation.mutateAsync(resolvedForkRepo.full_name);
      setSelectedRepo(forked);
      setAnalysisResult(null);
      analyzeRepoMutation.reset();
      toast({ title: "Forked!", description: `Forked ${resolvedForkRepo.full_name} to your account as ${forked.full_name} — ready to connect agents` });
      goNext();
    } catch (err) {
      toast({ title: "Fork failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) => ({
      ...prev,
      [p]: { ...prev[p], enabled: !prev[p].enabled, branch_name: !prev[p].enabled ? (branches ? suggestBranch(branches, p) : null) : null },
    }));
  };

  const setBranchForPlatform = (p: Platform, branch: string | null) => {
    setPlatforms((prev) => ({
      ...prev,
      [p]: { ...prev[p], branch_name: branch },
    }));
  };

  const handleLaunch = async () => {
    setIsLaunching(true);
    try {
      const connections = (Object.entries(platforms) as [Platform, PlatformSetup][])
        .filter(([, v]) => v.enabled)
        .map(([platform, v]) => ({ platform, branch_name: v.branch_name }));

      const body: Record<string, unknown> = {
        name: projectName.trim(),
        description: projectName.trim(),
      };
      if (selectedRepo) {
        body.github_repo_name = selectedRepo.full_name;
        body.github_repo_url = selectedRepo.html_url;
      }
      if (connections.length > 0) {
        body.connections = connections;
      }

      const res = await apiRequest("POST", "/api/projects", body);
      const project = await res.json() as { id: number };
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      navigate(`/projects/${project.id}?launched=1`);
    } catch (err) {
      toast({ title: "Failed to create project", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
      setIsLaunching(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isLoggedIn) return null;

  const enabledPlatforms = (Object.entries(platforms) as [Platform, PlatformSetup][]).filter(([, v]) => v.enabled);

  const nonDefaultBranches = branches?.filter(
    (b) => b.name !== selectedRepo?.default_branch
  ) ?? [];
  const hasAgentBranches = nonDefaultBranches.length > 0;

  const preselectedLabel = entryPath === "replit"
    ? "Replit Agent"
    : entryPath === "claude_code"
      ? "Claude Code"
      : null;

  const agentsSubtext = (() => {
    const contextLine = !selectedRepo
      ? "Choose which AI tools you plan to use. You can set up branches later."
      : hasAgentBranches
        ? "Toggle which AI platforms are active and pick their branches."
        : "Choose which AI tools you plan to use. We'll show you how to get each one started.";
    if (preselectedLabel) {
      return `${preselectedLabel} has been pre-selected below. Toggle others if needed. ${contextLine}`;
    }
    return contextLine;
  })();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied!", description: text.length > 60 ? text.slice(0, 60) + "…" : text });
    });
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <header className="absolute top-0 left-0 right-0 p-6 sm:p-8 z-10 flex items-center justify-between">
        <span data-testid="text-wordmark" className="text-sm font-medium tracking-wide text-muted-foreground/50 select-none">
          VibeSyncPro
        </span>
        {entryPath && (
          <div className="flex items-center gap-1">
            {Array.from({ length: totalDots }, (_, i) => (
              <div
                key={i}
                data-testid={`indicator-step-${i + 1}`}
                className={`w-2 h-2 rounded-full transition-colors ${i === stepIndex ? "bg-foreground" : i < stepIndex ? "bg-foreground/40" : "bg-muted-foreground/20"}`}
              />
            ))}
          </div>
        )}
      </header>

      <main className="min-h-screen w-full flex items-center justify-center p-6 sm:p-12" style={{ paddingBottom: "10vh" }}>
        <div className="w-full max-w-2xl mx-auto">
          <AnimatePresence mode="wait">
            {/* PICKER — choose your path */}
            {currentStep === "picker" && (
              <motion.div
                key="picker"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                className="flex flex-col gap-8"
              >
                <motion.h1
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                  data-testid="text-heading-picker"
                  className="text-4xl sm:text-5xl md:text-6xl font-light text-foreground/80 tracking-tight"
                >
                  How are you building?
                </motion.h1>

                <div className="grid gap-3">
                  {PATH_CARDS.map((card, i) => (
                    <motion.button
                      key={card.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 + i * 0.06, duration: 0.4 }}
                      data-testid={`button-path-${card.id}`}
                      onClick={() => handlePickPath(card.id)}
                      className="flex items-center gap-4 p-5 rounded-lg border border-border hover:border-foreground/30 hover:shadow-sm transition-all text-left group"
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
                </div>
              </motion.div>
            )}

            {/* NAME step */}
            {currentStep === "name" && (
              <motion.form
                key="name"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                onSubmit={handleNameSubmit}
                className="flex flex-col gap-10"
              >
                <div>
                  <button
                    type="button"
                    data-testid="button-back-name"
                    onClick={goBack}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <h1 data-testid="text-heading-name" className="text-3xl sm:text-4xl font-light text-foreground/80 tracking-tight">
                    What are you calling it?
                  </h1>
                </div>

                <input
                  ref={nameInputRef}
                  data-testid="input-project-name"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="a todo app, a portfolio site..."
                  className="w-full bg-transparent text-2xl sm:text-3xl font-light text-foreground placeholder:text-muted-foreground/25 border-b-2 border-muted hover:border-muted-foreground/50 focus:border-foreground focus:outline-none focus:ring-0 pb-4 transition-colors rounded-none"
                  autoComplete="off"
                  spellCheck="false"
                />

                <button
                  type="submit"
                  data-testid="button-next-name"
                  disabled={!projectName.trim()}
                  className={`group flex items-center gap-3 px-8 py-4 rounded-full text-base font-medium transition-all duration-300 ease-out self-start ${
                    projectName.trim()
                      ? "bg-foreground text-background shadow-lg cursor-pointer"
                      : "bg-muted-foreground/15 text-muted-foreground/40 cursor-not-allowed"
                  }`}
                >
                  Continue
                  <ArrowRight className={`w-5 h-5 transition-transform duration-300 ${projectName.trim() ? "group-hover:translate-x-1" : ""}`} />
                </button>
              </motion.form>
            )}

            {/* REPO step */}
            {currentStep === "repo" && (
              <motion.div
                key="repo"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                className="flex flex-col gap-8"
              >
                <div>
                  <button
                    data-testid="button-back-repo"
                    onClick={goBack}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <h1 data-testid="text-heading-repo" className="text-3xl sm:text-4xl font-light text-foreground/80 tracking-tight">
                    {entryPath === "fresh" ? "Connect to GitHub" : "Which repo?"}
                  </h1>
                  {entryPath === "fresh" && (
                    <p className="text-sm text-muted-foreground mt-2">
                      VibeSyncPro handles the version control for you — just pick a repo and we'll keep your agents in sync. No git knowledge needed.
                    </p>
                  )}
                </div>

                <div className="flex gap-2 mb-1">
                  <button
                    data-testid="button-existing-picker"
                    onClick={() => { setExistingUrlMode(false); lookupPublicRepo.reset(); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${!existingUrlMode ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    My repos
                  </button>
                  <button
                    data-testid="button-existing-url"
                    onClick={() => setExistingUrlMode(true)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${existingUrlMode ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    Paste URL
                  </button>
                </div>

                {!existingUrlMode ? (
                  <div className="flex flex-col gap-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                      <input
                        data-testid="input-repo-search"
                        type="text"
                        value={repoSearch}
                        onChange={(e) => setRepoSearch(e.target.value)}
                        placeholder="Search your repos..."
                        className="w-full pl-10 pr-4 py-3 rounded-lg border border-border bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:outline-none transition-colors"
                      />
                    </div>

                    <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                      {reposLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : filteredRepos.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">No repos found</p>
                      ) : (
                        filteredRepos.map((repo) => (
                          <button
                            key={repo.full_name}
                            data-testid={`button-repo-${repo.full_name}`}
                            onClick={() => handleSelectRepo(repo)}
                            className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors text-left"
                          >
                            <Github className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{repo.full_name}</p>
                              <p className="text-xs text-muted-foreground">{repo.default_branch}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-muted-foreground">
                      Paste a GitHub repository URL to connect it.
                    </p>
                    <div className="flex gap-2">
                      <input
                        data-testid="input-existing-repo-url"
                        type="text"
                        value={existingRepoUrl}
                        onChange={(e) => setExistingRepoUrl(e.target.value)}
                        onBlur={() => { if (existingRepoUrl.trim()) handleExistingUrlResolve(); }}
                        placeholder="https://github.com/owner/repo"
                        className="flex-1 px-4 py-3 rounded-lg border border-border bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:outline-none transition-colors"
                      />
                      <button
                        data-testid="button-existing-url-resolve"
                        onClick={handleExistingUrlResolve}
                        disabled={!existingRepoUrl.trim() || lookupPublicRepo.isPending}
                        className="flex items-center gap-2 px-5 py-3 rounded-lg bg-foreground text-background font-medium transition-opacity disabled:opacity-40"
                      >
                        {lookupPublicRepo.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ArrowRight className="w-4 h-4" />
                        )}
                        Connect
                      </button>
                    </div>
                    {lookupPublicRepo.isError && (
                      <p data-testid="text-existing-url-error" className="text-sm text-red-500">
                        {lookupPublicRepo.error instanceof Error ? lookupPublicRepo.error.message : "Couldn't find that repo"}
                      </p>
                    )}
                  </div>
                )}

                {entryPath === "fresh" && (
                  <button
                    data-testid="button-skip-repo"
                    onClick={() => { setSelectedRepo(null); setAnalysisResult(null); goNext(); }}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors self-start"
                  >
                    Skip — I'll connect a repo later
                  </button>
                )}
              </motion.div>
            )}

            {/* FORK_URL step */}
            {currentStep === "fork_url" && (
              <motion.div
                key="fork_url"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                className="flex flex-col gap-8"
              >
                <div>
                  <button
                    data-testid="button-back-fork"
                    onClick={goBack}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <h1 data-testid="text-heading-fork" className="text-3xl sm:text-4xl font-light text-foreground/80 tracking-tight">
                    Fork a public repo
                  </h1>
                  <p className="text-sm text-muted-foreground mt-2">
                    Paste a public GitHub URL — we'll fork it to your account so your AI agents can work on it.
                  </p>
                </div>

                <div className="flex gap-2">
                  <input
                    data-testid="input-fork-url"
                    type="text"
                    value={forkUrl}
                    onChange={(e) => { setForkUrl(e.target.value); setResolvedForkRepo(null); }}
                    onBlur={() => { if (forkUrl.trim() && !resolvedForkRepo) handleForkUrlResolve(); }}
                    placeholder="https://github.com/owner/repo"
                    className="flex-1 px-4 py-3 rounded-lg border border-border bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:outline-none transition-colors"
                  />
                  {!resolvedForkRepo && (
                    <button
                      data-testid="button-fork-lookup"
                      onClick={handleForkUrlResolve}
                      disabled={!forkUrl.trim() || lookupPublicRepo.isPending}
                      className="flex items-center gap-2 px-5 py-3 rounded-lg bg-muted text-foreground font-medium transition-opacity disabled:opacity-40"
                    >
                      {lookupPublicRepo.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                      Look up
                    </button>
                  )}
                </div>

                {lookupPublicRepo.isError && (
                  <p data-testid="text-fork-error" className="text-sm text-red-500">
                    {lookupPublicRepo.error instanceof Error ? lookupPublicRepo.error.message : "Couldn't find that repo"}
                  </p>
                )}

                {resolvedForkRepo && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col gap-3"
                  >
                    <div data-testid="card-resolved-fork-repo" className="flex items-center gap-3 p-4 rounded-lg border border-foreground/20 bg-foreground/[0.02]">
                      <Github className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{resolvedForkRepo.full_name}</p>
                        {resolvedForkRepo.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{resolvedForkRepo.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">Default branch: {resolvedForkRepo.default_branch}</p>
                      </div>
                    </div>

                    <button
                      data-testid="button-fork-confirm"
                      onClick={handleForkConfirm}
                      disabled={forkRepoMutation.isPending}
                      className="flex items-center gap-2 px-6 py-3 rounded-lg bg-foreground text-background font-medium transition-opacity disabled:opacity-50 self-start"
                    >
                      {forkRepoMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <GitFork className="w-4 h-4" />
                      )}
                      Fork to my account & continue
                    </button>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ANALYZE step */}
            {currentStep === "analyze" && (
              <motion.div
                key="analyze"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                className="flex flex-col gap-8"
              >
                <div>
                  <button
                    data-testid="button-back-analyze"
                    onClick={goBack}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <h1 data-testid="text-heading-analyze" className="text-3xl sm:text-4xl font-light text-foreground/80 tracking-tight">
                    Understanding your project
                  </h1>
                </div>

                {analyzeRepoMutation.isPending && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    data-testid="status-analyze-loading"
                    className="flex flex-col items-center gap-4 py-12 text-muted-foreground"
                  >
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <p className="text-sm">Reading your codebase…</p>
                  </motion.div>
                )}

                {analysisResult && !analyzeRepoMutation.isPending && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    data-testid="card-analyze-result"
                    className="flex flex-col gap-6"
                  >
                    <div className="p-5 rounded-xl border border-border bg-foreground/[0.02]">
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles className="w-4 h-4 text-muted-foreground/60" />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">What we found</span>
                      </div>
                      <p data-testid="text-analyze-summary" className="text-base text-foreground/80 leading-relaxed">
                        {analysisResult.summary}
                      </p>
                      {analysisResult.stack.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-4">
                          {analysisResult.stack.map((tech) => (
                            <span
                              key={tech}
                              data-testid={`badge-stack-${tech}`}
                              className="px-3 py-1 rounded-full text-xs font-medium bg-foreground/8 text-foreground/70 border border-border"
                            >
                              {tech}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      data-testid="button-analyze-continue"
                      onClick={goNext}
                      className="group flex items-center gap-3 px-8 py-4 rounded-full bg-foreground text-background text-base font-medium shadow-lg transition-all duration-300 ease-out self-start"
                    >
                      That's right, continue
                      <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                    </button>
                  </motion.div>
                )}

                {analyzeRepoMutation.isError && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    data-testid="status-analyze-error"
                    className="flex flex-col gap-5"
                  >
                    <p className="text-sm text-muted-foreground">
                      Couldn't analyze the repo automatically — no worries, you can continue as normal.
                    </p>
                    <button
                      data-testid="button-analyze-skip"
                      onClick={goNext}
                      className="group flex items-center gap-3 px-8 py-4 rounded-full bg-foreground text-background text-base font-medium shadow-lg transition-all duration-300 ease-out self-start"
                    >
                      Continue anyway
                      <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                    </button>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* AGENTS step */}
            {currentStep === "agents" && (
              <motion.div
                key="agents"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                className="flex flex-col gap-8"
              >
                <div>
                  <button
                    data-testid="button-back-agents"
                    onClick={goBack}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <h1 data-testid="text-heading-agents" className="text-3xl sm:text-4xl font-light text-foreground/80 tracking-tight">
                    What would you like to connect?
                  </h1>
                  <p className="text-sm text-muted-foreground mt-2">
                    {agentsSubtext}
                  </p>
                </div>

                {/* GitHub repo card — always shown at top of agents step */}
                <div
                  data-testid="card-github-repo"
                  className={`rounded-lg border p-4 flex items-center gap-4 ${selectedRepo ? "border-foreground/30 bg-foreground/[0.02]" : "border-dashed border-border"}`}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${selectedRepo ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}>
                    <Github className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm">GitHub Repository</p>
                    {selectedRepo ? (
                      <p className="text-xs text-muted-foreground truncate">{selectedRepo.full_name}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Where your agents' code lives — not connected yet</p>
                    )}
                  </div>
                  {selectedRepo ? (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Check className="w-4 h-4 text-muted-foreground" />
                      <button
                        data-testid="button-change-repo"
                        onClick={goBack}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <button
                      data-testid="button-connect-repo-from-agents"
                      onClick={goBack}
                      className="flex-shrink-0 text-xs border border-border rounded px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                    >
                      Connect
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {(["replit", "claude_code", "computer"] as Platform[]).map((p) => {
                    const meta = PLATFORM_META[p];
                    const Icon = meta.icon;
                    const setup = platforms[p];
                    const sorted = branches ? sortBranches(branches, p) : [];

                    return (
                      <div
                        key={p}
                        data-testid={`card-platform-${p}`}
                        className={`rounded-lg border transition-all ${setup.enabled ? "border-foreground/30 bg-foreground/[0.02]" : "border-border"}`}
                      >
                        <button
                          data-testid={`button-toggle-${p}`}
                          onClick={() => togglePlatform(p)}
                          className="w-full flex items-center gap-4 p-4 text-left"
                        >
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${setup.enabled ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground">{meta.label}</p>
                            <p className="text-xs text-muted-foreground">{meta.description}</p>
                          </div>
                          <div className={`w-10 h-6 rounded-full transition-colors ${setup.enabled ? "bg-foreground" : "bg-muted"} relative`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-background transition-all ${setup.enabled ? "left-5" : "left-1"}`} />
                          </div>
                        </button>

                        <AnimatePresence>
                          {setup.enabled && selectedRepo && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.25 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4 pt-1">
                                {hasAgentBranches ? (
                                  <>
                                    <label className="text-xs text-muted-foreground mb-1.5 block">Branch</label>
                                    <select
                                      data-testid={`select-branch-${p}`}
                                      value={setup.branch_name ?? ""}
                                      onChange={(e) => setBranchForPlatform(p, e.target.value || null)}
                                      className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:border-foreground focus:outline-none transition-colors"
                                    >
                                      <option value="">No branch selected</option>
                                      {sorted.map((b) => {
                                        const isSuggested = AI_BRANCH_PATTERNS[p].some((pat) => pat.test(b.name));
                                        return (
                                          <option key={b.name} value={b.name}>
                                            {isSuggested ? `★ ${b.name}` : b.name}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </>
                                ) : (
                                  <div className="flex flex-col gap-3">
                                    {p === "replit" && selectedRepo && (
                                      <>
                                        <p data-testid="text-launch-replit" className="text-xs text-muted-foreground">
                                          Import this repo into Replit to get started.
                                        </p>
                                        <a
                                          data-testid="link-open-replit"
                                          href={`https://replit.com/new/github/${selectedRepo.full_name}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-foreground/5 border border-border text-sm font-medium text-foreground hover:bg-foreground/10 transition-colors self-start"
                                        >
                                          <ExternalLink className="w-3.5 h-3.5" />
                                          Open in Replit →
                                        </a>
                                        <p className="text-[11px] text-muted-foreground">
                                          Replit will create a branch automatically — come back and scan for it once your agent is running.
                                        </p>
                                      </>
                                    )}
                                    {p === "claude_code" && selectedRepo && (
                                      <>
                                        <p data-testid="text-launch-claude" className="text-xs text-muted-foreground">
                                          Run Claude Code in the cloned repo.
                                        </p>
                                        <button
                                          data-testid="button-copy-claude-cmd"
                                          onClick={() => copyToClipboard(`git clone ${selectedRepo.html_url} && cd ${selectedRepo.name} && claude`)}
                                          className="flex items-center gap-2 px-3 py-2 rounded-md bg-foreground/5 border border-border text-xs font-mono text-foreground/80 hover:bg-foreground/10 transition-colors self-start"
                                        >
                                          <Terminal className="w-3.5 h-3.5 flex-shrink-0" />
                                          <span className="truncate">git clone {selectedRepo.html_url} && cd {selectedRepo.name} && claude</span>
                                          <Copy className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                                        </button>
                                        <p className="text-[11px] text-muted-foreground">
                                          Name the branch you'll use (e.g. claude-code) and come back to link it once your agent is running.
                                        </p>
                                      </>
                                    )}
                                    {p === "computer" && selectedRepo && (
                                      <>
                                        <p data-testid="text-launch-computer" className="text-xs text-muted-foreground">
                                          Clone the repo and point your agent at a new branch.
                                        </p>
                                        <button
                                          data-testid="button-copy-repo-url"
                                          onClick={() => copyToClipboard(selectedRepo.html_url)}
                                          className="flex items-center gap-2 px-3 py-2 rounded-md bg-foreground/5 border border-border text-xs font-mono text-foreground/80 hover:bg-foreground/10 transition-colors self-start"
                                        >
                                          <Copy className="w-3.5 h-3.5 flex-shrink-0" />
                                          <span className="truncate">{selectedRepo.html_url}</span>
                                        </button>
                                        <p className="text-[11px] text-muted-foreground">
                                          Come back and link the branch once your agent is running.
                                        </p>
                                      </>
                                    )}
                                    {!selectedRepo && (
                                      <p className="text-xs text-muted-foreground italic">
                                        No repo linked — you can set up branches later from your project page.
                                      </p>
                                    )}
                                    {selectedRepo && (
                                      <>
                                        <div className="mt-1">
                                          <label className="text-[11px] text-muted-foreground block mb-1">Planned branch name (optional)</label>
                                          <input
                                            data-testid={`input-planned-branch-${p}`}
                                            type="text"
                                            value={setup.branch_name ?? ""}
                                            onChange={(e) => setBranchForPlatform(p, e.target.value || null)}
                                            placeholder={p === "replit" ? "replit-agent" : p === "claude_code" ? "claude-code" : "my-branch"}
                                            className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-foreground text-xs focus:border-foreground focus:outline-none transition-colors placeholder:text-muted-foreground/30"
                                          />
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                          You can always connect branches later from your project page.
                                        </p>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-6">
                  {enabledPlatforms.length > 0 && (
                    <button
                      data-testid="button-next-agents"
                      onClick={goNext}
                      className="group flex items-center gap-3 px-8 py-4 rounded-full text-base font-medium bg-foreground text-background shadow-lg cursor-pointer transition-all duration-300 ease-out"
                    >
                      Continue
                      <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                    </button>
                  )}
                  <button
                    data-testid="button-skip-agents"
                    onClick={() => {
                      setPlatforms({
                        replit: { enabled: false, branch_name: null },
                        claude_code: { enabled: false, branch_name: null },
                        computer: { enabled: false, branch_name: null },
                      });
                      goNext();
                    }}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Skip — I'll connect agents after creating the project
                  </button>
                </div>
              </motion.div>
            )}

            {/* REVIEW step */}
            {currentStep === "review" && (
              <motion.div
                key="review"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                className="flex flex-col gap-8"
              >
                <div>
                  <button
                    data-testid="button-back-review"
                    onClick={goBack}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <h1 data-testid="text-heading-review" className="text-3xl sm:text-4xl font-light text-foreground/80 tracking-tight">
                    Ready to launch
                  </h1>
                </div>

                <div className="rounded-lg border border-border divide-y divide-border">
                  <div className="p-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Project</p>
                    <p data-testid="text-summary-name" className="text-lg font-medium text-foreground">{projectName || <span className="text-muted-foreground italic">Not named yet</span>}</p>
                  </div>

                  <div className="p-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Repository</p>
                    {selectedRepo ? (
                      <div className="flex items-center gap-2">
                        <Github className="w-4 h-4 text-muted-foreground" />
                        <p data-testid="text-summary-repo" className="text-sm font-medium text-foreground">{selectedRepo.full_name}</p>
                      </div>
                    ) : (
                      <p data-testid="text-summary-repo" className="text-sm text-muted-foreground">None — you can link one later</p>
                    )}
                  </div>

                  <div className="p-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">AI Platforms</p>
                    {enabledPlatforms.length === 0 ? (
                      <p data-testid="text-summary-platforms" className="text-sm text-muted-foreground">None — you can add them later</p>
                    ) : (
                      <div className="space-y-2">
                        {enabledPlatforms.map(([platform, setup]) => {
                          const meta = PLATFORM_META[platform];
                          const Icon = meta.icon;
                          return (
                            <div key={platform} data-testid={`text-summary-platform-${platform}`} className="flex items-center gap-3">
                              <Icon className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm font-medium text-foreground">{meta.label}</span>
                              {setup.branch_name && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <GitBranch className="w-3 h-3" />
                                  {setup.branch_name}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {!projectName.trim() && (
                  <p data-testid="text-name-required" className="text-sm text-red-500">
                    Please go back and enter a project name before launching.
                  </p>
                )}

                <button
                  data-testid="button-launch"
                  onClick={handleLaunch}
                  disabled={isLaunching || !projectName.trim()}
                  className="group flex items-center gap-3 px-8 py-4 rounded-full text-base font-medium bg-foreground text-background shadow-lg cursor-pointer transition-all duration-300 ease-out self-start disabled:opacity-50"
                >
                  {isLaunching ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5" />
                      Launch project
                    </>
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
