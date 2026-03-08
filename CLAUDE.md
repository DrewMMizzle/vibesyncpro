# VibeSyncPro — Claude Code Guidelines

## Branch Schema

| Branch | Purpose |
|---|---|
| `main` | Production-ready code. Do not push directly. |
| `develop` | Integration branch for feature work. |
| `claude/work` | All Claude Code development happens here. |
| `replit/work` | Replit agent development branch. |
| `computer/work` | Computer-use agent development branch. |

## Rules

- **All Claude Code work stays on `claude/work`.** Do not create new branches. Do not push to `main` or `develop`.
- Commit with clear, descriptive messages prefixed with conventional commit types (`feat:`, `fix:`, `chore:`, etc.).
- The server lives under `server/`. New backend modules go in `server/src/`.
- The frontend lives under `client/`.
- Shared types and schemas live under `shared/`.

## Current Architecture

- **Frontend**: Vite + React + TypeScript + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript
- **Database**: SQLite via better-sqlite3 (file at `server/data/vibesyncpro.db`, gitignored)
- **Auth**: GitHub OAuth flow (`server/src/routes/auth.ts`) with express-session

## Database

SQLite with better-sqlite3. Schema created via raw SQL in `server/src/db/schema.ts`.

### Tables

- **users** — GitHub-authenticated users (github_id, username, avatar_url, access_token)
- **projects** — User-owned projects (name, description, github_repo_url)
- **platform_connections** — Per-project platform links (replit, claude_code, computer) with sync status

## API Routes

### Auth (`/auth`)
- `GET /auth/github` — initiates GitHub OAuth
- `GET /auth/github/callback` — handles OAuth callback, upserts user in DB
- `GET /auth/me` — returns current user's username and avatar
- `POST /auth/logout` — destroys session

### Users (`/api`)
- `GET /api/me` — returns authenticated user from database (id, username, avatar_url, created_at)

### Projects (`/api/projects`)
- `GET /api/projects` — list all projects for current user (with platform connections)
- `POST /api/projects` — create a new project (`{ name, description }`)
- `GET /api/projects/:id` — get a single project with platform connections

## Environment Variables

See `.env.example` for required variables. Never commit secrets.
