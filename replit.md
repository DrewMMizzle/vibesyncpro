# replit.md

## Overview

This is a full-stack web application called **VibeSyncPro** — a project creation tool with a clean, minimal landing page. Users enter a project description into a single input field, submit it, and the project is saved to a PostgreSQL database. The UI features smooth Framer Motion animations (fade transitions) on form submission.

The app uses a monorepo-style structure with three main areas:
- `client/` — React frontend (Vite + TypeScript)
- `server/` — Express.js backend (Node.js + TypeScript)
- `shared/` — Shared types, schemas, and route definitions used by both client and server

The current feature set is minimal: one page, one form, one API endpoint (`POST /api/projects`). The architecture is set up to scale with more routes and features.

---

## User Preferences

Preferred communication style: Simple, everyday language.

---

## System Architecture

### Frontend Architecture

- **Framework**: React 18 with TypeScript, bundled by Vite
- **Routing**: `wouter` (lightweight alternative to React Router) — currently has `/` (Home) and a catch-all 404 page
- **State / Data Fetching**: TanStack Query (React Query v5) for server state; mutations use `useMutation`
- **UI Components**: shadcn/ui (New York style) built on Radix UI primitives — a full set of accessible components is pre-installed in `client/src/components/ui/`
- **Styling**: Tailwind CSS with CSS variables for theming (light + dark mode support via `.dark` class). Custom theme uses neutral base colors. Fonts loaded from Google Fonts (Inter, DM Sans, Fira Code, Geist Mono, Architects Daughter)
- **Animations**: Framer Motion for page/form transitions (`AnimatePresence` + `motion` components)
- **Form Handling**: React Hook Form with `@hookform/resolvers` + Zod validation
- **Path Aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`

### Backend Architecture

- **Framework**: Express.js v5 (Node.js), run with `tsx` for TypeScript support
- **Entry point**: `server/index.ts` creates an HTTP server, registers routes, and serves static files in production
- **Routes**: Defined in `server/routes.ts`, uses path/method/schema definitions from `shared/routes.ts` to keep API contract consistent
- **Storage layer**: `server/storage.ts` provides a `DatabaseStorage` class implementing an `IStorage` interface — makes it easy to swap storage backends
- **Dev server**: In development, Vite runs as middleware inside the Express server (see `server/vite.ts`) so both client and server share a single port
- **Production build**: `script/build.ts` runs Vite for the client, then esbuild to bundle the server into `dist/index.cjs`

### Shared Layer (API Contract)

- `shared/schema.ts` — Drizzle ORM table definitions + Zod schemas generated via `drizzle-zod`
- `shared/routes.ts` — Centralized API route definitions (path, method, input schema, response schemas). Both the frontend hooks and backend route handlers import from here, ensuring the client and server stay in sync without duplication

**Key benefit**: If a route changes, both client and server pick up the change from one file.

### Database

- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with `drizzle-kit` for migrations
- **Schema**: Single `projects` table with `id` (serial PK) and `description` (text, not null)
- **Connection**: Uses `pg` (node-postgres) Pool, connection string from `DATABASE_URL` environment variable
- **Migrations**: Stored in `./migrations/`, run via `npm run db:push`

### Validation Strategy

- Zod schemas are derived from Drizzle table definitions using `drizzle-zod`
- Input is validated on the client before sending (in the mutation hook)
- Input is validated again on the server using the same Zod schema
- Responses are also validated on the client with Zod and logged if they fail

---

## External Dependencies

### Required Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required at startup) |

### Key Third-Party Libraries

| Library | Purpose |
|---|---|
| `drizzle-orm` + `pg` | PostgreSQL ORM and driver |
| `drizzle-zod` | Auto-generate Zod schemas from Drizzle table definitions |
| `zod` | Runtime validation for inputs and API responses |
| `express` v5 | HTTP server framework |
| `vite` + `@vitejs/plugin-react` | Frontend bundler and dev server |
| `wouter` | Client-side routing |
| `@tanstack/react-query` | Server state management and data fetching |
| `framer-motion` | UI animations and transitions |
| `tailwindcss` | Utility-first CSS framework |
| `@radix-ui/*` | Accessible UI primitives (full suite installed) |
| `shadcn/ui` | Pre-built component library on top of Radix UI |
| `class-variance-authority` + `clsx` + `tailwind-merge` | Conditional class utilities |
| `lucide-react` | Icon library |
| `react-hook-form` + `@hookform/resolvers` | Form state and validation |
| `connect-pg-simple` | PostgreSQL session store (installed, not yet wired up) |
| `nanoid` | Short unique ID generation |

### Replit-Specific Plugins (dev only)

- `@replit/vite-plugin-runtime-error-modal` — Shows runtime errors as overlay in dev
- `@replit/vite-plugin-cartographer` — Replit code navigation
- `@replit/vite-plugin-dev-banner` — Replit dev environment banner

### Google Fonts

Loaded via `<link>` in `client/index.html` — Inter, DM Sans, Fira Code, Geist Mono, Architects Daughter. No API key required.