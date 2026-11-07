import type { GroupsCatalog } from '../en/groups'

export const groups: GroupsCatalog = {
  proposed_one: "{{count}} groupe proposé d'après les fichiers du schéma",
  proposed_other: "{{count}} groupes proposés d'après les fichiers du schéma",
  saveForTeam: "Enregistrer pour l'équipe",
  ignoreForTeam: "Ignorer pour l'équipe",
  replaceForTeam: "Remplacer pour l'équipe",
  cancelProposal: 'Annuler',
  repropose: "Proposer à nouveau d'après les fichiers",
  reproposeHint:
    "Afficher les groupes proposés d'après les fichiers du schéma à la place de ceux enregistrés",
  replaced: 'Groupes remplacés par les propositions.',
  tag: 'Groupe : {{name}}',
  ungrouped: 'Hors groupe',
  showGroup: 'Afficher le groupe {{name}}',
  collapseGroup: 'Replier le groupe {{name}}',
  expandGroup: 'Déplier le groupe {{name}}',
  undo: 'Annuler',
  notices: {
    deleted: 'Groupe « {{name}} » supprimé.',
    placed_one: '{{count}} table rangée dans « {{name}} ».',
    placed_other: '{{count}} tables rangées dans « {{name}} ».',
    ungrouped_one: '{{count}} table sortie de son groupe.',
    ungrouped_other: '{{count}} tables sorties de leur groupe.',
    followFile_one: '{{count}} table suit de nouveau son fichier.',
    followFile_other: '{{count}} tables suivent de nouveau leur fichier.',
  },
  problems: {
    'unknown-group': "Ce groupe n'existe plus : quelqu'un l'a peut-être supprimé entre-temps.",
    'too-many-groups': 'Au plus {{max}} groupes par source de schéma.',
    'too-many-assignments': 'Au plus {{max}} tables rangées à la main par source de schéma.',
    'too-many-sources': 'Ce dépôt a déjà des groupes pour {{max}} sources de schéma, le maximum.',
    'duplicate-origin':
      'Deux groupes revendiquent le même fichier, dossier ou schéma Postgres. Rechargez la page et réessayez.',
  },
}
