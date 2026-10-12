import type { Catalog } from '../en'

export const auth: Catalog['auth'] = {
  pageTitle: 'Connexion',
  intro: 'Connectez-vous avec GitHub pour voir les schémas de base de données de vos dépôts.',
  signIn: 'Se connecter avec GitHub',
  appReplaced:
    "La GitHub App de ce RepoERD a été remplacée : tout le monde se reconnecte. Si la nouvelle App n'est pas encore installée sur vos dépôts, installez-la d'abord.",
  installApp: 'Installer {{appName}} sur GitHub',
  errors: {
    denied: 'La connexion a été annulée sur GitHub.',
    state: 'La connexion a pris trop de temps ou a été lancée depuis un autre onglet. Réessayez.',
    'invalid-code': 'GitHub a refusé la connexion. Réessayez.',
    'org-not-allowed':
      "Votre compte GitHub n'est membre d'aucune organisation autorisée sur ce RepoERD.",
    'not-configured': "RepoERD n'est pas encore configuré.",
    github: 'GitHub est injoignable ou a refusé la requête. Réessayez dans quelques minutes.',
    unknown: 'La connexion a échoué. Réessayez.',
  },
}
