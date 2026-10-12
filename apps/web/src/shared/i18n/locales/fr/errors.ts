import type { Catalog } from '../en'

export const errors: Catalog['errors'] = {
  network: 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.',
  http: 'Le serveur a répondu par une erreur (HTTP {{status}}).',
  codes: {
    bad_request: 'Le serveur a refusé la requête.',
    unauthenticated: 'Connectez-vous pour continuer.',
    reauth_required: 'Votre connexion GitHub a expiré. Reconnectez-vous.',
    payload_too_large: 'Cette requête est trop volumineuse (4 Mo au maximum).',
    forbidden: "Vous n'avez pas le droit de faire cela.",
    org_not_allowed:
      "Votre compte GitHub n'appartient à aucune organisation autorisée sur ce RepoERD.",
    not_found: 'Introuvable.',
    repo_not_found: 'Dépôt introuvable.',
    repo_moved: 'Ce dépôt est désormais {{owner}}/{{name}}.',
    branch_not_found: 'Branche « {{branch}} » introuvable.',
    no_common_history: "Ces branches n'ont aucun ancêtre commun.",
    conflict:
      "Cette modification entre en conflit avec l'état actuel. Rechargez la page et réessayez.",
    setup_required: "RepoERD n'est pas encore configuré : ouvrez /setup.",
    invalid_setup_code:
      'Code de configuration incorrect. Utilisez le code affiché dans les journaux du serveur.',
    github_error: 'GitHub ne répond pas, réessayez.',
    github_rate_limited: 'Limite de requêtes GitHub atteinte. Réessayez dans quelques minutes.',
    rate_limited: 'Trop de requêtes. Patientez un instant puis réessayez.',
    server_busy: "Le serveur est occupé à lire d'autres schémas. Réessayez dans un instant.",
    internal_error: 'Erreur inattendue du serveur.',
  },
  reasons: {
    'missing-mutation-header':
      "La requête a été refusée car il lui manque l'en-tête de RepoERD. Rechargez la page.",
    'write-access-required': 'Il faut un accès en écriture à ce dépôt.',
    'admins-only': 'Réservé aux administrateurs.',
    'setup-code-required': "Saisissez d'abord le code de configuration.",
    'already-configured': 'RepoERD est déjà configuré.',
    'invalid-public-url':
      "L'URL publique doit être une adresse http(s) sans chemin, par exemple https://erd.example.com.",
    'invalid-organization': "« {{login}} » n'est pas un nom d'organisation GitHub valide.",
    'self-lockout':
      "Votre compte GitHub n'a accès à aucune installation de l'App sur ces organisations : enregistrer vous couperait l'accès.",
    'user-never-signed-in': "Cet utilisateur GitHub ne s'est jamais connecté à RepoERD.",
    'not-admin': "Cet utilisateur n'est pas administrateur.",
    'config-changed':
      'Un autre administrateur a modifié la configuration entre-temps. Vérifiez les valeurs affichées puis enregistrez de nouveau.',
    'last-admin': "RepoERD a besoin d'au moins un administrateur.",
    'app-credentials-rejected': "GitHub a refusé ces identifiants d'App.",
    'too-many-sources': '{{max}} sources de schéma au maximum par dépôt.',
    'name-missing': 'Chaque source doit avoir un nom.',
    'name-control-characters':
      'Les noms de source ne doivent pas contenir de caractères de contrôle.',
    'name-too-long': 'Les noms de source sont limités à {{max}} caractères.',
    'duplicate-name': "Deux sources s'appellent « {{name}} ».",
    'no-path': 'La source « {{name}} » doit avoir au moins un chemin.',
    'too-many-paths': 'La source « {{name}} » a plus de {{max}} chemins.',
    'path-too-long': 'Les chemins sont limités à {{max}} caractères.',
    'path-invalid':
      'Le chemin « {{path}} » de la source « {{name}} » doit être relatif à la racine du dépôt, sans « .. », « \\ » ni caractère de contrôle.',
    'invalid-body': 'La requête était mal formée. Rechargez la page et réessayez.',
    'invalid-repository-name': "Ce nom de dépôt n'est pas valide.",
    'invalid-layout-target':
      "La demande de disposition n'indique pas de source ou de mode d'affichage valide, ou ce dépôt compte déjà 50 dispositions enregistrées.",
    'invalid-layout': 'Ces positions de tables ont été refusées. Rechargez la page et réessayez.',
    'invalid-compare': 'Cette comparaison est invalide : choisissez deux branches différentes.',
    'invalid-branch-name': "Ce nom de branche n'est pas valide.",
  },
}
