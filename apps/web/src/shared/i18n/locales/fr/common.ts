import type { Catalog } from '../en'

export const common: Catalog['common'] = {
  cancel: 'Annuler',
  loading: 'Chargement…',
  notFoundTitle: 'Page introuvable',
  pageNotFound: 'Page introuvable.',
  pageLoadFailed:
    'Impossible de charger cette page. RepoERD a peut-être été mis à jour : rechargez pour obtenir la dernière version.',
  reload: 'Recharger',
  newVersion: 'Une nouvelle version de RepoERD est disponible.',
  dismiss: 'Fermer',
  retry: 'Réessayer',
  serverUnreachable: 'Impossible de joindre le serveur : {{message}}',
  accountUnavailable: 'Impossible de charger votre compte : {{message}}',
  formats: { prisma: 'Prisma', drizzle: 'Drizzle' },
  copyLink: { action: 'Copier le lien', copied: 'Lien copié', prompt: 'Copiez ce lien' },
  theme: {
    toLight: 'Passer au thème clair',
    toDark: 'Passer au thème sombre',
  },
  language: {
    label: 'Langue',
    en: 'English',
    fr: 'Français',
  },
  userMenu: {
    signedInAs: 'Connecté en tant que {{login}}',
    admin: 'Administration',
    signOut: 'Se déconnecter',
    signOutFailed: 'Impossible de se déconnecter. Réessayez.',
  },
}
