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
- **Routing**: `wouter` — pages: `/` (Home), `/dashboard` (Dashboard), `/projects/:id` (Project Detail), catch-all 404
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
- **Routes**: Auth routes at `/auth/*`, user routes at `/api/me`, project routes at `/api/projects`
- **Storage layer**: `server/storage.ts` provides a `DatabaseStorage` class implementing an `IStorage` interface using Drizzle ORM + PostgreSQL
- **Dev server**: In development, Vite runs as middleware inside the Express server (see `server/vite.ts`)
- **Production build**: `script/build.ts` runs Vite for the client, then esbuild to bundle the server into `dist/index.cjs`

### Shared Layer (API Contract)

- `shared/schema.ts` — Drizzle ORM table definitions (`users`, `projects`, `platform_connections`) + Zod schemas via `drizzle-zod`
- `shared/routes.ts` — Centralized API route definitions (path, method, input schema, response schemas)

### Database

- **Database**: PostgreSQL (single database, all tables)
- **ORM**: Drizzle ORM with `drizzle-kit` for schema push
- **Tables**: `users` (GitHub OAuth), `projects` (user_id, name, description, GitHub fields), `platform_connections` (project_id, platform, status)
- **Connection**: Uses `pg` (node-postgres) Pool, connection string from `DATABASE_URL` environment variable
- **Schema sync**: Run via `npm run db:push`

### Authentication Flow

1. User clicks "Get Started" on landing page
2. If not logged in → redirects to `/auth/github` → GitHub OAuth → callback creates/updates user → redirects to `/?auth=success`
3. If logged in → submits project creation form → navigates to `/dashboard`

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

---

## External Dependencies

### Required Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required at startup) |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID (required for auth) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret (required for auth) |
| `GITHUB_CALLBACK_URL` | OAuth callback URL (optional, defaults to localhost:5000) |
| `SESSION_SECRET` | Express session secret (optional, has dev default) |

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
