import type { Catalog } from '../en'

export const setup: Catalog['setup'] = {
  title: 'Configurer RepoERD',
  progress: 'Progression de la configuration',
  stepDone: 'terminé',
  steps: {
    unlock: 'Code de configuration',
    'register-app': 'GitHub App',
    'become-admin': 'Administrateur',
    done: 'Terminé',
  },
  unlock: {
    title: 'Saisir le code de configuration',
    intro:
      'Au démarrage, le serveur a affiché un code à usage unique dans ses journaux. Il prouve que vous administrez ce serveur.',
    code: 'Code de configuration',
    cookieRefused:
      'Le code est bon, mais ce navigateur a refusé le cookie de configuration. RepoERD doit être servi en HTTPS (ou sur localhost, ou derrière un proxy qui envoie <code>x-forwarded-proto: https</code>) car ses cookies sont « Secure ».',
    submit: 'Continuer',
  },
  registerApp: {
    title: 'Connecter une GitHub App',
    intro:
      'RepoERD lit vos dépôts via une GitHub App ayant un accès en lecture seule à leur contenu et à leurs métadonnées. Chaque utilisateur ne voit que les dépôts auxquels il a accès sur GitHub.',
    publicUrl: 'URL publique de RepoERD',
    insecureUrl:
      'Cette adresse est en HTTP simple : les sessions et les connexions GitHub circuleraient en clair. Utilisez HTTPS (un reverse proxy), sauf si RepoERD ne tourne que sur cette machine.',
    app: 'GitHub App',
    create: 'Créer une nouvelle App (recommandé)',
    existing: 'Utiliser une App existante',
    owner: "Propriétaire de l'App",
    personal: 'Mon compte personnel',
    personalWarning:
      "GitHub n'autorise l'installation d'une App privée que sur le compte qui la possède : une App de votre compte personnel n'atteint jamais les dépôts de vos organisations.",
    organization: 'Une organisation',
    organizationName: 'Organisation',
    createHint:
      "GitHub montre l'App avant de la créer. Gardez ses permissions ; vous pouvez la renommer.",
    createSubmit: "Créer l'App sur GitHub",
    existingHint:
      "L'App doit avoir l'accès en lecture à Contents et Metadata, et l'URL de callback <code>{{callbackUrl}}</code>.",
    appId: "ID de l'App",
    appIdInvalid: "L'App ID est le nombre affiché sur la page de réglages de l'App sur GitHub.",
    clientId: 'Client ID',
    clientSecret: 'Secret client',
    privateKey: 'Clé privée (.pem)',
    existingSubmit: "Enregistrer l'App",
  },
  becomeAdmin: {
    title: "Devenir l'administrateur",
    intro:
      "<strong>{{appName}}</strong> est prête. Connectez-vous avec GitHub : le premier compte qui se connecte depuis ce navigateur devient l'administrateur de RepoERD.",
    defaultAppName: 'La GitHub App',
    signIn: 'Se connecter avec GitHub',
    stuck:
      "La connexion échoue toujours ? Le secret client ou l'URL de callback de l'App est peut-être erroné.",
    replaceApp: 'Utiliser une autre GitHub App',
  },
  done: {
    fakeTitle: 'Rien à configurer',
    fakeIntro:
      'Le serveur tourne avec <code>GITHUB_MODE=fake</code> : les dépôts viennent du dossier des fixtures.',
    title: 'RepoERD est prêt',
    intro:
      "Installez l'App sur les dépôts dont vous voulez voir les schémas. Vous pouvez modifier cette liste sur GitHub à tout moment.",
    install: 'Installer {{appName}} sur GitHub',
    openRepos: 'Ouvrir les dépôts',
  },
  signInRefused:
    "{{message}} Le secret client ou l'URL de callback de l'App est peut-être erroné : vérifiez-les sur GitHub, ou utilisez une autre GitHub App.",
  errors: {
    state:
      'La page GitHub a pris trop de temps ou a été ouverte depuis un autre onglet. Recommencez.',
    'invalid-grant':
      'Votre session de configuration a expiré. Saisissez à nouveau le code de configuration.',
    'github-rejected':
      "GitHub a refusé de créer l'App (son lien n'est valable qu'une heure). Recommencez.",
    'invalid-public-url': "Saisissez d'abord l'URL publique de RepoERD.",
    'already-configured': 'RepoERD est déjà configuré.',
    github: 'GitHub est injoignable ou a refusé la requête. Réessayez dans quelques minutes.',
    unknown: "Une erreur s'est produite. Recommencez.",
  },
}
