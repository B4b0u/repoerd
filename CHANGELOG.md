# Changelog

All notable changes to RepoERD are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-08

### Added

- A new repository page: favourites and the repositories you opened last as cards at the top, the schema format of each repository (Prisma or Drizzle, detected in the background, stored and checked again after a push), the list grouped by organisation, and a "With a schema" filter, on by default, that hides repositories without one until you ask to see them all. A repository whose only Drizzle config targets another database than PostgreSQL counts as without a schema; a very large repository whose tree GitHub truncates keeps the formats found in it and, when none is found, is checked again a day later.
- Table groups, shared by the team: groups are proposed from the schema files (one per domain folder, else per file, else per Postgres schema), then saved, ignored or proposed again by anyone with push access. Groups are edited on the diagram: rename, recolour (12 colours or a custom one), delete, place tables from their details or by selecting several with Shift, with "Undo". A group moves by dragging its label. Frames and coloured cards on the diagram, the table list by group, and an automatic layout by group. A diagram arranged before its groups existed is offered once to be laid out by group ("Lay out my diagram by group").
- The file that declares each table, shown in its details.
- Hub tables: a table referenced by more than 30% of the tables is detected as a hub (typical: `organizations` in a multi-tenant schema), and "Treat as hub table" in the details of a table adds or removes one. The links of hub tables can be drawn all, first-order only, or hidden; hovering or selecting a table draws its hidden links again, and a column whose link is hidden points to its hub. The hub tables and the link mode are in the URL.
- The `acme/crm` example repository of the demo mode: a multi-tenant Drizzle schema with a hub table, `customType` columns and spread columns returned by functions, and a `feature/invoicing` branch to compare.

### Changed

- Far out in the overview, group and table names keep a readable size and the names that would overlap are left out until you zoom in, like the labels of a map.
- The Docker image uses the prebuilt binaries of better-sqlite3 13 instead of compiling them, keeps only the binary of its own platform (about 14 MB smaller), and is based on an updated `node:24-slim` image.

### Fixed

- Drizzle: spread columns returned by a top-level function without parameters (`...timestamps()`) are read, like those of an object literal.
- Drizzle: a `customType` column shows the type its `dataType()` returns when that is a string literal.
- An empty GitHub repository (no commit yet) is read as a repository without a branch instead of an error, and the repository page lists it without a schema.

### Security

- Zod updated to 4.6.7 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (memory exhaustion on oversized constrained collections). The zod 3 that `@liam-hq/schema` brings is used only by its tbls parser, which RepoERD never loads.

### Upgrade notes

- **Back up the database first** (see "Backups and upgrades" in the README). Migrations 0008 (table groups) and 0009 (favourites, visits and repository formats) run at start-up and cannot be undone: a 0.1 image does not run on the migrated database.
- The cached detections and parsed schemas of 0.1 are deleted at the first start (cache version 3 → 6) and parsed again the first time each diagram is opened, so first openings take longer.
- The first repository list starts a background check of the schema format of every repository, with the installation token, 2 repositories at a time and at most 200 per hour. On a large installation the formats fill in over several hours; meanwhile the repositories not yet checked show "Detecting the schema…" and stay visible with the "With a schema" filter. Opening the diagram of a default branch records its format at once.

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

[Unreleased]: https://github.com/B4b0u/repoerd/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/B4b0u/repoerd/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/B4b0u/repoerd/releases/tag/v0.1.0
