# Contributing to RepoERD

Thank you for your interest. Bug reports, ideas and pull requests are welcome. For a security issue, follow [SECURITY.md](SECURITY.md) instead of opening an issue. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

Before a large change, open an issue to discuss it: RepoERD deliberately stays small (read-only, self-hosted, Prisma and Drizzle on PostgreSQL).

## Set up

Requirements: Node 24 and pnpm 10 (`corepack enable`). Docker is only needed for the image smoke test and the workflow lint.

```bash
pnpm install
pnpm dev      # API on http://localhost:3100 (demo mode) + web on http://localhost:5173
```

`pnpm dev` runs in **fake GitHub mode** (`GITHUB_MODE=fake`, from `apps/server/.env.development`): no GitHub App is needed, the repositories come from [`fixtures/repos`](fixtures/README.md), and you are signed in as the administrator `dev`.

To try the real GitHub flow locally, copy `apps/server/.env.example` to `apps/server/.env` (ignored by git), set `SECRET_KEY`, run `pnpm dev`, open <http://localhost:5173/setup> and enter the setup code printed in the API logs. Variables set in the shell override both files.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API and web in watch mode |
| `pnpm test` | Unit and integration tests of every package (Vitest) |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm lint` / `pnpm format` | Biome check / Biome check with fixes |
| `pnpm depcruise` | Architecture rules (dependency-cruiser) |
| `pnpm build` | Build every package |
| `pnpm verify` | Everything the CI `check` job runs: Biome, types, tests, architecture rules, build, bundle budget |
| `pnpm coverage` | Tests with a coverage summary per package (informative, no threshold) |
| `pnpm e2e` | Production build, then Playwright: demo mode on port 3400, and real mode on port 3401 against a local fake GitHub on port 3402 |
| `docker build -t repoerd:local . && bash scripts/docker-smoke.sh repoerd:local` | Build the image and smoke-test it in demo mode |
| `bash scripts/lint-workflows.sh` | actionlint on `.github/workflows` (through Docker) |
| `pnpm exec tsx scripts/generate-platform-fixture.ts` | Regenerate the `acme/platform-monorepo` fixture |
| `SCREENS_LABEL=after pnpm exec tsx scripts/ui-screenshots.ts` | Screenshots of every screen, English and French, dark and light, against a fake-mode stack on port 5180 |
| `SCREENS_TARGET=readme SCREENS_BASE_URL=http://localhost:3300 pnpm exec tsx scripts/ui-screenshots.ts` | The README images (`docs/images/`), against a production server in fake mode on port 3300 with a fresh database |

The real-mode E2E project points the server at the fake GitHub with `REPOERD_TEST_GITHUB_URL`. That variable exists for tests only: it accepts nothing but `http://127.0.0.1:<port>`. Never enter real GitHub App credentials into a server started with it, and never set it on a real deployment. The server refuses to start if the stored GitHub App was registered on another GitHub.

## Project layout

```
apps/
  server/        Node + Hono: API, GitHub integration, persistence, repoerd-admin
    src/domain/          pure business rules
    src/application/     ports (interfaces) and use cases
    src/infrastructure/  adapters: GitHub, fake GitHub (fixtures), SQLite, parsing, crypto
    src/http/            Hono app, routes, cookies, errors
    src/main.ts          composition root (explicit wiring, no DI framework)
  web/           React + Vite + React Flow + ELK, shadcn/ui, i18next (English and French)
packages/
  model/         shared vocabulary: schema types, relationships, schema diff (pure)
  schema-core/   source detection and the façade over @liam-hq/schema (patched)
  contracts/     Zod schemas and types of the API, shared by server and web
e2e/             Playwright tests against the production build
fixtures/        example repositories of the demo mode and the tests
patches/         pnpm patch of @liam-hq/schema
scripts/         screenshots, generated fixture, Docker smoke test, workflow lint, release checks
```

## Architecture rules

Most are enforced by `pnpm depcruise` and `pnpm verify`:

- The server is a light hexagonal architecture: `domain` and `application` depend on no technology (no GitHub, SQLite, Hono, Liam, npm package or Node built-in); use cases depend on ports, adapters live in `infrastructure`, HTTP in `http`, and `main.ts` wires everything by hand.
- Only `packages/schema-core` imports `@liam-hq/*`. Every SWC or Liam call on repository content goes through its pool of child processes, never in the server process, and every file read by the detection goes through the size and nesting guards.
- `apps/web` never imports `apps/server` nor `packages/schema-core`; `packages/model` and `packages/contracts` use no Node built-in (they run in the browser too).
- Inputs are validated with Zod at the boundaries: HTTP requests, environment variables, GitHub answers.
- Expected errors (schema not found, parse error, access refused) are typed results of the use cases, translated into HTTP statuses by `http`; unexpected errors are exceptions, caught and logged.
- `@liam-hq/schema` is pinned and patched. Change it only with `pnpm patch @liam-hq/schema@0.6.1 --edit-dir node_modules/.liam-patch`, then `pnpm patch-commit node_modules/.liam-patch` (pnpm replays the existing patch). Every modified file starts with `// Modified by RepoERD: <summary>` (Apache 2.0 §4(b)), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists the modifications (a test checks it).
- Bump `CACHE_VERSION` (`packages/schema-core/src/cache-version.ts`) with every change to detection, parsing or the shared model: cached results of another version are never served.
- Database changes are Drizzle migrations (`pnpm --filter @repoerd/server db:generate`), applied at start-up and never edited once released; the migration test upgrades a populated database from every version of the journal.

## Code conventions

- TypeScript strict, ES modules, Biome for lint and format (`pnpm format`).
- English for code, comments, identifiers, commit messages and documentation.
- No user-facing text outside the catalogues `apps/web/src/shared/i18n/locales/<language>/`: English is the reference, French is typed against it (a missing or extra key fails the typecheck), and a test fails on hard-coded text.
- Tests first (Vitest): the domain and use cases with fakes, adapters against SQLite in memory and recorded GitHub answers, schema parsing on fixtures. The in-memory repositories of the server tests share contract suites with the SQLite ones.
- Fixtures are synthetic. Never copy code from a real (company) project into this repository.

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:`.
- One topic per pull request, with tests, and `pnpm verify` green locally. The pull request template lists the checks.
- The CI runs on every pull request: `Lint, types, tests, architecture, build, bundle budget`, `End-to-end tests`, `Docker image`, `Test coverage (informative)`, `Analyze (JavaScript and TypeScript)` (CodeQL) and `Review new dependencies`.

## Releasing (maintainers)

1. In a pull request: set the new version in every `package.json` (the root, `apps/*`, `packages/*`, `e2e`), add a `CHANGELOG.md` entry with the release date, and, for a new minor version, the new tag line in `docker-compose.yml` and the README (`0.2`, then `1`, `1.2`…). Merge it into `main` once every check is green.
2. Tag the merge commit on `main` and push the tag:

   ```bash
   git fetch origin
   git tag -a v0.1.0 -m "v0.1.0" origin/main
   git push origin v0.1.0
   ```

3. `release.yml` then checks that the tag is on `main`, runs the CI again, builds the amd64 and arm64 images and smoke-tests both (arm64 under QEMU), pushes `ghcr.io/b4b0u/repoerd` with the tags `X.Y.Z`, `X.Y`, `X` (from 1.0 on) and `latest`, with provenance and an SBOM, and creates the GitHub release with generated notes. A pre-release tag (`v0.2.0-rc.1`) only gets its own image tag and is marked as a pre-release. `latest` follows the most recent non-pre-release tag pushed.
4. First release only: GHCR creates the package as private. Open the package settings on GitHub, make it public (and link it to the repository if it is not linked), so that `docker pull` works without signing in.

The "tag is on `main`" check only guards against mistakes (a tag pushed from a branch by accident). The real control is the repository settings below: anyone able to push a `v*` tag can publish an image.

## Repository settings (maintainers)

- Branch protection on `main`: pull request required, branches up to date before merging, no force push, no deletion. Required status checks, to select once the workflows have run on GitHub (the names are the job names): `Lint, types, tests, architecture, build, bundle budget`, `End-to-end tests`, `Docker image`, `Analyze (JavaScript and TypeScript)` and `Review new dependencies`. `Test coverage (informative)` is not required.
- Tag ruleset: a repository ruleset on the tag pattern `v*` that restricts creation, update and deletion to the maintainer. Optionally, a protected `release` environment (required reviewer) on the publishing job of `release.yml`.
- Security: private vulnerability reporting on; dependency graph, Dependabot alerts and Dependabot security updates on (the dependency review needs the dependency graph).
- Actions: default `GITHUB_TOKEN` permissions read-only (each workflow asks for what it needs).
