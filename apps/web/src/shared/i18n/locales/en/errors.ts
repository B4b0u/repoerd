import type { ApiErrorCode, ApiErrorReason } from '@repoerd/contracts'

export const errors = {
  network: 'Could not reach the server. Check your connection and try again.',
  http: 'The server answered with an error (HTTP {{status}}).',
  codes: {
    bad_request: 'The server refused the request.',
    unauthenticated: 'Sign in to continue.',
    reauth_required: 'Your GitHub sign-in has expired. Sign in again.',
    payload_too_large: 'This request is too large (4 MB at most).',
    forbidden: 'You are not allowed to do this.',
    org_not_allowed:
      'Your GitHub account does not belong to an organisation allowed on this RepoERD.',
    not_found: 'Not found.',
    repo_not_found: 'Repository not found.',
    repo_moved: 'This repository is now {{owner}}/{{name}}.',
    branch_not_found: 'Branch "{{branch}}" not found.',
    no_common_history: 'These branches have no common ancestor.',
    conflict: 'This change conflicts with the current state. Reload the page and try again.',
    setup_required: 'RepoERD is not configured yet: open /setup.',
    invalid_setup_code: 'Wrong setup code. Use the code printed in the server logs.',
    github_error: 'GitHub is not responding. Try again.',
    github_rate_limited: 'GitHub rate limit reached. Try again in a few minutes.',
    rate_limited: 'Too many requests. Wait a moment and try again.',
    server_busy: 'The server is busy reading other schemas. Try again in a moment.',
    internal_error: 'Unexpected server error.',
  } satisfies Record<ApiErrorCode, string>,
  reasons: {
    'missing-mutation-header':
      'The request was refused because it lacks the RepoERD header. Reload the page.',
    'write-access-required': 'You need write access to this repository.',
    'admins-only': 'Administrators only.',
    'setup-code-required': 'Enter the setup code first.',
    'already-configured': 'RepoERD is already configured.',
    'invalid-public-url':
      'The public URL must be an http(s) address without path, like https://erd.example.com.',
    'invalid-organization': '"{{login}}" is not a valid GitHub organisation name.',
    'self-lockout':
      'Your GitHub account has no access to an installation of the App on these organisations: saving would lock you out.',
    'user-never-signed-in': 'This GitHub user has never signed in to RepoERD.',
    'not-admin': 'This user is not an administrator.',
    'config-changed':
      'Another administrator changed the configuration meanwhile. Check the values shown and save again.',
    'last-admin': 'RepoERD needs at least one administrator.',
    'app-credentials-rejected': 'GitHub rejected these App credentials.',
    'too-many-sources': 'At most {{max}} schema sources per repository.',
    'name-missing': 'Every source needs a name.',
    'name-control-characters': 'Source names must not contain control characters.',
    'name-too-long': 'Source names are limited to {{max}} characters.',
    'duplicate-name': 'Two sources are named "{{name}}".',
    'no-path': 'Source "{{name}}" needs at least one path.',
    'too-many-paths': 'Source "{{name}}" has more than {{max}} paths.',
    'path-too-long': 'Paths are limited to {{max}} characters.',
    'path-invalid':
      'Path "{{path}}" of source "{{name}}" must be relative to the repository root, without "..", "\\" or control characters.',
    'invalid-body': 'The request was malformed. Reload the page and try again.',
    'invalid-repository-name': 'This is not a valid repository name.',
    'invalid-layout-target':
      'The layout request names no valid source or display mode, or this repository already has 50 saved layouts.',
    'invalid-layout': 'These table positions were refused. Reload the page and try again.',
    'invalid-compare': 'This comparison is not valid: choose two different branches.',
    'invalid-branch-name': 'This is not a valid branch name.',
  } satisfies Record<ApiErrorReason, string>,
}
