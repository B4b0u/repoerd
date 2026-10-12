import type { Catalog } from '../en'

export const admin: Catalog['admin'] = {
  back: 'Dépôts',
  title: 'Administration',
  adminsOnly: 'Réservé aux administrateurs.',
  app: {
    title: 'GitHub App',
    owned: '<strong>{{name}}</strong>, appartenant à {{owner}}.',
    settings: "Réglages de l'App sur GitHub",
    install: 'Installer sur des dépôts',
    fake: 'Mode GitHub simulé : pas de GitHub App.',
    none: 'Aucune GitHub App configurée.',
  },
  replaceApp: {
    title: 'Remplacer la GitHub App',
    intro:
      'Utilisez une autre GitHub App (par exemple une App de votre organisation), ou de nouveaux identifiants de celle-ci après avoir renouvelé sa clé privée ou son secret client sur GitHub. Les dispositions, les réglages des dépôts et les administrateurs sont conservés.',
    start: "Remplacer l'App…",
    confirmTitle: 'Remplacer la GitHub App ?',
    confirmDescription:
      'Une fois la nouvelle App enregistrée, tout le monde est déconnecté, vous compris, et se reconnecte avec elle. Installez la nouvelle App sur vos dépôts avant de vous reconnecter : quand la connexion est restreinte à des organisations, seules les personnes ayant accès à une installation de la nouvelle App peuvent se connecter.',
    confirm: 'Continuer',
    existing: 'Utiliser une App existante, ou de nouveaux identifiants de celle-ci',
    existingSubmit: 'Remplacer par cette App',
    nameHint:
      'Les noms de GitHub App sont uniques : si GitHub indique que le nom est pris, renommez la nouvelle App dans son formulaire.',
    errors: {
      state:
        'La page GitHub a pris trop de temps ou a été ouverte depuis un autre onglet. Recommencez.',
      forbidden:
        "Seul un administrateur connecté avec un accès GitHub valide peut remplacer l'App. Reconnectez-vous, puis recommencez.",
      'github-rejected':
        "GitHub a refusé de créer l'App (son lien n'est valable qu'une heure). Recommencez.",
      'not-configured': "Enregistrez d'abord l'URL publique de RepoERD.",
      github: 'GitHub est injoignable ou a refusé la requête. Réessayez dans quelques minutes.',
      unknown: "Une erreur s'est produite. Recommencez.",
    },
  },
  publicUrl: {
    title: 'URL publique',
    label: 'URL publique',
    hint: 'La GitHub App doit déclarer cette URL de callback (RepoERD ne peut pas la changer sur GitHub) : <code>{{callbackUrl}}</code>',
    openSettings: "Ouvrir les réglages de l'App",
    save: "Enregistrer l'URL publique",
    saved: "URL publique enregistrée. Mettez à jour l'URL de callback sur GitHub si elle a changé.",
  },
  orgs: {
    title: 'Restriction de connexion',
    label: 'Organisations autorisées',
    hint: "Vide : toute personne ayant accès à une installation de l'App peut se connecter. Sinon, seulement les personnes ayant accès à une installation de l'App sur l'un de ces comptes.",
    save: 'Enregistrer les organisations',
    saved: 'Organisations enregistrées.',
  },
  admins: {
    title: 'Administrateurs',
    you: 'vous',
    remove: 'Retirer {{login}}',
    login: 'Login GitHub',
    add: 'Ajouter un administrateur',
    hint: "La personne doit s'être connectée une fois à RepoERD.",
    confirmTitle: "Retirer vos propres droits d'administrateur ?",
    confirmDescription:
      "Vous perdrez l'accès à cette page. Un autre administrateur pourra vous les rendre.",
    confirm: 'Retirer mes droits',
  },
  users: {
    title: 'Utilisateurs',
    intro:
      "Toutes les personnes qui se sont connectées à RepoERD. Déconnecter quelqu'un met fin à toutes ses sessions ; la personne peut se reconnecter tant que GitHub le lui permet.",
    admin: 'administrateur',
    stale: 'ancien login',
    lastSeen: 'Dernière activité le {{date}}',
    neverSeen: 'Aucune activité enregistrée',
    sessions_one: '{{count}} session active',
    sessions_other: '{{count}} sessions actives',
    signOut: 'Déconnecter {{login}} partout',
    confirmTitle: 'Déconnecter {{login}} partout ?',
    confirmDescription:
      'Toutes ses sessions prennent fin maintenant. La personne peut se reconnecter tant que son compte GitHub y a accès.',
    confirmSelf:
      'Toutes vos sessions prennent fin maintenant, ce navigateur compris : vous devrez vous reconnecter.',
    confirm: 'Déconnecter partout',
    signedOut: '{{login}} a été déconnecté partout.',
  },
}
