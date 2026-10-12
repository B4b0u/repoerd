export const auth = {
  pageTitle: 'Sign in',
  intro: 'Sign in with GitHub to see the database schemas of your repositories.',
  signIn: 'Sign in with GitHub',
  appReplaced:
    'The GitHub App of this RepoERD was replaced, so everyone signs in again. If the new App is not installed on your repositories yet, install it first.',
  installApp: 'Install {{appName}} on GitHub',
  /** Keyed by the `?error=` code of the sign-in callback. */
  errors: {
    denied: 'Sign-in was cancelled on GitHub.',
    state: 'The sign-in took too long or was started from another tab. Try again.',
    'invalid-code': 'GitHub refused the sign-in. Try again.',
    'org-not-allowed':
      'Your GitHub account is not a member of an organisation allowed on this RepoERD.',
    'not-configured': 'RepoERD is not configured yet.',
    github: 'GitHub could not be reached or refused the request. Try again in a few minutes.',
    unknown: 'Sign-in failed. Try again.',
  },
}
