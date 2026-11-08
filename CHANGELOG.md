# Changelog

All notable changes to RepoERD are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A new repository page: favourites and the repositories you opened last as cards at the top, the schema format of each repository (Prisma or Drizzle, detected in the background, stored and checked again after a push), the list grouped by organisation, and a "With a schema" filter, on by default, that hides repositories without one until you ask to see them all.
- Table groups, shared by the team: groups are proposed from the schema files (one per domain folder, else per file, else per Postgres schema), then saved, ignored or proposed again by anyone with push access. Groups are edited on the diagram: rename, recolour (12 colours or a custom one), delete, place tables from their details or by selecting several with Shift, with "Undo". A group moves by dragging its label. Frames and coloured cards on the diagram, the table list by group, and an automatic layout by group.
- The file that declares each table, shown in its details.

### Changed

- Far out in the overview, group and table names keep a readable size and the names that would overlap are left out until you zoom in, like the labels of a map.

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

[Unreleased]: https://github.com/B4b0u/repoerd/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/B4b0u/repoerd/releases/tag/v0.1.0
