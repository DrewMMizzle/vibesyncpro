# replit.md

## Overview

This is a full-stack web application called **VibeSyncPro** — a project creation and synchronization tool. Users enter a project description, authenticate via GitHub OAuth, and manage projects across platforms. The UI features smooth Framer Motion animations.

The app uses a monorepo-style structure with three main areas:
- `client/` — React frontend (Vite + TypeScript)
- `server/` — Express.js backend (Node.js + TypeScript)
- `shared/` — Shared types, schemas, and route definitions used by both client and server

---

## User Preferences

Preferred communication style: Simple, everyday language.

---

## System Architecture

### Frontend Architecture

- **Framework**: React 18 with TypeScript, bundled by Vite
- **Routing**: `wouter` — pages: `/` (Home), `/onboard` (Onboarding Wizard), `/dashboard` (Dashboard), `/projects/:id` (Project Detail), catch-all 404
- **State / Data Fetching**: TanStack Query (React Query v5) for server state; mutations use `useMutation`
- **Auth Hook**: `useAuth()` in `client/src/hooks/use-auth.ts` queries `GET /auth/me` for current user state
- **UI Components**: shadcn/ui (New York style) built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light + dark mode support)
- **Animations**: Framer Motion for page/form transitions
- **Form Handling**: React Hook Form with `@hookform/resolvers` + Zod validation
- **Path Aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`

### Backend Architecture

- **Framework**: Express.js v5 (Node.js), run with `tsx` for TypeScript support
- **Entry point**: `server/index.ts` creates an HTTP server, registers routes, and serves static files in production
- **Auth**: GitHub OAuth flow in `server/src/routes/auth.ts` (routes: `/auth/github`, `/auth/github/callback`, `/auth/me`, `/auth/logout`)
- **Session**: `express-session` with `memorystore` (in-memory), configured in `server/src/middleware/session.ts`
- **Routes**: Auth routes at `/auth/*`, user routes at `/api/me`, project routes at `/api/projects`, GitHub routes at `/api/github/*`
- **GitHub endpoints**: `GET /api/github/repos` (list user repos), `GET /api/github/repos/:owner/:repo/branches` (list branches), `GET /api/github/repos/public?url=` (resolve public repo from URL), `POST /api/github/fork` (fork repo to user account)
- **Atomic project creation**: `POST /api/projects` accepts optional `github_repo_name`, `github_repo_url`, `connections[]` — creates project, links repo, creates connections, and runs initial sync in one call
- **Storage layer**: `server/storage.ts` provides a `DatabaseStorage` class implementing an `IStorage` interface using Drizzle ORM + PostgreSQL
- **Dev server**: In development, Vite runs as middleware inside the Express server (see `server/vite.ts`)
- **Production build**: `script/build.ts` runs Vite for the client, then esbuild to bundle the server into `dist/index.cjs`

### Shared Layer (API Contract)

- `shared/schema.ts` — Drizzle ORM table definitions (`users`, `projects`, `platform_connections`) + Zod schemas via `drizzle-zod`
- `shared/routes.ts` — Centralized API route definitions (path, method, input schema, response schemas)

### Database

- **Database**: PostgreSQL (single database, all tables)
- **ORM**: Drizzle ORM with `drizzle-kit` for schema push
- **Tables**: `users` (GitHub OAuth), `projects` (user_id, name, description, GitHub fields), `platform_connections` (project_id, platform, status), `discovered_branches` (project_id, branch scan data), `activity_log` (project_id, event audit trail)
- **Connection**: Uses `pg` (node-postgres) Pool, connection string from `DATABASE_URL` environment variable
- **Schema sync**: Run via `npm run db:push`

### Authentication Flow

1. Landing page (`/`) shows five path cards: Fresh, Replit, Claude Code, Existing GitHub, Fork. Clicking a card stores the chosen path in sessionStorage and triggers GitHub auth if not logged in, or navigates to `/onboard?path=<value>`.
2. If not logged in → redirects to `/auth/github?redirect=/onboard` → GitHub OAuth → callback creates/updates user → redirects to stored `postAuthRedirect` session path (allowlisted: `/onboard`, `/dashboard`; default: `/dashboard`)
3. Onboard wizard reads `?path=` param (or sessionStorage fallback). Step flows vary by path:
   - `fresh`: name → agents → review (3 steps)
   - `replit`: repo → agents (Replit pre-selected) → name → review (4 steps)
   - `claude_code`: repo → agents (Claude Code pre-selected) → name → review (4 steps)
   - `existing`: repo → agents → name → review (4 steps)
   - `fork`: fork URL → agents → name → review (4 steps)
   - No path (from dashboard): shows path-card picker as step 1, then follows chosen path
4. Dashboard "New Project" button → navigates to `/onboard` (no path param, shows picker)

### Platform Connections & GitHub Sync

Each project can have up to 3 platform connections: `replit`, `claude_code`, `computer`.

- Connections are managed via the project detail page (`/projects/:id`)
- Each connection has a status: `disconnected`, `connected`, `synced`, `drifted`, `conflict`
- Status is automatically determined by comparing each platform's branch against the repo's default branch via GitHub's Compare API
- Only one connection per platform per project is allowed
- A "Refresh Sync" button triggers `POST /api/projects/:id/sync` to re-compare all branches
- GitHub repo linking: `PATCH /api/projects/:id` saves `github_repo_url` and `github_repo_name`
- GitHub API proxy: `GET /api/github/repos` (list user repos), `GET /api/github/repos/:owner/:repo/branches` (list branches)
- Connection CRUD: `POST /api/projects/:id/connections`, `PATCH /api/projects/:id/connections/:connId`, `DELETE /api/projects/:id/connections/:connId`
- Sync status logic: ahead=0 & behind=0 → synced; both >0 → conflict; otherwise → drifted
- `ahead_by` and `behind_by` integer columns on `platform_connections` track commit counts from GitHub Compare API
- Resolution endpoint: `POST /api/projects/:id/connections/:connId/resolve` with `action` field (`merge_to_default` or `update_from_default`) uses GitHub Merges API
- On merge conflict (GitHub 409), returns `conflict_url` pointing to GitHub compare page for manual resolution
- Frontend connection cards show plain-English explanations and action buttons: "Merge to main" (ahead), "Update branch" (behind), "Auto-resolve" (conflict)

### Ghost Branch Discovery

AI agents (especially Claude Code) may create branches the user didn't register. VibeSyncPro detects these and surfaces them for triage.

- **Database**: `discovered_branches` table stores branch name, likely platform, ahead/behind counts vs default, last commit SHA (for dismiss tracking), dismissed_at timestamp.
- **Scan endpoint**: `POST /api/projects/:id/branches/scan` fetches all GitHub branches, filters out registered + default branches, compares against default and platform branches to attribute ownership, upserts into DB. Dismissed branches with unchanged SHA stay dismissed; new commits clear dismissal.
- **Triage endpoint**: `POST /api/projects/:id/branches/:branchName/triage` with actions:
  - `merge_to_default`: merge ghost branch into default branch via GitHub Merges API
  - `merge_to_platform`: merge ghost branch into a specific platform branch (requires `platform_branch` field)
  - `assign_to_replit`: update Replit connection's `branch_name` to the discovered branch
  - `dismiss`: set `dismissed_at` on the record (resurfaces if new commits appear)
- **GET endpoint**: `GET /api/projects/:id/branches/discovered` returns non-dismissed discovered branches
- **Frontend**: "Discovered Branches" collapsible section on project page with count badge, scan button, per-branch cards showing attribution/commit info, and contextual action buttons
- **Query key**: `["/api/projects", projectId, "branches", "discovered"]`

### Activity Log

Per-project timestamped audit trail of sync checks, merges, conflict resolutions, and triage actions.

- **Database**: `activity_log` table (project_id, event_type, description, metadata JSONB, created_at)
- **Storage methods**: `addActivityLog(projectId, eventType, description, metadata?)` and `getActivityLog(projectId, limit?)` (newest first, default 50)
- **GET endpoint**: `GET /api/projects/:id/activity` returns last 50 entries
- **Events logged at**: project creation, sync results (per connection — synced/drifted/conflict/error), connection resolve (success/conflict), branch triage (merge/dismiss/assign/conflict)
- **Event types**: `project_created`, `sync_synced`, `sync_drifted`, `sync_conflict`, `sync_error`, `resolve_success`, `resolve_conflict`, `branch_merged`, `branch_dismissed`, `branch_assigned`, `branch_conflict`
- **Frontend**: Collapsible "Activity" section on project detail page with count badge, color-coded icons by event type, and relative timestamps
- **Query key**: `["/api/projects", projectId, "activity"]` — invalidated on sync, resolve, and triage mutations (including error paths for conflict events)
- **Cascade**: Activity log entries are deleted when a project is deleted (within the same transaction)

### Project Settings & Deletion

- **Inline editing**: Project name and description are click-to-edit on the project detail page (save on Enter, blur, or checkmark; cancel on Escape)
- **Delete**: "Danger Zone" section at bottom of project page with confirmation modal; hard-deletes project + all connections + discovered branches + activity log in a single transaction
- **Backend**: `PATCH /api/projects/:id` accepts `name` and `description` (with server-side trimming); `DELETE /api/projects/:id` cascades via `storage.deleteProject()`

---

## External Dependencies

### Required Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required at startup) |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID (required for auth) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret (required for auth) |
| `GITHUB_CALLBACK_URL` | OAuth callback URL — **required in production** (set to `https://<slug>.replit.app/auth/github/callback`); defaults to `http://localhost:5000/auth/github/callback` in dev |
| `SESSION_SECRET` | Express session secret (optional in dev, **required** in production — server exits if missing) |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption of GitHub access tokens at rest (optional in dev, warned in production) |
| `GEMINI_API_KEY` | Google Gemini API key for repo analysis and Conflict Genius features (optional — 503 returned if missing) |

### Health Check

- `GET /health` — Returns `{ status: "ok", timestamp: "..." }` with HTTP 200. Registered before session middleware (no auth required). Used by Replit VM deployment for uptime monitoring.

### Auth Resilience

- **Global 401 redirect**: When any API call returns 401 (session expired), the frontend clears the query cache and redirects to `/` for re-login. The `/auth/me` query uses `on401: "returnNull"` and is exempt from this redirect.
- **GitHub token errors**: Two typed error classes in `server/src/routes/github.ts`:
  - `NoGitHubTokenError` — user has no stored access token → HTTP 401 `{ code: "github_token_missing" }`
  - `GitHubTokenRevokedError` — GitHub API returned 401 (token revoked/expired) → HTTP 401 `{ code: "github_token_revoked" }`
  Frontend detects both codes in `queryClient.ts`, throws `GitHubTokenError` (instead of redirecting), and a global listener in `App.tsx` shows a destructive toast with a "Sign in again" button that initiates OAuth re-auth.

### Production Deployment

- **Target**: `vm` (always-on) — required because the app uses in-memory sessions (memorystore)
- **Build**: `npm run build` (Vite client + esbuild server → `dist/index.cjs`)
- **Run**: `node dist/index.cjs`
- **GitHub OAuth callback**: After publishing, add the production callback URL to your GitHub OAuth app's **Authorization callback URL** list:
  ```
  https://<your-repl-slug>.replit.app/auth/github/callback
  ```
  (The dev callback URL `https://<dev-domain>/auth/github/callback` should remain for local development.)
- **Required secrets in production**: `DATABASE_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`
- **Recommended secrets**: `GEMINI_API_KEY` (enables repo analysis and Conflict Genius)

### Security

- **Token encryption**: GitHub OAuth access tokens are encrypted at rest using AES-256-GCM (`server/src/utils/crypto.ts`). On startup, a migration (`server/src/utils/migrate-tokens.ts`) re-encrypts any existing plaintext tokens.
- **Error boundary**: A React error boundary (`client/src/components/error-boundary.tsx`) wraps the router to catch unhandled component errors and show a recovery UI.
- **DB pool**: Connection pool configured with `max: 20`, `idleTimeoutMillis: 30s`, `connectionTimeoutMillis: 5s` in `server/db.ts`.
- **Gemini API key**: Sent via `x-goog-api-key` header (not URL query string) for all Gemini API calls.

### Key Third-Party Libraries

| Library | Purpose |
|---|---|
| `drizzle-orm` + `pg` | PostgreSQL ORM and driver |
| `drizzle-zod` | Auto-generate Zod schemas from Drizzle table definitions |
| `zod` | Runtime validation for inputs and API responses |
| `express` v5 | HTTP server framework |
| `express-session` + `memorystore` | Session management |
| `vite` + `@vitejs/plugin-react` | Frontend bundler and dev server |
| `wouter` | Client-side routing |
| `@tanstack/react-query` | Server state management and data fetching |
| `framer-motion` | UI animations and transitions |
| `tailwindcss` | Utility-first CSS framework |
| `lucide-react` | Icon library |
