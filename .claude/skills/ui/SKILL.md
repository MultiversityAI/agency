---
name: ui
description: Review the UI package for React components, TanStack Router routes, styling, and frontend best practices. Use when user says /ui or asks to review the UI.
allowed-tools: Read, Grep, Glob
user-invocable: true
---

# UI Package Review

Review the `ui/` package for quality, consistency, and best practices.

## Scope

```
ui/
├── src/
│   ├── components/     # React components (chat, graph, simulate)
│   ├── routes/         # TanStack Router file-based routes
│   ├── integrations/   # API client setup
│   └── utils/          # Utilities (orpc client)
├── rsbuild.config.ts   # Build configuration
└── package.json
```

## Review Checklist

### 1. Component Quality
- [ ] Components use semantic Tailwind classes (`bg-background`, not `bg-blue-600`)
- [ ] Props are properly typed with TypeScript
- [ ] No unused imports or variables
- [ ] Proper error boundaries and loading states

### 2. Route Structure
- [ ] Routes follow TanStack Router conventions
- [ ] Protected routes use `_authenticated` layout
- [ ] Route components are properly exported

### 3. API Integration
- [ ] Uses oRPC client from `utils/orpc.ts`
- [ ] TanStack Query for data fetching
- [ ] Proper error handling with toast notifications

### 4. Styling
- [ ] Semantic color tokens (not hardcoded colors)
- [ ] Responsive design patterns
- [ ] shadcn/ui components used consistently

### 5. Performance
- [ ] Proper use of `useMemo` and `useCallback`
- [ ] No unnecessary re-renders
- [ ] Lazy loading for heavy components

## Key Files to Check

1. `src/routes/_layout/_authenticated/chat/index.tsx` - Main chat page
2. `src/components/chat/ChatInput.tsx` - Chat input component
3. `src/components/chat/ChatMessage.tsx` - Message display
4. `src/components/graph/GraphPanel.tsx` - React Flow visualization
5. `src/components/simulate/SimulatePanel.tsx` - What-if modal
6. `src/utils/orpc.ts` - API client setup

## Output Format

Provide a structured review:

```
## UI Package Review

### Summary
[Overall assessment]

### Issues Found
1. [File:line] - [Issue description]

### Recommendations
- [Improvement suggestions]

### Status: [PASS/NEEDS_WORK]
```
