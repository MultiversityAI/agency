# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Module Federation monorepo** demonstrating every-plugin architecture, runtime-loaded configuration, and NEAR Protocol integration. The architecture enables independent deployment of UI, API, and Host components.

**Account:** agency.near

## Commands

```bash
# Development
bun install              # Install dependencies
bun db:migrate           # Run database migrations
bun dev                  # All services (API: 3014, UI: 3002, Host: 3001)
bun dev:api              # API plugin only (with remote UI)
bun dev:ui               # UI remote only (with remote API)

# Building
bun build                # Build all packages
bun build:api            # Build API → uploads to CDN → updates bos.config.json
bun build:ui             # Build UI → uploads to CDN → updates bos.config.json
bun build:host           # Build host server

# Testing & Type Checking
bun test                 # Run all tests
bun typecheck            # Type checking across all workspaces

# Database (runs in both api/ and host/)
bun db:push              # Push schema changes
bun db:studio            # Open Drizzle Studio
bun db:generate          # Generate migrations

# Single workspace commands
cd api && bun test       # Run API tests only
cd ui && bun test        # Run UI tests only
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  host/ (Server :3001)                   │
│  Hono.js + oRPC + bos.config.json loader                │
│  - Module Federation Runtime (loads UI)                 │
│  - every-plugin Runtime (loads API)                     │
│  - Better-Auth (sessions, NEAR auth)                    │
└───────────┬─────────────────────────┬───────────────────┘
            ↓                         ↓
┌───────────────────────┐ ┌───────────────────────┐
│    ui/ (Remote :3002) │ │   api/ (Plugin :3014) │
│  React 19 + TanStack  │ │  oRPC + Effect-TS     │
│  Router + Query       │ │  Drizzle + SQLite     │
│  Tailwind v4 + shadcn │ │  every-plugin         │
└───────────────────────┘ └───────────────────────┘
```

### Key Files

- **`bos.config.json`** - Central runtime configuration (URLs, secrets). No rebuild needed for URL changes.
- **`host/server.ts`** - HTTP server entry point
- **`host/src/config.ts`** - Runtime config loader
- **`host/src/runtime.ts`** - Plugin initialization
- **`api/src/contract.ts`** - oRPC route definitions (type-safe API contract)
- **`api/src/index.ts`** - Plugin definition with `createPlugin()`
- **`ui/src/bootstrap.tsx`** - React app entry
- **`ui/src/routes/`** - TanStack Router file-based routes

### Configuration System

All runtime URLs load from `bos.config.json`. Environment switching via `NODE_ENV`:
- `development` → localhost URLs
- `production` → CDN URLs

Secrets use template injection: `{{VAR_NAME}}` replaced from environment.

## Tech Stack

- **Frontend:** React 19, TanStack Router (file-based), TanStack Query, Tailwind CSS v4, shadcn/ui
- **Backend:** Hono.js, oRPC, every-plugin, Effect-TS
- **Database:** SQLite (libsql/turso), Drizzle ORM
- **Auth:** Better-Auth + better-near-auth (NEAR Protocol)
- **Build:** Turbo, Rsbuild (UI/Host), Rspack (API), Zephyr (CDN deployment)
- **Package Manager:** Bun

## UI Styling

Use semantic Tailwind classes (not hardcoded colors):

```tsx
// Correct
<div className="bg-background text-foreground">
  <h1 className="text-foreground">Title</h1>
  <p className="text-muted-foreground">Description</p>
  <button className="bg-primary text-primary-foreground">Action</button>
</div>

// Avoid hardcoded colors like bg-blue-600, text-white
```

Available semantic classes: `bg-background`, `bg-card`, `bg-primary`, `bg-secondary`, `bg-muted`, `bg-accent`, `bg-destructive` and their `-foreground` text variants.

## Adding New Features

### New API Endpoint

1. Define in `api/src/contract.ts`:
```typescript
export const contract = oc.router({
  myEndpoint: oc.route({ method: 'POST', path: '/my-endpoint' })
    .input(MyInputSchema)
    .output(MyOutputSchema)
});
```

2. Implement handler in `api/src/index.ts`:
```typescript
createRouter: (context, builder) => ({
  myEndpoint: builder.myEndpoint.handler(async ({ input }) => {
    return await Effect.runPromise(context.service.doSomething(input));
  })
})
```

3. Use in UI via oRPC client in `ui/src/integrations/api/`

### New UI Page

Create route file in `ui/src/routes/my-page.tsx`:
```tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/my-page')({
  component: MyPage
});

function MyPage() {
  return <div className="bg-background">...</div>;
}
```

TanStack Router auto-generates route tree on save.

## External Documentation

- **every-plugin:** https://github.com/near-everything/every-plugin/blob/main/plugins/_template/LLM.txt
- **near-kit:** https://kit.near.tools/llms-full.txt
- **better-near-auth:** https://github.com/elliotBraem/better-near-auth/blob/main/LLM.txt
