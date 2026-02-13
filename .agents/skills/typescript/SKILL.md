---
name: typescript
description: TypeScript code style and optimization guidelines. Use when writing TypeScript code (.ts, .tsx, .mts files), reviewing code quality, or implementing type-safe patterns. Triggers on TypeScript development, type safety questions, or code style discussions.
---

# TypeScript Code Style Guide

## Types and Type Safety

- Avoid explicit type annotations when TypeScript can infer
- Avoid implicitly `any`; explicitly type when necessary
- Use accurate types: prefer `Record<PropertyKey, unknown>` over `object` or `any`
- Prefer `interface` for object shapes (e.g., React props); use `type` for unions/intersections
- Prefer `as const satisfies XyzInterface` over plain `as const`
- Prefer `@ts-expect-error` over `@ts-ignore` over `as any`
- Avoid meaningless null/undefined parameters; design strict function contracts

## Async Patterns

- Prefer `async`/`await` over callbacks or `.then()` chains
- Prefer async APIs over sync ones (avoid `*Sync`)
- Use promise-based variants: `import { readFile } from 'fs/promises'`
- Use `Promise.all`, `Promise.race` for concurrent operations where safe

## Code Structure

- Prefer object destructuring
- Use consistent, descriptive naming; avoid obscure abbreviations
- Replace magic numbers/strings with well-named constants
- Defer formatting to tooling

## Performance

- Prefer `for…of` loops over index-based `for` loops
- Reuse existing utils in `packages/utils` or installed npm packages
- Query only required columns from database

## Time Consistency

- Assign `Date.now()` to a constant once and reuse for consistency

## Logging

- Never log user private information (API keys, etc.)
- Don't use `import { log } from 'debug'` directly (logs to console)
- Use `console.error` in catch blocks instead of debug package

## Code Quality
- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Never hardcode key checks with, eg. `matchesKey(keyData, "ctrl+x")`. All keybindings must be configurable. Add default to matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)
