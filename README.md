# react-multiple-video-manager

[Japanese / 日本語](./README.ja.md)

[![CI](https://github.com/curry-battle/react-multiple-video-form-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/curry-battle/react-multiple-video-form-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Headless React library for managing multiple videos — add, delete, reorder, replace, and thumbnail management (frame capture / file upload) — with built-in validation and preview URL handling.

Supports **React Hook Form** and **TanStack Form**, with optional **Zod** / **Valibot** schema integration.

## Features

- Headless (render-prop) API — bring your own UI
- Add / delete / reorder / replace videos declaratively
- Thumbnail management: frame capture, file upload, and removal
- Separate deleted-video tracking via `deletedVideoIds` field
- `usePreviewUrl` / `useThumbnailPreviewUrl` hooks for automatic blob URL lifecycle management
- `processFile` / `processThumbnailFile` callbacks for client-side preprocessing
- `uploadOnSelect` prop for upload-on-select workflows
- Zod & Valibot schema factories with shared constraint config
- i18n-ready error messages

## Packages

| Package | Description |
|---------|-------------|
| [`packages/react-multiple-video-manager`](./packages/react-multiple-video-manager/) | Core library (`@curry-battle/react-multiple-video-manager`) |
| [`examples/video-form-rhf`](./examples/video-form-rhf/) | Example app with React Hook Form |
| [`examples/video-form-tanstack`](./examples/video-form-tanstack/) | Example app with TanStack Form |

## Quick Start

```bash
pnpm install
```

### Run example apps

```bash
# React Hook Form example
pnpm run dev:example:rhf

# TanStack Form example
pnpm run dev:example:tanstack
```

### Library development

```bash
# Build
pnpm run build

# Unit tests (Vitest Browser Mode)
pnpm run test

# E2E tests (Playwright)
pnpm run test:e2e

# Type check
pnpm run typecheck

# Lint & format (Biome)
pnpm run check
```

## Documentation

See the [library README](./packages/react-multiple-video-manager/README.md) for full API documentation, usage examples, and export map.

## Architecture

This project uses **Hexagonal Architecture (Ports & Adapters)** to keep 99% of the video/thumbnail management logic form-agnostic. See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

```
App ─┬─ react-hook-form adapter ─┐
     └─ tanstack-form adapter  ──┤
                                  └─▶ core (useMultiVideoCore, videoListOps, ThumbnailUtils)
```

## Releasing

1. Create a PR that bumps `version` in `packages/react-multiple-video-manager/package.json` and merge it.
2. Open the draft Release created by [release-drafter](https://github.com/release-drafter/release-drafter). Set the tag to `v<version>` (must match the version from step 1) and publish.
3. The **Publish Package** workflow runs automatically: it verifies the tag matches `package.json`, builds, and publishes to GitHub Packages. A version mismatch will fail the workflow.

PR labels (`feature`, `fix`, `breaking`, etc.) drive release-drafter's changelog categories. Labels are auto-applied from conventional commit prefixes via autolabeler; manual labeling is also supported.

## License

[MIT](./LICENSE)
