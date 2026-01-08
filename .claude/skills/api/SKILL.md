---
name: api
description: Review the API package for oRPC contracts, database schema, services, and every-plugin patterns. Use when user says /api or asks to review the API.
allowed-tools: Read, Grep, Glob
user-invocable: true
---

# API Package Review

Review the `api/` package for quality, consistency, and every-plugin best practices.

## Scope

```
api/
├── src/
│   ├── contract.ts     # oRPC route definitions
│   ├── index.ts        # Plugin definition (createPlugin)
│   ├── db/
│   │   └── schema.ts   # Drizzle ORM schema
│   ├── services/
│   │   ├── trajectory.ts   # Trajectory capture engine
│   │   ├── embeddings.ts   # Structural embeddings
│   │   ├── simulator.ts    # What-if predictions
│   │   ├── agent.ts        # NEAR AI integration
│   │   └── graph.ts        # Graph queries
│   └── store.ts        # Database connection
├── plugin.dev.ts       # Local dev configuration
└── package.json
```

## Review Checklist

### 1. Contract Definition
- [ ] All routes defined in `contract.ts`
- [ ] Input/output schemas use Zod
- [ ] Proper HTTP methods and paths
- [ ] OpenAPI metadata complete

### 2. Plugin Structure
- [ ] Uses `createPlugin()` from every-plugin
- [ ] Variables and secrets properly typed
- [ ] Context schema defined
- [ ] Initialize/shutdown handlers implemented

### 3. Database Schema
- [ ] Tables follow event clock pattern (trajectories, events, entities, edges)
- [ ] Proper indexes for query performance
- [ ] Relations defined correctly
- [ ] Timestamps use Date type

### 4. Services
- [ ] TrajectoryEngine captures complete walks
- [ ] EmbeddingService handles co-occurrence
- [ ] Simulator predicts trajectories
- [ ] AgentService integrates NEAR AI

### 5. Router Handlers
- [ ] Authentication middleware applied
- [ ] Proper error handling with ORPCError
- [ ] Input validation via contract
- [ ] Date serialization to ISO strings

### 6. Configuration
- [ ] `plugin.dev.ts` matches production config
- [ ] Secrets loaded from environment
- [ ] Default values are sensible

## Key Files to Check

1. `src/contract.ts` - API contract definitions
2. `src/index.ts` - Plugin implementation
3. `src/db/schema.ts` - Database tables
4. `src/services/agent.ts` - NEAR AI integration
5. `src/services/trajectory.ts` - Core trajectory logic
6. `plugin.dev.ts` - Development configuration

## Output Format

Provide a structured review:

```
## API Package Review

### Summary
[Overall assessment]

### Issues Found
1. [File:line] - [Issue description]

### Recommendations
- [Improvement suggestions]

### Status: [PASS/NEEDS_WORK]
```
