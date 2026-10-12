import type { Catalog } from '../en'

export const diagram: Catalog['diagram'] = {
  treeTruncated:
    "Ce dépôt est trop volumineux pour l'API GitHub : la liste des fichiers est incomplète, certains schémas peuvent manquer à la détection.",
  failure: {
    noSchemaFound:
      "Aucun schéma Prisma ou Drizzle n'a été trouvé sur cette branche. RepoERD cherche les fichiers schema.prisma, les dossiers prisma/schema/, les fichiers prisma.config, le champ « prisma.schema » des package.json et les fichiers drizzle.config.",
    sourceNotFound: "La source de schéma « {{sourceId}} » n'existe pas sur cette branche.",
    sourceEmpty: 'La configuration du schéma ne correspond à aucun fichier sur cette branche.',
    drizzleConfigUnreadable:
      "L'option « schema » de {{configPath}} est calculée à l'exécution : elle ne peut pas être lue sans exécuter le fichier. Utilisez un chemin, un tableau ou un glob littéral dans la configuration.",
    unsafePattern:
      'Le motif « {{pattern}} » est trop complexe ou utilise une syntaxe non prise en charge : accolades, globs étendus et négations ne sont pas pris en charge, et les motifs sont limités à 200 caractères, 8 « * » et 2 groupes de « * » par niveau de dossier. Simplifiez-le dans les réglages du dépôt ou dans drizzle.config.',
    tooManyFiles: "Ce schéma s'étend sur {{actual}} fichiers ; la limite est de {{max}}.",
    tooLarge: 'Ce schéma pèse {{actual}} ; la limite est de {{max}}.',
    tooManyConfigs:
      'Cette branche a {{actual}} fichiers de configuration du schéma ; RepoERD lit les {{max}} premiers. Déclarez les sources du schéma à la main pour choisir.',
    fileTooComplex:
      "RepoERD n'analyse pas {{path}} : les fichiers de plus de 256 Ko, ou imbriqués sur plus de 500 niveaux, sont refusés pour protéger le serveur.",
    unsupportedDialect:
      'Le dialecte de {{configPath}} est « {{dialect}} » : RepoERD ne lit que les schémas PostgreSQL.',
    prismaConfigUnreadable:
      "L'option « schema » de {{configPath}} est calculée à l'exécution : elle ne peut pas être lue sans exécuter le fichier. Utilisez un chemin littéral dans la configuration, ou déclarez les sources du schéma à la main.",
    noTablesFound: 'Les fichiers de ce schéma ne déclarent aucune table que RepoERD sache lire.',
    unresolvedImports:
      "Ces imports n'ont pas pu être suivis : {{imports}}. Déclarez les fichiers qu'ils désignent dans les sources du schéma.",
    parseError: "Le schéma n'a pas pu être analysé :\n{{message}}",
    prismaRejected:
      "Prisma a refusé ce schéma. RepoERD lit les schémas Prisma avec Prisma 6.8 : un schéma écrit pour une version plus récente peut utiliser une construction qu'il ne connaît pas encore. Message de Prisma :\n{{message}}",
    parserCrashed:
      "Le parseur s'est arrêté de façon inattendue en lisant ce schéma : il est peut-être trop volumineux ou trop imbriqué.",
    parseTimeout: "L'analyse du schéma a dépassé 10 secondes et a été arrêtée.",
    declareSources: 'Déclarer les sources du schéma à la main',
    showDefaultSource: 'Afficher le schéma par défaut',
  },
  toolbar: {
    sources: 'Sources',
    sourcesTitle: 'Sources de schéma de ce dépôt',
    refresh: 'Actualiser depuis le dépôt',
  },
  branch: {
    loading: 'Chargement…',
    sourceMissing:
      "La source « {{source}} » n'existe pas sur cette branche : source par défaut affichée.",
    current: 'Branche : {{branch}}',
    search: 'Rechercher une branche…',
    none: 'Aucune branche trouvée.',
    loadFailed: 'Impossible de charger les branches : {{message}}',
    refine_one: '{{count}} autre branche correspond : affinez la recherche.',
    refine_other: '{{count}} autres branches correspondent : affinez la recherche.',
    truncated: "GitHub liste plus de branches que RepoERD n'en lit : certaines manquent.",
  },
  source: { label: 'Schéma' },
  commit: { open: 'Ouvrir le commit {{sha}} sur GitHub' },
  loading: 'Chargement du schéma…',
  emptySchema: "Ce schéma n'a aucune table.",
  ignoredViews_one: "{{count}} vue n'est pas affichée : RepoERD ne dessine que les tables.",
  ignoredViews_other: '{{count}} vues ne sont pas affichées : RepoERD ne dessine que les tables.',
  loadFailed: 'Impossible de charger le schéma : {{message}}',
  placementFailed: 'Impossible de placer les tables : {{message}}',
  layoutLoadFailed: 'Impossible de charger votre disposition : {{message}}',
  a11y: {
    node: 'Une table du diagramme. La liste des tables mène à chaque table au clavier.',
    moved: 'Table déplacée ({{direction}}) : x {{x}}, y {{y}}.',
    edge: 'Une relation entre deux tables.',
    controls: 'Commandes du diagramme',
    interactive: "Activer ou désactiver l'interaction",
    minimap: 'Mini-carte',
    handle: 'Point de liaison',
  },
  canvas: {
    zoomIn: 'Zoomer',
    zoomOut: 'Dézoomer',
    fit: "Ajuster à l'écran",
    rearrange: 'Réorganiser toutes les tables',
    displayMode: "Mode d'affichage",
    placing: 'Placement des tables…',
  },
  displayModes: {
    ALL_FIELDS: 'Tous les champs',
    KEYS_ONLY: 'Clés uniquement',
    TABLE_NAME: 'Nom de table',
  },
  rearrange: {
    title: 'Réorganiser toutes les tables ?',
    description: 'La disposition enregistrée pour cette vue sera remplacée.',
    confirm: 'Réorganiser',
  },
  layout: { saveFailed: "Les changements de disposition n'ont pas pu être enregistrés." },
  related: {
    banner: 'Tables liées à <strong>{{table}}</strong>',
    back: 'Retour au schéma complet',
  },
  preview: {
    related_one: '{{count}} table liée',
    related_other: '{{count}} tables liées',
    selfOnly: 'Liée uniquement à elle-même',
    none: 'Aucune table liée',
    open: 'Ouvrir dans la vue principale',
  },
}
