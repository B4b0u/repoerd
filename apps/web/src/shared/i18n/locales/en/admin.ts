export const admin = {
  back: 'Repositories',
  title: 'Administration',
  adminsOnly: 'Administrators only.',
  app: {
    title: 'GitHub App',
    owned: '<strong>{{name}}</strong>, owned by {{owner}}.',
    settings: 'App settings on GitHub',
    install: 'Install on repositories',
    fake: 'Fake GitHub mode: no GitHub App.',
    none: 'No GitHub App configured.',
  },
  replaceApp: {
    title: 'Replace the GitHub App',
    intro:
      'Use another GitHub App (for example one owned by your organisation), or new credentials of this one after rotating its private key or client secret on GitHub. Layouts, repository settings and administrators are kept.',
    start: 'Replace the App…',
    confirmTitle: 'Replace the GitHub App?',
    confirmDescription:
      'Once the new App is saved, everyone is signed out, you included, and signs in again through it. Install the new App on your repositories before signing in: when sign-in is restricted to organisations, only users with access to an installation of the new App can sign in.',
    confirm: 'Continue',
    existing: 'Use an existing App, or new credentials of this one',
    existingSubmit: 'Replace with this App',
    nameHint:
      'GitHub App names are unique: if GitHub says the name is taken, rename the new App in its form.',
    /** Keyed by the `?error=` code of GitHub's replacement callback. */
    errors: {
      state: 'The GitHub page took too long or was opened from another tab. Start again.',
      forbidden:
        'Only an administrator signed in with a working GitHub access can replace the App. Sign in again, then start again.',
      'github-rejected':
        'GitHub refused to create the App (its link is only valid for one hour). Start again.',
      'not-configured': 'Save the public URL of RepoERD first.',
      github: 'GitHub could not be reached or refused the request. Try again in a few minutes.',
      unknown: 'Something went wrong. Start again.',
    },
  },
  publicUrl: {
    title: 'Public URL',
    label: 'Public URL',
    hint: 'The GitHub App must declare this callback URL (RepoERD cannot change it on GitHub): <code>{{callbackUrl}}</code>',
    openSettings: 'Open the App settings',
    save: 'Save public URL',
    saved: 'Public URL saved. Update the callback URL on GitHub if it changed.',
  },
  orgs: {
    title: 'Sign-in restriction',
    label: 'Allowed organisations',
    hint: 'Empty: anyone who can access an installation of the App can sign in. Otherwise, only users with access to an installation of the App on one of these accounts.',
    save: 'Save organisations',
    saved: 'Organisations saved.',
  },
  admins: {
    title: 'Administrators',
    you: 'you',
    remove: 'Remove {{login}}',
    login: 'GitHub login',
    add: 'Add administrator',
    hint: 'The user must have signed in to RepoERD once.',
    confirmTitle: 'Remove your own administrator rights?',
    confirmDescription:
      'You will lose access to this page. Another administrator can give them back.',
    confirm: 'Remove my rights',
  },
  users: {
    title: 'Users',
    intro:
      'Everyone who signed in to RepoERD. Signing someone out ends all their sessions; they can sign in again as long as GitHub lets them.',
    admin: 'administrator',
    stale: 'former login',
    lastSeen: 'Last active {{date}}',
    neverSeen: 'No activity recorded',
    sessions_one: '{{count}} active session',
    sessions_other: '{{count}} active sessions',
    signOut: 'Sign {{login}} out everywhere',
    confirmTitle: 'Sign {{login}} out everywhere?',
    confirmDescription:
      'All their sessions end now. They can sign in again as long as their GitHub account has access.',
    confirmSelf:
      'All your sessions end now, this browser included: you will have to sign in again.',
    confirm: 'Sign out everywhere',
    signedOut: '{{login}} was signed out everywhere.',
  },
}
