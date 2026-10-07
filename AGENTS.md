# Repository Guidelines

## Project Structure & Module Organization

ShotPrompt is a Bun workspace for a local-first Thai/English video clipping tool. Shared, side-effect-free logic belongs in `packages/core/src/`; SQLite schema, client, and seed data live in `packages/db/src/`. The Elysia API and processing pipeline are in `apps/server/src/`, with pipeline stages under `apps/server/src/steps/`. The Next.js App Router UI is in `apps/web/app/`, reusable UI in `apps/web/components/`, and browser helpers in `apps/web/lib/`. Tests sit beside each package in `test/`. Runtime media and SQLite data belong under the gitignored `data/` directory; do not commit generated artifacts.

## Build, Test, and Development Commands

- `bun install` installs all workspace dependencies.
- `bun dev` starts the server on `127.0.0.1:3101` and web app on `127.0.0.1:3100`.
- `bun test` runs the core, database, and server suites with `bun:test`.
- `bun test apps/server/test/clips.test.ts` runs one test file; use `bun test -t "name"` to filter by test name.
- `bun run typecheck` checks TypeScript across all packages and apps.
- `bun run --cwd apps/web build` produces a production web build.

`ffmpeg`/`ffprobe` (with libass) and `whisper-cli` are required on `PATH` for real media processing.

## Coding Style & Naming Conventions

Write TypeScript using the existing two-space indentation, semicolons, and `camelCase` identifiers. Use `kebab-case.ts` file names such as `detect-scenes.ts`; React components use `PascalCase` exports in `kebab-case.tsx` files. Keep pure algorithms in `packages/core`; route and filesystem work belong in the server. Reuse `clampToClip` for subtitle bounds rather than duplicating trim logic. For web work, read `apps/web/AGENTS.md` and the relevant installed Next.js documentation first.

## Testing Guidelines

Add or update `bun:test` coverage with behavior changes. Name files `*.test.ts` and describe observable behavior. Route tests should call `app.handle(new Request('http://x/...'))`. Run the focused test, then `bun test` and `bun run typecheck`. `tsc -b` can emit ignored `.js` and `.d.ts` files beside tests; remove those generated test artifacts if Bun appears to run tests twice.

## Commit & Pull Request Guidelines

Follow the established Conventional Commit style: `feat(server): add export queue` or `fix: recover stuck jobs`. Keep commits focused. PRs should explain the user-facing change, note tests run, link the issue when applicable, and include screenshots or recordings for UI changes. Do not commit `data/`, models, source videos, or exports.
