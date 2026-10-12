import type { Catalog } from '../en'

export const repos: Catalog['repos'] = {
  title: 'Dépôts',
  count_one: '{{count}} dépôt',
  count_other: '{{count}} dépôts',
  filter: 'Filtrer les dépôts',
  loading: 'Chargement des dépôts…',
  private: 'Privé',
  emptyNone:
    "Aucun dépôt pour l'instant. Installez la GitHub App sur les dépôts à afficher ; une nouvelle installation peut mettre quelques minutes à apparaître.",
  emptyFiltered: 'Aucun dépôt ne correspond.',
  install: 'Installer la GitHub App',
  refresh: 'Actualiser la liste',
  refreshed: 'La liste a été actualisée : toujours aucun dépôt visible.',
}
