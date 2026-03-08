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
- **Database**: PostgreSQL via Drizzle ORM (schema in `shared/schema.ts`)
- **Auth**: GitHub OAuth flow (`server/src/routes/auth.ts`) with express-session

## Environment Variables

See `.env.example` for required variables. Never commit secrets.
