---
name: host
description: Review the Host package for server setup, Module Federation runtime, authentication, and bos.config.json configuration. Use when user says /host or asks to review the host.
allowed-tools: Read, Grep, Glob
user-invocable: true
---

# Host Package Review

Review the `host/` package for quality, consistency, and Module Federation best practices.

## Scope

```
host/
├── server.ts           # HTTP server entry point
├── src/
│   ├── config.ts       # Runtime config loader (bos.config.json)
│   ├── runtime.ts      # Plugin initialization
│   ├── routers/        # Route handlers
│   └── auth/           # Better-Auth setup
├── .env.example        # Environment template
└── package.json
bos.config.json         # Central runtime configuration (root level)
```

## Review Checklist

### 1. Server Setup
- [ ] Hono.js configured correctly
- [ ] CORS and security headers
- [ ] Static file serving
- [ ] Error handling middleware

### 2. Configuration Loading
- [ ] `bos.config.json` parsed correctly
- [ ] Environment-based URL switching (dev/prod)
- [ ] Secret template injection (`{{VAR_NAME}}`)
- [ ] Variables vs secrets distinction

### 3. Plugin Runtime
- [ ] Uses `createPluginRuntime()` from every-plugin
- [ ] Secrets extracted from environment
- [ ] Plugin URL resolved correctly
- [ ] Error handling for plugin load failures

### 4. Authentication
- [ ] Better-Auth configured
- [ ] NEAR Protocol auth (better-near-auth)
- [ ] Session management
- [ ] Protected routes

### 5. Module Federation
- [ ] UI remote loaded correctly
- [ ] SSR/CSR handling
- [ ] Fallback behavior

### 6. bos.config.json
- [ ] All apps configured (host, ui, api)
- [ ] Development and production URLs
- [ ] API variables include NEAR_AI_MODEL
- [ ] API secrets include all required keys

## Key Files to Check

1. `server.ts` - Main entry point
2. `src/config.ts` - Configuration loader
3. `src/runtime.ts` - Plugin initialization
4. `src/routers/index.ts` - Route merging
5. `../bos.config.json` - Central config
6. `.env.example` - Required environment variables

## Output Format

Provide a structured review:

```
## Host Package Review

### Summary
[Overall assessment]

### Issues Found
1. [File:line] - [Issue description]

### Recommendations
- [Improvement suggestions]

### Status: [PASS/NEEDS_WORK]
```
