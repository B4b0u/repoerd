# Changelog

All notable changes to RepoERD are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-12

First public release.

### Added

- Self-hosted web app connected to GitHub through a GitHub App: people see the repositories they can access, branch by branch. Setup from the browser (`/setup`), with the App created from a manifest or entered by hand.
- Automatic detection of Prisma schemas (single file, `prisma/` folder with `models/`, multi-file schemas, `prisma.config`, Prisma 7) and Drizzle schemas (`drizzle.config.*`, barrels and relative imports, `tsconfig` path aliases, workspace packages, `casing`), on PostgreSQL; several sources per repository; manual sources (files, folders or globs) when detection is not enough.
- ER diagram with per-user layouts saved on the server (per repository, source and display mode), automatic placement of new tables, three display modes and a semantic zoom.
- Table details (columns, indexes, constraints, comments) and a "related tables" view.
- Branch comparison, from the fork point or directly: tables, columns, indexes, constraints, relationships and enums added, removed or modified, with a list of changes and a shareable link.
- Postgres schemas (`schema.table`), composite primary and foreign keys, views counted and not drawn.
- Administration (`/admin`): public URL, sign-in restricted to organisations, administrators, users and their sessions, replacement of the GitHub App.
- `repoerd-admin` recovery command in the image: `list-admins`, `promote`, `set-public-url`, `set-allowed-orgs`, `reset-app`.
- Demo mode (`GITHUB_MODE=fake`) with example repositories.
- English and French, light and dark themes.
- Docker image for amd64 and arm64 on GHCR, with provenance and SBOM.

[0.1.0]: https://github.com/B4b0u/repoerd/releases/tag/v0.1.0
