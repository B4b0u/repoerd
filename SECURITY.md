# Security policy

RepoERD stores secrets: the private key and client secret of your GitHub App, and the GitHub tokens of the people who sign in. Please report vulnerabilities privately.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x (latest release) | Yes |
| Older | No |

Fixes are released as a new patch version of the latest minor line. Upgrade by pulling the new image (see "Backups and upgrades" in the README).

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open <https://github.com/B4b0u/repoerd/security/advisories/new> (repository "Security" tab, "Report a vulnerability"). Please do not open a public issue.

Include what you can: the version (`/healthz` reports it), the deployment (Docker image, reverse proxy), the steps to reproduce, and the impact you expect. You will get an answer within 7 days. Once a fix is released, the advisory is published with credit to you, unless you prefer otherwise.

## Scope

In scope: the server, the web app, the Docker image and the `repoerd-admin` command of this repository.

Good to know before reporting:

- The demo mode (`GITHUB_MODE=fake`) has no authentication by design: every visitor is an administrator. It must never hold real data or be exposed to people you do not trust.
- RepoERD must be served over HTTPS behind a reverse proxy; plain HTTP outside `localhost` is not a supported deployment.
- The content of the repositories RepoERD reads is never executed: schema files are parsed in separate child processes with size and nesting limits. A file that crashes or stalls a parser child, or the server, is in scope.
