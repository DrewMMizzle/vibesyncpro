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
  Activity, CircleCheck, CircleAlert, CircleDot, CircleX, Rocket, GitFork,
  Copy, Terminal, Lightbulb, ArrowRight, Sparkles,
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

interface ActivityEntry {
  id: number;
  event_type: string;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
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

interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
}

interface CommitContext {
  ahead: CommitInfo[];
  behind: CommitInfo[];
  files: { name: string; status: string }[];
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

function getActivityIcon(eventType: string) {
  switch (eventType) {
    case "project_created": return <Rocket className="w-4 h-4" />;
    case "sync_synced": return <CircleCheck className="w-4 h-4" />;
    case "sync_drifted": return <CircleAlert className="w-4 h-4" />;
    case "sync_conflict": return <CircleX className="w-4 h-4" />;
    case "sync_error": return <AlertTriangle className="w-4 h-4" />;
    case "resolve_success": return <GitMerge className="w-4 h-4" />;
    case "resolve_conflict": return <CircleX className="w-4 h-4" />;
    case "branch_merged": return <GitMerge className="w-4 h-4" />;
    case "branch_dismissed": return <EyeOff className="w-4 h-4" />;
    case "branch_assigned": return <Send className="w-4 h-4" />;
    case "branch_conflict": return <CircleX className="w-4 h-4" />;
    default: return <CircleDot className="w-4 h-4" />;
  }
}

function getActivityColor(eventType: string): string {
  switch (eventType) {
    case "project_created": return "text-blue-500";
    case "sync_synced": return "text-green-500";
    case "sync_drifted": return "text-yellow-500";
    case "sync_conflict": return "text-red-500";
    case "sync_error": return "text-red-500";
    case "resolve_success": return "text-green-500";
    case "resolve_conflict": return "text-red-500";
    case "branch_merged": return "text-green-500";
    case "branch_dismissed": return "text-muted-foreground";
    case "branch_assigned": return "text-blue-500";
    case "branch_conflict": return "text-red-500";
    default: return "text-muted-foreground";
  }
}

interface GeniusConflictFile {
  path: string;
  baseContent: string;
  headContent: string;
  headSha: string;
}

function GeniusModal({
  projectId,
  conn,
  onClose,
  onSuccess,
}: {
  projectId: number;
  conn: Connection;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loadPhase, setLoadPhase] = useState<"loading" | "ready" | "error">("loading");
  const [files, setFiles] = useState<GeniusConflictFile[]>([]);
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [fileIndex, setFileIndex] = useState(0);
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [suggestingFor, setSuggestingFor] = useState<string | null>(null);
  const [applyPhase, setApplyPhase] = useState<null | "applying" | "done">(null);
  const [applyResult, setApplyResult] = useState<{ success: boolean; message: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    fetch(`/api/projects/${projectId}/connections/${conn.id}/genius/conflicts`, {
      credentials: "include",
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to load conflicts");
        return data;
      })
      .then((data) => {
        if (!data.files || data.files.length === 0) {
          setErrorMsg(data.message || "No conflicting files detected. Try running a sync first.");
          setLoadPhase("error");
        } else {
          setFiles(data.files);
          setDefaultBranch(data.defaultBranch ?? "main");
          const initial: Record<string, string> = {};
          for (const f of data.files) {
            initial[f.path] = f.headContent;
          }
          setEditedContent(initial);
          setLoadPhase("ready");
        }
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : "Failed to analyze conflicts");
        setLoadPhase("error");
      });
  }, [projectId, conn.id]);

  const currentFile = files[fileIndex];
  const allAccepted = files.length > 0 && files.every((f) => accepted.has(f.path));

  const askGemini = async (file: GeniusConflictFile) => {
    setSuggestingFor(file.path);
    try {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectId}/connections/${conn.id}/genius/suggest`,
        {
          path: file.path,
          baseContent: file.baseContent,
          headContent: file.headContent,
          baseBranch: defaultBranch,
          headBranch: conn.branch_name ?? "agent",
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Gemini failed");
      setEditedContent((c) => ({ ...c, [file.path]: data.resolution }));
      setExplanations((e) => ({ ...e, [file.path]: data.explanation }));
    } catch (err: unknown) {
      toast({
        title: "Gemini couldn't resolve this file",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSuggestingFor(null);
    }
  };

  const acceptFile = (path: string) => {
    setAccepted((s) => new Set([...s, path]));
    if (fileIndex < files.length - 1) setFileIndex(fileIndex + 1);
  };

  const applyAll = async () => {
    setApplyPhase("applying");
    const resolutions = files.map((f) => ({
      path: f.path,
      content: editedContent[f.path] ?? f.headContent,
      sha: f.headSha,
    }));
    try {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectId}/connections/${conn.id}/genius/apply`,
        { resolutions }
      );
      const data = await res.json();
      setApplyResult({
        success: data.success,
        message: data.message ?? (data.success ? "Merge successful!" : "Some conflicts remain"),
      });
      setApplyPhase("done");
      if (data.success) onSuccess();
    } catch (err: unknown) {
      setApplyResult({
        success: false,
        message: err instanceof Error ? err.message : "Apply failed",
      });
      setApplyPhase("done");
    }
  };

  const fileName = (path: string) => path.split("/").pop() ?? path;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/98 backdrop-blur-sm" data-testid="genius-modal">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-background" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Conflict Genius</h2>
            <p className="text-xs text-muted-foreground">
              {PLATFORM_LABELS[conn.platform]} · {conn.branch_name ?? "branch"}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          data-testid="button-genius-close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Loading */}
      {loadPhase === "loading" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
          <div className="text-center">
            <p className="font-medium text-foreground">Analyzing conflicts…</p>
            <p className="text-sm text-muted-foreground mt-1">Fetching file contents from both branches</p>
          </div>
        </div>
      )}

      {/* Error */}
      {loadPhase === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <AlertTriangle className="w-8 h-8 text-muted-foreground" />
          <div className="text-center max-w-md">
            <p className="font-medium text-foreground">Could not load conflicts</p>
            <p className="text-sm text-muted-foreground mt-2">{errorMsg}</p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:border-foreground/40 transition-colors"
          >
            Close
          </button>
        </div>
      )}

      {/* Applying */}
      {applyPhase === "applying" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
          <div className="text-center">
            <p className="font-medium text-foreground">Applying resolutions…</p>
            <p className="text-sm text-muted-foreground mt-1">Writing resolved files and merging branches</p>
          </div>
        </div>
      )}

      {/* Done */}
      {applyPhase === "done" && applyResult && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6">
          {applyResult.success ? (
            <>
              <div className="w-14 h-14 rounded-full bg-green-50 dark:bg-green-950 flex items-center justify-center">
                <CircleCheck className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-center max-w-md">
                <p className="font-semibold text-foreground text-xl">Merge complete</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Conflict Genius resolved {files.length} file{files.length === 1 ? "" : "s"} and merged the branch into your project.
                </p>
              </div>
              <button
                onClick={onClose}
                className="px-6 py-2.5 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
                data-testid="button-genius-done"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-yellow-50 dark:bg-yellow-950 flex items-center justify-center">
                <AlertTriangle className="w-7 h-7 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div className="text-center max-w-md">
                <p className="font-semibold text-foreground text-xl">Partially resolved</p>
                <p className="text-sm text-muted-foreground mt-2">{applyResult.message}</p>
              </div>
              <button
                onClick={onClose}
                className="px-6 py-2.5 rounded-lg border border-border text-sm text-foreground hover:border-foreground/40 transition-colors"
              >
                Close
              </button>
            </>
          )}
        </div>
      )}

      {/* Main working view */}
      {loadPhase === "ready" && !applyPhase && currentFile && (
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — file list (hidden on mobile) */}
          <div className="w-52 border-r border-border flex-shrink-0 overflow-y-auto hidden md:flex flex-col">
            <div className="p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">
                {files.length} conflicting {files.length === 1 ? "file" : "files"}
              </p>
              {files.map((f, i) => (
                <button
                  key={f.path}
                  onClick={() => setFileIndex(i)}
                  title={f.path}
                  className={`w-full text-left px-2 py-2 rounded-md text-xs flex items-center gap-2 transition-colors mb-0.5 ${
                    i === fileIndex
                      ? "bg-foreground text-background"
                      : "text-foreground hover:bg-muted"
                  }`}
                  data-testid={`button-genius-file-${i}`}
                >
                  {accepted.has(f.path) ? (
                    <CircleCheck className="w-3 h-3 flex-shrink-0 text-green-400" />
                  ) : (
                    <CircleDot className="w-3 h-3 flex-shrink-0 opacity-50" />
                  )}
                  <span className="truncate font-mono">{fileName(f.path)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* File header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
              <div>
                <p className="font-mono text-sm font-medium text-foreground truncate max-w-sm" title={currentFile.path}>
                  {currentFile.path}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-muted-foreground">
                    File {fileIndex + 1} of {files.length}
                  </p>
                  {accepted.has(currentFile.path) && (
                    <span className="text-xs text-green-600 font-medium">· Accepted</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setFileIndex(Math.max(0, fileIndex - 1))}
                  disabled={fileIndex === 0}
                  className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setFileIndex(Math.min(files.length - 1, fileIndex + 1))}
                  disabled={fileIndex === files.length - 1}
                  className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>

            {/* Split diff + resolution */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Side-by-side source views */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                    {defaultBranch} (your project)
                  </p>
                  <pre className="text-xs font-mono bg-muted/60 rounded-lg p-3 overflow-auto max-h-52 whitespace-pre-wrap break-all text-foreground/80 border border-border leading-relaxed">
                    {currentFile.baseContent.slice(0, 4000) || "(empty file)"}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                    {conn.branch_name} (agent)
                  </p>
                  <pre className="text-xs font-mono bg-muted/60 rounded-lg p-3 overflow-auto max-h-52 whitespace-pre-wrap break-all text-foreground/80 border border-border leading-relaxed">
                    {currentFile.headContent.slice(0, 4000) || "(empty file)"}
                  </pre>
                </div>
              </div>

              {/* Gemini resolution area */}
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-foreground/[0.02] border-b border-border">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Gemini's resolution</p>
                    {explanations[currentFile.path] && (
                      <span className="text-xs text-muted-foreground hidden sm:block">· edit below if needed</span>
                    )}
                  </div>
                  <button
                    onClick={() => askGemini(currentFile)}
                    disabled={suggestingFor === currentFile.path}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors disabled:opacity-60"
                    data-testid={`button-ask-gemini-${conn.id}`}
                  >
                    {suggestingFor === currentFile.path ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Thinking…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3" />
                        {editedContent[currentFile.path] !== currentFile.headContent
                          ? "Re-ask Gemini"
                          : "Ask Gemini"}
                      </>
                    )}
                  </button>
                </div>

                {explanations[currentFile.path] && (
                  <div className="px-4 py-2.5 text-xs text-muted-foreground italic bg-muted/30 border-b border-border">
                    {explanations[currentFile.path]}
                  </div>
                )}

                <textarea
                  value={editedContent[currentFile.path] ?? ""}
                  onChange={(e) =>
                    setEditedContent((c) => ({ ...c, [currentFile.path]: e.target.value }))
                  }
                  className="w-full min-h-44 p-4 font-mono text-xs bg-transparent text-foreground resize-y focus:outline-none"
                  placeholder="Ask Gemini above to generate a merged version, or type your resolution here…"
                  spellCheck={false}
                  data-testid={`textarea-resolution-${conn.id}`}
                />
              </div>
            </div>

            {/* Footer nav */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-border flex-shrink-0 bg-background">
              <p className="text-xs text-muted-foreground">
                {files.filter((f) => accepted.has(f.path)).length} of {files.length} accepted
              </p>
              <div className="flex items-center gap-3">
                {allAccepted ? (
                  <button
                    onClick={applyAll}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
                    data-testid={`button-genius-apply-${conn.id}`}
                  >
                    <GitMerge className="w-4 h-4" />
                    Apply all & merge
                  </button>
                ) : (
                  <button
                    onClick={() => acceptFile(currentFile.path)}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
                    data-testid={`button-genius-accept-${conn.id}`}
                  >
                    <Check className="w-4 h-4" />
                    {fileIndex < files.length - 1 ? "Accept & next →" : "Accept"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionCommits({ projectId, connId, status, aheadBy, behindBy }: {
  projectId: number;
  connId: number;
  status: Status;
  aheadBy: number;
  behindBy: number;
}) {
  const { data, isLoading } = useQuery<CommitContext>({
    queryKey: ["/api/projects", projectId, "connections", connId, "commits"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: (status === "drifted" || status === "conflict"),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
        <RefreshCw className="w-3 h-3 animate-spin" />
        Loading changes…
      </div>
    );
  }

  if (!data) return null;

  const hasAhead = data.ahead.length > 0;
  const hasBehind = data.behind.length > 0;

  if (!hasAhead && !hasBehind) return null;

  return (
    <div className="mt-3 space-y-3 text-xs">
      {hasAhead && (
        <div>
          <p className="font-medium text-muted-foreground mb-1.5">
            {aheadBy === 1 ? "1 new commit" : `${aheadBy} new commits`} from this agent:
          </p>
          <ul className="space-y-1">
            {data.ahead.map((c) => (
              <li key={c.sha} className="flex items-start gap-2">
                <span className="font-mono text-muted-foreground/70 shrink-0 mt-0.5">{c.sha}</span>
                <span className="text-foreground leading-snug">{c.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasBehind && (
        <div>
          <p className="font-medium text-muted-foreground mb-1.5">
            {behindBy === 1 ? "1 commit" : `${behindBy} commits`} in your project this agent hasn't seen:
          </p>
          <ul className="space-y-1">
            {data.behind.map((c) => (
              <li key={c.sha} className="flex items-start gap-2">
                <span className="font-mono text-muted-foreground/70 shrink-0 mt-0.5">{c.sha}</span>
                <span className="text-foreground leading-snug">{c.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {status === "conflict" && data.files.length > 0 && (
        <div>
          <p className="font-medium text-muted-foreground mb-1.5">Files that diverged:</p>
          <ul className="space-y-0.5">
            {data.files.slice(0, 8).map((f) => (
              <li key={f.name} className="flex items-center gap-1.5 text-foreground/80">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                <span className="font-mono truncate">{f.name}</span>
              </li>
            ))}
            {data.files.length > 8 && (
              <li className="text-muted-foreground">+{data.files.length - 8} more files</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
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
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [launchBanner, setLaunchBanner] = useState(false);
  const [editingBranchConnId, setEditingBranchConnId] = useState<number | null>(null);
  const [editBranchValue, setEditBranchValue] = useState("");
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [guideBranches, setGuideBranches] = useState<Record<number, string>>({});
  const [guideSavedIds, setGuideSavedIds] = useState<Set<number>>(new Set());
  const [guideTargetConns, setGuideTargetConns] = useState<Connection[]>([]);
  const [guideIntroDone, setGuideIntroDone] = useState(false);
  const [dismissedSharedWarning, setDismissedSharedWarning] = useState(false);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("launched") === "1") {
      setLaunchBanner(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      const dismissed = localStorage.getItem(`vsync_shared_warning_dismissed_${projectId}`) === "1";
      setDismissedSharedWarning(dismissed);
    }
  }, [projectId]);

  const linkRepo = useMutation({
    mutationFn: async (repoData: GitHubRepo) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}`, {
        github_repo_url: repoData.html_url,
        github_repo_name: repoData.full_name,
      });
      return res.json();
    },
    onSuccess: (_data, repoData) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowRepoModal(false);
      toast({ title: `Linked ${repoData.full_name}`, description: "AI agents will sync against this repository" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to link repo", description: err.message, variant: "destructive" });
    },
  });

  const unlinkRepo = useMutation({
    mutationFn: async () => {
      const repoNameBeforeUnlink = project?.github_repo_name ?? "repository";
      const res = await apiRequest("PATCH", `/api/projects/${projectId}`, {
        github_repo_url: null,
        github_repo_name: null,
      });
      const json = await res.json();
      return { ...json, _unlinkedName: repoNameBeforeUnlink };
    },
    onSuccess: (data: { _unlinkedName: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: `${data._unlinkedName} removed`, description: "Syncing is paused until you link a new repo" });
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

  const updateConnectionBranch = useMutation({
    mutationFn: async ({ connId, branch_name }: { connId: number; branch_name: string }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/connections/${connId}`, { branch_name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setEditingBranchConnId(null);
      toast({ title: "Working copy updated", description: "VibeSyncPro will now track this branch" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const syncStatus = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/sync`);
      return res.json();
    },
    onSuccess: (data: {
      synced: boolean;
      errors?: Array<{ platform: string; error: string }>;
      connections?: Array<{ platform: string; branch_name: string | null; status: string; ahead_by?: number; behind_by?: number }>;
      default_branch?: string;
    }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "branches", "discovered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "activity"] });
      if (data.default_branch) setDefaultBranch(data.default_branch);
      if (data.synced) {
        const lines = (data.connections ?? []).map((c) => {
          const label = PLATFORM_LABELS[c.platform as Platform] ?? c.platform;
          if (c.status === "synced") return `${label} is in sync.`;
          if (c.status === "drifted" && c.ahead_by && c.ahead_by > 0)
            return `${label} is ${c.ahead_by} ${c.ahead_by === 1 ? "commit" : "commits"} ahead on \`${c.branch_name}\`.`;
          if (c.status === "drifted" && c.behind_by && c.behind_by > 0)
            return `${label} is ${c.behind_by} ${c.behind_by === 1 ? "commit" : "commits"} behind on \`${c.branch_name}\`.`;
          if (c.status === "conflict")
            return `${label} has conflicting changes on \`${c.branch_name}\`.`;
          return `${label}: ${c.status}.`;
        });
        const syncDesc = lines.length > 0
          ? lines.map((line, i) => <span key={i} className="block">{line}</span>)
          : "All branch statuses updated";
        toast({ title: "Sync complete", description: syncDesc });
      } else {
        const failedPlatforms = data.errors?.map((e) => {
          const label = PLATFORM_LABELS[e.platform as Platform] ?? e.platform;
          return label;
        }).join(", ") ?? "unknown";
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
  const [geniusConnId, setGeniusConnId] = useState<number | null>(null);

  const resolveConnection = useMutation({
    mutationFn: async ({ connId, action }: { connId: number; action: "merge_to_default" | "update_from_default" }) => {
      const res = await fetch(`/api/projects/${projectId}/connections/${connId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      if (res.status === 401) {
        const body = await res.json();
        if (body.code === "github_token_missing" || body.code === "github_token_revoked") {
          const { GitHubTokenError } = await import("@/lib/queryClient");
          throw new GitHubTokenError(body.message);
        }
        queryClient.clear();
        window.location.href = "/";
        throw new Error("Session expired");
      }
      if (!res.ok) {
        const body = await res.json();
        if (res.status === 409 && body.conflict_url) {
          const error = new Error(body.message) as Error & { conflict_url: string };
          error.conflict_url = body.conflict_url;
          throw error;
        }
        const error = new Error(body.message || "Resolve failed") as Error & { status: number };
        error.status = res.status;
        throw error;
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "activity"] });
      syncStatus.mutate();
      const conn = project?.platform_connections.find((c) => c.id === variables.connId);
      const branchLabel = conn?.branch_name ?? "branch";
      const defaultLabel = defaultBranch ?? "default branch";
      const title = variables.action === "merge_to_default"
        ? `Merged ${branchLabel} into ${defaultLabel} successfully`
        : `${branchLabel} updated from ${defaultLabel} successfully`;
      toast({ title });
      setConflictInfo(null);
    },
    onError: (err: Error & { conflict_url?: string; status?: number }, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "activity"] });
      if (err.conflict_url) {
        setConflictInfo({ connId: variables.connId, url: err.conflict_url });
        toast({
          title: "Conflict detected",
          description: "These branches edited the same files differently. Open in GitHub to resolve.",
          variant: "destructive",
        });
      } else {
        if ((err as { status?: number }).status === 404) {
          queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
        }
        toast({ title: "Resolve failed", description: err.message, variant: "destructive" });
      }
    },
  });

  const [showDiscovered, setShowDiscovered] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [hasAutoExpanded, setHasAutoExpanded] = useState(false);
  const [triageConflictInfo, setTriageConflictInfo] = useState<{ branchName: string; url: string } | null>(null);

  const { data: discoveredData } = useQuery<{ discovered_branches: DiscoveredBranchItem[] }>({
    queryKey: ["/api/projects", projectId, "branches", "discovered"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId && isLoggedIn && !!project?.github_repo_name,
  });

  const discoveredBranches = discoveredData?.discovered_branches ?? [];

  const { data: activityData } = useQuery<{ activity: ActivityEntry[] }>({
    queryKey: ["/api/projects", projectId, "activity"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!projectId && isLoggedIn,
  });

  const activityEntries = activityData?.activity ?? [];

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
    onSuccess: (data: { discovered_branches?: Array<{ branch_name: string }> }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "branches", "discovered"] });
      const found = data.discovered_branches ?? [];
      if (found.length === 0) {
        toast({ title: "Scan complete", description: "No new branches found" });
      } else {
        const names = found.map((b) => b.branch_name).join(", ");
        toast({ title: "Scan complete", description: `Found ${found.length} untracked ${found.length === 1 ? "branch" : "branches"}: ${names}` });
      }
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
      if (res.status === 401) {
        const body = await res.json();
        if (body.code === "github_token_missing" || body.code === "github_token_revoked") {
          const { GitHubTokenError } = await import("@/lib/queryClient");
          throw new GitHubTokenError(body.message);
        }
        queryClient.clear();
        window.location.href = "/";
        throw new Error("Session expired");
      }
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "branches", "discovered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "activity"] });
      const defaultLabel = defaultBranch ?? "default branch";
      let title: string;
      switch (variables.action) {
        case "merge_to_default":
          title = `Merged ${variables.branchName} into ${defaultLabel}`;
          break;
        case "merge_to_platform":
          title = `Merged ${variables.branchName} into ${variables.platform_branch ?? "platform branch"}`;
          break;
        case "assign_to_replit":
          title = `Assigned ${variables.branchName} to Replit Agent`;
          break;
        case "dismiss":
          title = `Dismissed ${variables.branchName}`;
          break;
        default:
          title = "Action completed";
      }
      const description = variables.action === "dismiss" ? "It will resurface if new commits appear" : undefined;
      toast({ title, description });
      setTriageConflictInfo(null);
      scanBranches.mutate();
    },
    onError: (err: Error & { conflict_url?: string }, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "activity"] });
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

  const DEFAULT_BRANCH_KEY = "__default__";
  const normalizeBranch = (b: string | null) =>
    !b || (defaultBranch && b === defaultBranch) ? DEFAULT_BRANCH_KEY : b;
  const branchCounts = new Map<string, number>();
  for (const conn of project.platform_connections) {
    const key = normalizeBranch(conn.branch_name);
    branchCounts.set(key, (branchCounts.get(key) ?? 0) + 1);
  }
  const hasSharedBranch = project.platform_connections.length >= 2 &&
    Array.from(branchCounts.values()).some((count) => count >= 2);
  const sharedBranchConnections = hasSharedBranch
    ? project.platform_connections.filter((c) => {
        const key = normalizeBranch(c.branch_name);
        return (branchCounts.get(key) ?? 0) >= 2;
      })
    : [];

  const SUGGESTED_BRANCH: Record<Platform, string> = {
    replit: "replit-agent",
    claude_code: "claude-code",
    computer: "computer-use",
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied!", description: text.length > 60 ? text.slice(0, 60) + "…" : text });
    });
  };

  const openSetupGuide = () => {
    const snapshot = [...sharedBranchConnections];
    const initial: Record<number, string> = {};
    for (const conn of snapshot) {
      initial[conn.id] = SUGGESTED_BRANCH[conn.platform] ?? "";
    }
    setGuideTargetConns(snapshot);
    setGuideBranches(initial);
    setGuideSavedIds(new Set());
    setGuideIntroDone(false);
    setShowSetupGuide(true);
  };

  const savedGuideValues = guideTargetConns
    .filter((c) => guideSavedIds.has(c.id))
    .map((c) => guideBranches[c.id]?.trim() ?? "");
  const allSavedGuideUnique = savedGuideValues.length > 0 &&
    new Set(savedGuideValues).size === savedGuideValues.length &&
    savedGuideValues.every((v) => v.length > 0);
  const allGuideConnectionsSaved = guideTargetConns.length > 0 &&
    guideTargetConns.every((c) => guideSavedIds.has(c.id)) &&
    allSavedGuideUnique;

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
        <AnimatePresence>
          {launchBanner && project && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.3 }}
              data-testid="banner-launch"
              className="mb-8 p-5 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Rocket className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p data-testid="text-launch-title" className="font-medium text-green-800 dark:text-green-300">
                      {project.name} is ready to go
                    </p>
                    <p data-testid="text-launch-details" className="text-sm text-green-700/80 dark:text-green-400/70 mt-1">
                      {project.github_repo_name ? `Linked to ${project.github_repo_name}` : "No repo linked yet"}
                      {project.platform_connections.length > 0
                        ? ` · ${project.platform_connections.map((c) => PLATFORM_LABELS[c.platform]).join(", ")} connected`
                        : " · No agents connected yet"}
                    </p>
                  </div>
                </div>
                <button
                  data-testid="button-dismiss-launch"
                  onClick={() => setLaunchBanner(false)}
                  className="text-green-600/60 hover:text-green-700 dark:text-green-400/60 dark:hover:text-green-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
                onBlur={() => {
                  if (editName.trim() && editName.trim() !== project.name) {
                    updateProject.mutate({ name: editName.trim() });
                  } else {
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
                onBlur={() => {
                  const trimmed = editDesc.trim() || null;
                  if (trimmed !== (project.description ?? null)) {
                    updateProject.mutate({ description: trimmed });
                  } else {
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

        {/* Shared-branch warning */}
        {hasSharedBranch && !dismissedSharedWarning && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            data-testid="banner-shared-branch"
            className="mb-6 p-5 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p data-testid="text-shared-warning-title" className="font-medium text-yellow-800 dark:text-yellow-300">
                    Your AI tools are editing the same copy of your code
                  </p>
                  <p className="text-sm text-yellow-700/80 dark:text-yellow-400/70 mt-1">
                    This can cause them to overwrite each other's work. We recommend giving each tool its own workspace.
                  </p>
                  <button
                    data-testid="button-open-setup-guide"
                    onClick={openSetupGuide}
                    className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-md bg-yellow-600 text-white text-sm font-medium hover:bg-yellow-700 transition-colors"
                  >
                    Help me set up separate working copies
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <button
                data-testid="button-dismiss-shared-warning"
                onClick={() => {
                  setDismissedSharedWarning(true);
                  if (projectId) localStorage.setItem(`vsync_shared_warning_dismissed_${projectId}`, "1");
                }}
                className="text-yellow-600/50 hover:text-yellow-600 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

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
                        {editingBranchConnId === conn.id ? (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <GitBranch className="w-3 h-3 text-muted-foreground" />
                            <input
                              data-testid={`input-edit-branch-${conn.id}`}
                              type="text"
                              value={editBranchValue}
                              onChange={(e) => setEditBranchValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && editBranchValue.trim()) {
                                  updateConnectionBranch.mutate({ connId: conn.id, branch_name: editBranchValue.trim() });
                                }
                                if (e.key === "Escape") setEditingBranchConnId(null);
                              }}
                              className="px-1.5 py-0.5 text-xs rounded border border-border bg-background text-foreground focus:border-foreground focus:outline-none w-36"
                              autoFocus
                            />
                            <button
                              data-testid={`button-save-branch-${conn.id}`}
                              onClick={() => {
                                if (editBranchValue.trim()) {
                                  updateConnectionBranch.mutate({ connId: conn.id, branch_name: editBranchValue.trim() });
                                }
                              }}
                              disabled={!editBranchValue.trim() || updateConnectionBranch.isPending}
                              className="text-green-600 hover:text-green-700 disabled:opacity-40"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              data-testid={`button-cancel-branch-${conn.id}`}
                              onClick={() => setEditingBranchConnId(null)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : conn.branch_name ? (
                          <button
                            data-testid={`button-edit-branch-${conn.id}`}
                            onClick={() => {
                              setEditingBranchConnId(conn.id);
                              setEditBranchValue(conn.branch_name ?? "");
                            }}
                            className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 hover:text-foreground transition-colors group"
                          >
                            <GitBranch className="w-3 h-3" />
                            {conn.branch_name}
                            <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        ) : (
                          <button
                            data-testid={`button-set-branch-${conn.id}`}
                            onClick={() => {
                              setEditingBranchConnId(conn.id);
                              setEditBranchValue(SUGGESTED_BRANCH[conn.platform] ?? "");
                            }}
                            className="text-xs text-muted-foreground/50 mt-0.5 flex items-center gap-1 hover:text-blue-600 transition-colors"
                          >
                            No branch set
                            <span className="flex items-center gap-0.5 text-blue-500">
                              <Plus className="w-2.5 h-2.5" />
                              Set branch
                            </span>
                          </button>
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
                        <div>
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
                          <ConnectionCommits
                            projectId={project.id}
                            connId={conn.id}
                            status={conn.status}
                            aheadBy={conn.ahead_by}
                            behindBy={conn.behind_by}
                          />
                        </div>
                      )}

                      {isBehind && (
                        <div>
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
                          <ConnectionCommits
                            projectId={project.id}
                            connId={conn.id}
                            status={conn.status}
                            aheadBy={conn.ahead_by}
                            behindBy={conn.behind_by}
                          />
                        </div>
                      )}

                      {isConflict && (
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <p data-testid={`text-resolution-${conn.id}`} className="text-sm text-muted-foreground">
                              Both your project ({conn.behind_by} {conn.behind_by === 1 ? "commit" : "commits"}) and this agent ({conn.ahead_by} {conn.ahead_by === 1 ? "commit" : "commits"}) have new changes that need to be combined.
                            </p>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                data-testid={`button-auto-resolve-${conn.id}`}
                                onClick={() => resolveConnection.mutate({ connId: conn.id, action: "merge_to_default" })}
                                disabled={isResolving}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-yellow-600 text-white hover:bg-yellow-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                <Zap className="w-3.5 h-3.5" />
                                {isResolving ? "Resolving..." : "Auto-resolve"}
                              </button>
                              <button
                                data-testid={`button-conflict-genius-${conn.id}`}
                                onClick={() => setGeniusConnId(conn.id)}
                                disabled={isResolving}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                Conflict Genius
                              </button>
                            </div>
                          </div>
                          <ConnectionCommits
                            projectId={project.id}
                            connId={conn.id}
                            status={conn.status}
                            aheadBy={conn.ahead_by}
                            behindBy={conn.behind_by}
                          />

                          {conflictInfo && conflictInfo.connId === conn.id && (
                            <div data-testid={`conflict-message-${conn.id}`} className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                  <p className="text-sm text-red-700 dark:text-red-300">
                                    These branches edited the same files differently. Auto-resolve couldn't handle it automatically.
                                  </p>
                                  <div className="flex items-center gap-3 mt-2">
                                    <button
                                      onClick={() => setGeniusConnId(conn.id)}
                                      className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground bg-foreground/5 hover:bg-foreground/10 px-2.5 py-1 rounded-md transition-colors"
                                      data-testid={`button-genius-from-conflict-${conn.id}`}
                                    >
                                      <Sparkles className="w-3.5 h-3.5" />
                                      Fix with Conflict Genius
                                    </button>
                                    <a
                                      href={conflictInfo.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      data-testid={`link-conflict-${conn.id}`}
                                      className="inline-flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 hover:underline"
                                    >
                                      Open in GitHub
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  </div>
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
                                <p data-testid={`text-discovered-lastcommit-${branch.id}`} className="text-[10px] text-muted-foreground mt-1 ml-6">
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
        {/* Activity Log */}
        <div className="mt-10">
          <button
            data-testid="button-toggle-activity"
            onClick={() => setShowActivity(!showActivity)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors mb-4"
          >
            {showActivity ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <Activity className="w-4 h-4" />
            Activity
            {activityEntries.length > 0 && (
              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                {activityEntries.length}
              </span>
            )}
          </button>

          <AnimatePresence>
            {showActivity && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                {activityEntries.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-border rounded-lg">
                    <Activity className="w-6 h-6 mx-auto text-muted-foreground/40 mb-2" />
                    <p data-testid="text-no-activity" className="text-muted-foreground text-sm">
                      No activity yet. Events will appear here as you sync, merge, and manage branches.
                    </p>
                  </div>
                ) : (
                  <div className="border border-border rounded-lg divide-y divide-border">
                    {activityEntries.map((entry) => {
                      const icon = getActivityIcon(entry.event_type);
                      const color = getActivityColor(entry.event_type);
                      return (
                        <div
                          key={entry.id}
                          data-testid={`activity-entry-${entry.id}`}
                          className="px-4 py-3 flex items-start gap-3"
                        >
                          <span className={`mt-0.5 flex-shrink-0 ${color}`}>
                            {icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p data-testid={`activity-desc-${entry.id}`} className="text-sm text-foreground">
                              {entry.description}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p data-testid={`activity-time-${entry.id}`} className="text-[10px] text-muted-foreground">
                                {timeAgo(entry.created_at)}
                              </p>
                              {typeof entry.metadata === "object" && entry.metadata !== null && !!(entry.metadata as Record<string, unknown>).branch && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <GitBranch className="w-2.5 h-2.5" />
                                  {String((entry.metadata as Record<string, unknown>).branch)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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
                      Branch {!project.github_repo_name && <span className="text-muted-foreground">(link a repo first for branch picker)</span>}
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

      {/* Setup Guide Modal */}
      <AnimatePresence>
        {showSetupGuide && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black z-40"
              onClick={() => setShowSetupGuide(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.25 }}
              className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]"
            >
              <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-lg p-6 sm:p-8 relative" onClick={(e) => e.stopPropagation()}>
                <button
                  data-testid="button-close-setup-guide"
                  onClick={() => setShowSetupGuide(false)}
                  className="absolute top-4 right-4 text-muted-foreground/50 hover:text-foreground transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>

                {!guideIntroDone ? (
                  <motion.div
                    key="guide-intro"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex items-center justify-center w-14 h-14 rounded-full bg-yellow-100 dark:bg-yellow-950/50 mb-6">
                      <Lightbulb className="w-7 h-7 text-yellow-500" />
                    </div>
                    <h2 data-testid="text-guide-heading" className="text-xl font-medium text-foreground pr-8 mb-3">
                      What's a working copy?
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                      Think of your project like a shared notebook. Right now, your AI tools are all writing in the same notebook at the same time — which can cause one to overwrite another's work.
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-8">
                      We're going to give each tool its own private copy. When they're done, VibeSyncPro combines everything back together automatically. No technical knowledge needed.
                    </p>
                    <button
                      data-testid="button-guide-start"
                      onClick={() => setGuideIntroDone(true)}
                      className="flex items-center gap-2 px-6 py-3 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                      Got it, let's start
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </motion.div>
                ) : !allGuideConnectionsSaved ? (
                  <motion.div
                    key="guide-platforms"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <h2 data-testid="text-guide-platforms-heading" className="text-xl font-medium text-foreground pr-8 mb-2">
                      Let's give each AI tool its own workspace
                    </h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      Follow the steps below for each tool. Come back here when you're done.
                    </p>

                    <div className="space-y-5">
                      {guideTargetConns.map((conn) => {
                        const label = PLATFORM_LABELS[conn.platform];
                        const isSaved = guideSavedIds.has(conn.id);
                        const branchVal = guideBranches[conn.id] ?? "";

                        return (
                          <div
                            key={conn.id}
                            data-testid={`guide-card-${conn.platform}`}
                            className={`p-4 rounded-lg border transition-colors ${isSaved ? "border-green-300 dark:border-green-700 bg-green-50/30 dark:bg-green-950/20" : "border-border"}`}
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-muted-foreground">{PLATFORM_ICONS[conn.platform]}</span>
                              <h3 className="text-sm font-medium text-foreground">
                                Give {label} its own workspace
                              </h3>
                              {isSaved && <CircleCheck className="w-4 h-4 text-green-600 ml-auto" />}
                            </div>

                            {!isSaved && (
                              <>
                                {conn.platform === "replit" && (
                                  <div className="space-y-2.5 mb-4">
                                    <div className="flex items-start gap-2">
                                      <span className="text-xs font-medium text-foreground/60 w-5 flex-shrink-0 mt-0.5">1.</span>
                                      <div>
                                        <p className="text-xs text-muted-foreground">Open your Replit project.</p>
                                        {project.github_repo_name && (
                                          <a
                                            href={`https://replit.com/new/github/${project.github_repo_name}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 mt-1 text-xs text-blue-600 hover:text-blue-700"
                                          >
                                            <ExternalLink className="w-3 h-3" />
                                            Open in Replit
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-start gap-2">
                                      <span className="text-xs font-medium text-foreground/60 w-5 flex-shrink-0 mt-0.5">2.</span>
                                      <p className="text-xs text-muted-foreground">
                                        In Replit, look for the Git panel on the left sidebar (the branch icon). Click it, then click "New branch". Name it: <span className="font-mono font-medium text-foreground/70">replit-agent</span>
                                      </p>
                                    </div>
                                  </div>
                                )}

                                {conn.platform === "claude_code" && (
                                  <div className="space-y-2.5 mb-4">
                                    <div className="flex items-start gap-2">
                                      <span className="text-xs font-medium text-foreground/60 w-5 flex-shrink-0 mt-0.5">1.</span>
                                      <div className="flex-1">
                                        <p className="text-xs text-muted-foreground mb-1.5">In your terminal, run this command to create a private workspace:</p>
                                        <button
                                          onClick={() => copyToClipboard("git checkout -b claude-code")}
                                          className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-foreground/5 border border-border text-xs font-mono text-foreground/80 hover:bg-foreground/10 transition-colors"
                                        >
                                          <Terminal className="w-3 h-3 flex-shrink-0" />
                                          git checkout -b claude-code
                                          <Copy className="w-3 h-3 flex-shrink-0 text-muted-foreground ml-auto" />
                                        </button>
                                      </div>
                                    </div>
                                    <div className="flex items-start gap-2">
                                      <span className="text-xs font-medium text-foreground/60 w-5 flex-shrink-0 mt-0.5">2.</span>
                                      <p className="text-xs text-muted-foreground">
                                        Then start Claude by running: <span className="font-mono font-medium text-foreground/70">claude</span>
                                      </p>
                                    </div>
                                  </div>
                                )}

                                {conn.platform === "computer" && (
                                  <div className="space-y-2.5 mb-4">
                                    <div className="flex items-start gap-2">
                                      <span className="text-xs font-medium text-foreground/60 w-5 flex-shrink-0 mt-0.5">1.</span>
                                      <div className="flex-1">
                                        <p className="text-xs text-muted-foreground mb-1.5">In your terminal, create a private workspace:</p>
                                        <button
                                          onClick={() => copyToClipboard("git checkout -b computer-use")}
                                          className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-foreground/5 border border-border text-xs font-mono text-foreground/80 hover:bg-foreground/10 transition-colors"
                                        >
                                          <Terminal className="w-3 h-3 flex-shrink-0" />
                                          git checkout -b computer-use
                                          <Copy className="w-3 h-3 flex-shrink-0 text-muted-foreground ml-auto" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                <div className="mb-3">
                                  <label className="text-[11px] text-muted-foreground block mb-1">What did you name the branch?</label>
                                  <input
                                    data-testid={`input-guide-branch-${conn.platform}`}
                                    type="text"
                                    value={branchVal}
                                    onChange={(e) => setGuideBranches((prev) => ({ ...prev, [conn.id]: e.target.value }))}
                                    placeholder={SUGGESTED_BRANCH[conn.platform]}
                                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:border-foreground focus:outline-none transition-colors placeholder:text-muted-foreground/30"
                                  />
                                </div>

                                <button
                                  data-testid={`button-guide-save-${conn.platform}`}
                                  onClick={() => {
                                    const val = branchVal.trim();
                                    if (!val) return;
                                    const alreadyUsed = guideTargetConns
                                      .filter((c) => c.id !== conn.id && guideSavedIds.has(c.id))
                                      .some((c) => (guideBranches[c.id]?.trim() ?? "") === val);
                                    if (alreadyUsed) {
                                      toast({ title: "Branch name already used", description: "Each AI tool needs a unique branch name. Pick a different one.", variant: "destructive" });
                                      return;
                                    }
                                    updateConnectionBranch.mutate(
                                      { connId: conn.id, branch_name: val },
                                      {
                                        onSuccess: () => {
                                          setGuideSavedIds((prev) => new Set(Array.from(prev).concat(conn.id)));
                                        },
                                      }
                                    );
                                  }}
                                  disabled={!branchVal.trim() || updateConnectionBranch.isPending}
                                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                                >
                                  {updateConnectionBranch.isPending ? "Saving..." : "Done — update VibeSyncPro"}
                                </button>
                              </>
                            )}

                            {isSaved && (
                              <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1.5">
                                <Check className="w-3 h-3" />
                                Updated to <span className="font-mono">{branchVal}</span>
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                ) : (
                  <div className="text-center py-8">
                    <CircleCheck className="w-10 h-10 text-green-600 mx-auto mb-4" />
                    <h2 data-testid="text-guide-complete" className="text-lg font-medium text-foreground mb-2">
                      All set! Each AI tool now has its own workspace.
                    </h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      VibeSyncPro will keep them in sync and alert you if they drift apart.
                    </p>
                    <button
                      data-testid="button-guide-close"
                      onClick={() => {
                        setShowSetupGuide(false);
                        setDismissedSharedWarning(true);
                        if (projectId) localStorage.setItem(`vsync_shared_warning_dismissed_${projectId}`, "1");
                      }}
                      className="px-6 py-2.5 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Conflict Genius modal — full screen overlay */}
      <AnimatePresence>
        {geniusConnId !== null && (() => {
          const geniusConn = project.platform_connections?.find((c) => c.id === geniusConnId) ?? null;
          if (!geniusConn) return null;
          return (
            <motion.div
              key="genius-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50"
            >
              <GeniusModal
                projectId={project.id}
                conn={geniusConn}
                onClose={() => setGeniusConnId(null)}
                onSuccess={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id] });
                  queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id, "connections", geniusConnId, "commits"] });
                }}
              />
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
