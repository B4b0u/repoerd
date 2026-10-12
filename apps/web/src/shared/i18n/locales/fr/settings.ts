import type { Catalog } from '../en'

export const settings: Catalog['settings'] = {
  back: 'Retour au diagramme',
  title: 'Sources de schéma de {{repo}}',
  intro:
    "RepoERD trouve seul les schémas Prisma et Drizzle. Déclarez des sources ici s'il n'en trouve aucun ou pas les bons fichiers : elles remplacent alors la détection automatique pour ce dépôt. Les chemins sont relatifs à la racine du dépôt et peuvent être des fichiers, des dossiers ou des globs comme <code>packages/db/src/**/*.ts</code> ; les imports relatifs des fichiers Drizzle sont suivis.",
  readOnly: 'Il faut un accès en écriture (push) au dépôt pour modifier ces réglages.',
  automatic: 'Aucune source déclarée : la détection automatique est active.',
  source: 'Source {{number}}',
  name: 'Nom',
  format: 'Format',
  paths: 'Chemins (un par ligne)',
  remove: 'Retirer',
  removeSource: 'Retirer la source {{number}}',
  add: 'Ajouter une source',
  save: 'Enregistrer',
  saved: 'Enregistré. Ces sources remplacent la détection automatique.',
  savedAutomatic: 'Enregistré. La détection automatique est réactivée.',
  unsaved: {
    title: 'Quitter sans enregistrer ?',
    description:
      'Vos modifications des sources ne sont pas encore enregistrées : elles seront perdues.',
    stay: 'Rester',
    leave: 'Quitter',
  },
}
