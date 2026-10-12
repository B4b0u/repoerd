export const setup = {
  title: 'Set up RepoERD',
  progress: 'Setup progress',
  stepDone: 'done',
  steps: {
    unlock: 'Setup code',
    'register-app': 'GitHub App',
    'become-admin': 'Administrator',
    done: 'Done',
  },
  unlock: {
    title: 'Enter the setup code',
    intro:
      'The server printed a one-time code in its logs when it started. It proves that you administer this server.',
    code: 'Setup code',
    cookieRefused:
      'The code is right, but this browser refused the setup cookie. RepoERD must be served over HTTPS (or on localhost, or behind a proxy sending <code>x-forwarded-proto: https</code>) because its cookies are Secure.',
    submit: 'Continue',
  },
  registerApp: {
    title: 'Connect a GitHub App',
    intro:
      'RepoERD reads your repositories through a GitHub App with read-only access to their contents and metadata. Each user only sees the repositories they can access on GitHub.',
    publicUrl: 'Public URL of RepoERD',
    insecureUrl:
      'This address uses plain HTTP: sessions and GitHub sign-ins would travel unencrypted. Use HTTPS (a reverse proxy) unless RepoERD only runs on this machine.',
    app: 'GitHub App',
    create: 'Create a new App (recommended)',
    existing: 'Use an existing App',
    owner: 'Owner of the App',
    personal: 'My personal account',
    personalWarning:
      'GitHub lets a private App be installed only on the account that owns it: an App of your personal account never reaches the repositories of your organisations.',
    organization: 'An organisation',
    organizationName: 'Organisation',
    createHint: 'GitHub shows the App before creating it. Keep its permissions; you may rename it.',
    createSubmit: 'Create the App on GitHub',
    existingHint:
      'The App needs read access to Contents and Metadata, and the callback URL <code>{{callbackUrl}}</code>.',
    appId: 'App ID',
    appIdInvalid: "The App ID is the number shown on the App's settings page on GitHub.",
    clientId: 'Client ID',
    clientSecret: 'Client secret',
    privateKey: 'Private key (.pem)',
    existingSubmit: 'Save the App',
  },
  becomeAdmin: {
    title: 'Become the administrator',
    intro:
      '<strong>{{appName}}</strong> is ready. Sign in with GitHub: the first account signing in from this browser becomes the administrator of RepoERD.',
    defaultAppName: 'The GitHub App',
    signIn: 'Sign in with GitHub',
    stuck: 'Sign-in keeps failing? The App may have a wrong client secret or callback URL.',
    replaceApp: 'Use another GitHub App',
  },
  done: {
    fakeTitle: 'Nothing to set up',
    fakeIntro:
      'The server runs with <code>GITHUB_MODE=fake</code>: repositories come from the fixtures folder.',
    title: 'RepoERD is ready',
    intro:
      'Install the App on the repositories whose schemas you want to see. You can change this list on GitHub at any time.',
    install: 'Install {{appName}} on GitHub',
    openRepos: 'Open the repositories',
  },
  signInRefused:
    '{{message}} The client secret or the callback URL of the App may be wrong: check them on GitHub, or use another GitHub App.',
  /** Keyed by the `?error=` code of the GitHub callbacks. */
  errors: {
    state: 'The GitHub page took too long or was opened from another tab. Start again.',
    'invalid-grant': 'Your setup session expired. Enter the setup code again.',
    'github-rejected':
      'GitHub refused to create the App (its link is only valid for one hour). Start again.',
    'invalid-public-url': 'Enter the public URL of RepoERD first.',
    'already-configured': 'RepoERD is already configured.',
    github: 'GitHub could not be reached or refused the request. Try again in a few minutes.',
    unknown: 'Something went wrong. Start again.',
  },
}
