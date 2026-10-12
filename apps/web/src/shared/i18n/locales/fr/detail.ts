import type { Catalog } from '../en'

export const detail: Catalog['detail'] = {
  label: 'Détails de {{table}}',
  close: 'Fermer les détails',
  sections: {
    columns: 'Colonnes',
    indexes: 'Index',
    constraints: 'Contraintes',
    related: 'Tables liées',
  },
  traits: {
    primaryKey: 'Clé primaire',
    foreignKey: 'Clé étrangère',
    unique: 'Unique',
    notNull: 'Non nul',
    nullable: 'Peut être nul',
  },
  constraintKinds: {
    primaryKey: 'Clé primaire',
    foreignKey: 'Clé étrangère',
    unique: 'Unique',
    check: 'Vérification',
  },
  default: 'Valeur par défaut',
  noIndex: 'Aucun index.',
  noConstraint: 'Aucune contrainte.',
}
