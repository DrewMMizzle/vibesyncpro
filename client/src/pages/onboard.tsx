import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight, ArrowLeft, Check, Sparkles, Github, GitFork,
  Monitor, Bot, Globe, GitBranch, Zap, Search, Loader2,
} from "lucide-react";

type Platform = "replit" | "claude_code" | "computer";
type StartingPoint = "fresh" | "existing" | "fork";

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

  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState("");
  const [startingPoint, setStartingPoint] = useState<StartingPoint | null>(null);
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
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !isLoggedIn) {
      window.location.href = `/auth/github?redirect=${encodeURIComponent("/onboard")}`;
    }
  }, [authLoading, isLoggedIn]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get("name");
    if (name) {
      setProjectName(name);
      setStep(2);
      return;
    }
    const stored = sessionStorage.getItem("onboard_name");
    if (stored) {
      setProjectName(stored);
      sessionStorage.removeItem("onboard_name");
      setStep(2);
    }
  }, []);

  useEffect(() => {
    if (step === 1 && nameInputRef.current) nameInputRef.current.focus();
  }, [step]);

  const { data: repos, isLoading: reposLoading } = useQuery<GitHubRepo[]>({
    queryKey: ["/api/github/repos"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: isLoggedIn && step === 2 && startingPoint === "existing",
  });

  const repoOwner = selectedRepo?.full_name?.split("/")[0];
  const repoName = selectedRepo?.full_name?.split("/")[1];

  const { data: branches } = useQuery<GitHubBranch[]>({
    queryKey: ["/api/github/repos", repoOwner, repoName, "branches"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!selectedRepo && step === 3,
  });

  const lookupPublicRepo = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("GET", `/api/github/repos/public?url=${encodeURIComponent(url)}`);
      return res.json() as Promise<GitHubRepo>;
    },
  });

  const forkRepo = useMutation({
    mutationFn: async (repoFullName: string) => {
      const res = await apiRequest("POST", `/api/github/fork`, { repo_full_name: repoFullName });
      return res.json() as Promise<GitHubRepo>;
    },
  });

  const filteredRepos = repos?.filter((r) =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  ) ?? [];

  const goNext = () => setStep((s) => s + 1);
  const goBack = () => setStep((s) => s - 1);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (projectName.trim()) goNext();
  };

  const handlePickStartingPoint = (sp: StartingPoint) => {
    setStartingPoint(sp);
    if (sp === "fresh") {
      setSelectedRepo(null);
      setStep(3);
    }
  };

  const handleSelectRepo = (repo: GitHubRepo) => {
    setSelectedRepo(repo);
    goNext();
  };

  const handleExistingUrlResolve = async () => {
    if (!existingRepoUrl.trim()) return;
    try {
      const repo = await lookupPublicRepo.mutateAsync(existingRepoUrl.trim());
      setSelectedRepo(repo);
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
      const forked = await forkRepo.mutateAsync(resolvedForkRepo.full_name);
      setSelectedRepo(forked);
      toast({ title: "Forked!", description: `${resolvedForkRepo.full_name} forked to your account` });
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

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json();
        throw new Error(errBody.message || "Failed to create project");
      }
      const project = await res.json() as { id: number };
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      navigate(`/projects/${project.id}`);
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

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <header className="absolute top-0 left-0 right-0 p-6 sm:p-8 z-10 flex items-center justify-between">
        <span data-testid="text-wordmark" className="text-sm font-medium tracking-wide text-muted-foreground/50 select-none">
          VibeSyncPro
        </span>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              data-testid={`indicator-step-${s}`}
              className={`w-2 h-2 rounded-full transition-colors ${s === step ? "bg-foreground" : s < step ? "bg-foreground/40" : "bg-muted-foreground/20"}`}
            />
          ))}
        </div>
      </header>

      <main className="min-h-screen w-full flex items-center justify-center p-6 sm:p-12" style={{ paddingBottom: "10vh" }}>
        <div className="w-full max-w-2xl mx-auto">
          <AnimatePresence mode="wait">
            {/* STEP 1: Name */}
            {step === 1 && (
              <motion.form
                key="step1"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                onSubmit={handleNameSubmit}
                className="flex flex-col gap-10"
              >
                <motion.h1
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                  data-testid="text-heading-step1"
                  className="text-4xl sm:text-5xl md:text-6xl font-light text-muted-foreground/40 tracking-tight"
                >
                  What are you building?
                </motion.h1>

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

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.5 }}>
                  <button
                    type="submit"
                    data-testid="button-next-step1"
                    disabled={!projectName.trim()}
                    className={`group flex items-center gap-3 px-8 py-4 rounded-full text-base font-medium transition-all duration-300 ease-out ${
                      projectName.trim()
                        ? "bg-foreground text-background shadow-lg cursor-pointer"
                        : "bg-muted-foreground/15 text-muted-foreground/40 cursor-not-allowed"
                    }`}
                  >
                    Continue
                    <ArrowRight className={`w-5 h-5 transition-transform duration-300 ${projectName.trim() ? "group-hover:translate-x-1" : ""}`} />
                  </button>
                </motion.div>
              </motion.form>
            )}

            {/* STEP 2: Starting Point */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                className="flex flex-col gap-8"
              >
                <div>
                  <button
                    data-testid="button-back-step2"
                    onClick={goBack}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <h1 data-testid="text-heading-step2" className="text-3xl sm:text-4xl font-light text-muted-foreground/40 tracking-tight">
                    Where's your code?
                  </h1>
                </div>

                {!startingPoint && (
                  <div className="grid gap-4">
                    {([
                      { id: "fresh" as StartingPoint, icon: Sparkles, title: "Starting fresh", desc: "I'll set up a repo later" },
                      { id: "existing" as StartingPoint, icon: Github, title: "I have a GitHub repo", desc: "Connect an existing repository" },
                      { id: "fork" as StartingPoint, icon: GitFork, title: "Fork a public repo", desc: "Copy someone else's repo and build on it" },
                    ]).map((option) => (
                      <button
                        key={option.id}
                        data-testid={`button-start-${option.id}`}
                        onClick={() => handlePickStartingPoint(option.id)}
                        className="flex items-center gap-4 p-5 rounded-lg border border-border hover:border-foreground/30 hover:shadow-sm transition-all text-left group"
                      >
                        <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center flex-shrink-0 group-hover:bg-foreground/10 transition-colors">
                          <option.icon className="w-5 h-5 text-foreground/60" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{option.title}</p>
                          <p className="text-sm text-muted-foreground">{option.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {startingPoint === "existing" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col gap-4"
                  >
                    <button
                      data-testid="button-back-starting-point"
                      onClick={() => { setStartingPoint(null); setExistingUrlMode(false); setExistingRepoUrl(""); lookupPublicRepo.reset(); }}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      Choose differently
                    </button>

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
                      <>
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
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
                  </motion.div>
                )}

                {startingPoint === "fork" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col gap-4"
                  >
                    <button
                      data-testid="button-back-starting-point-fork"
                      onClick={() => { setStartingPoint(null); setForkUrl(""); setResolvedForkRepo(null); lookupPublicRepo.reset(); }}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      Choose differently
                    </button>

                    <p className="text-sm text-muted-foreground">
                      Paste a public GitHub URL — we'll fork it to your account so your AI agents can work on it.
                    </p>

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
                          disabled={forkRepo.isPending}
                          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-foreground text-background font-medium transition-opacity disabled:opacity-50 self-start"
                        >
                          {forkRepo.isPending ? (
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
              </motion.div>
            )}

            {/* STEP 3: Platform Agents */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                className="flex flex-col gap-8"
              >
                <div>
                  <button
                    data-testid="button-back-step3"
                    onClick={() => {
                      if (startingPoint === "fresh") {
                        setStartingPoint(null);
                        setStep(2);
                      } else {
                        goBack();
                      }
                    }}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <h1 data-testid="text-heading-step3" className="text-3xl sm:text-4xl font-light text-muted-foreground/40 tracking-tight">
                    Who's working on it?
                  </h1>
                  <p className="text-sm text-muted-foreground mt-2">
                    Toggle which AI platforms are active on this project and pick their branches.
                    {!selectedRepo && " (You can add these later after linking a repo.)"}
                  </p>
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
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>

                <button
                  data-testid="button-next-step3"
                  onClick={goNext}
                  className="group flex items-center gap-3 px-8 py-4 rounded-full text-base font-medium bg-foreground text-background shadow-lg cursor-pointer transition-all duration-300 ease-out self-start"
                >
                  Review & Launch
                  <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                </button>
              </motion.div>
            )}

            {/* STEP 4: Summary & Launch */}
            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={transition}
                className="flex flex-col gap-8"
              >
                <div>
                  <button
                    data-testid="button-back-step4"
                    onClick={goBack}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <h1 data-testid="text-heading-step4" className="text-3xl sm:text-4xl font-light text-muted-foreground/40 tracking-tight">
                    Ready to launch
                  </h1>
                </div>

                <div className="rounded-lg border border-border divide-y divide-border">
                  <div className="p-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Project</p>
                    <p data-testid="text-summary-name" className="text-lg font-medium text-foreground">{projectName}</p>
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

                <button
                  data-testid="button-launch"
                  onClick={handleLaunch}
                  disabled={isLaunching}
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
