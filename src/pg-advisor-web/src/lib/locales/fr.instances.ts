/**
 * Catalogue français — instances. Fichier dédié à cette zone de l'interface : plusieurs chantiers
 * peuvent avancer en parallèle sans se disputer un catalogue unique.
 *
 * La zone couvre la vue d'ensemble, le détail d'une instance et les trois vues
 * d'administration : instances supervisées, notifications et comptes. Les clés sont préfixées par
 * la vue, puis par le bloc où elles servent — `form`, `column`, `test`, `history`, `live`.
 */
export const frInstances: Record<string, string> = {
  // --- Vue d'ensemble -------------------------------------------------------
  // Le catalogue général porte déjà l'essentiel du vocabulaire ; ne sont ajoutées ici que les
  // formes accordées en nombre et ce que la reprise de la vue a rendu nécessaire.
  'dashboard.scoredInstances.one': 'moyenne sur {count} instance notée',
  'dashboard.scoredInstances.other': 'moyenne sur {count} instances notées',
  // « Diagnostic » nomme partout ce que l'Advisor produit. Les clés du catalogue général qui
  // disaient « recommandation » ou « finding » sont remplacées par celles-ci plutôt que
  // redéfinies : une clé masquée en silence diverge tôt ou tard de son original.
  'dashboard.activeDiagnostics': 'Diagnostics actifs',
  'dashboard.diagnosticsByCategory': 'Diagnostics actifs par catégorie',
  'dashboard.noDiagnostic': 'Aucun diagnostic actif',
  'dashboard.noDiagnosticBadge': 'aucun diagnostic',
  'dashboard.handleDiagnostics': 'Traiter les diagnostics',
  'dashboard.resolvedCount.one': '{count} résolu',
  'dashboard.resolvedCount.other': '{count} résolus',
  'dashboard.ignoredCount.one': '{count} ignoré',
  'dashboard.ignoredCount.other': '{count} ignorés',
  'dashboard.noInstanceHint':
    'L’Advisor note chaque instance dès sa première collecte, et n’y écrit jamais.',
  'dashboard.rulesTitle': 'Moteur de règles',
  'dashboard.awaitingCollection': 'en attente de collecte',
  // Annonces du flux temps réel, lues par les technologies d'assistance : une interface qui se
  // réécrit seule reste muette sans elles.
  'dashboard.live.newCritical.one': '{count} nouveau diagnostic critique',
  'dashboard.live.newCritical.other': '{count} nouveaux diagnostics critiques',
  'dashboard.live.scoreChanged': 'Santé globale : {score} sur 100',

  // --- Détail d'une instance ------------------------------------------------
  'instanceDetail.readableViews.one': 'Vue lisible ({count})',
  'instanceDetail.readableViews.other': 'Vues lisibles ({count})',
  'instanceDetail.extensionsPresent': 'Extensions présentes ({count})',
  'instanceDetail.extensionsMissing': 'Extensions absentes ({count})',
  'instanceDetail.noExtension': 'Aucune extension détectée',
  'instanceDetail.noView': 'Aucune vue lisible',
  'instanceDetail.readOnlyTitle': 'Supervision en lecture seule',
  // Le rappel zero-touch était assemblé de trois morceaux collés autour de deux blocs de code :
  // l'ordre des mots diffère d'une langue à l'autre, et l'anglais y gagnait une espace avant son
  // point. Deux réglages nommés, chacun avec sa conséquence, se traduisent sans acrobatie.
  'instanceDetail.readOnlyIntro':
    'L’Advisor n’écrit jamais sur cette instance. Chaque session est ouverte avec :',
  'instanceDetail.readOnlyItem': 'la session refuse toute écriture',
  'instanceDetail.readOnlyTimeoutItem': 'une requête trop longue est interrompue',
  'instanceDetail.readOnlyZeroTouch':
    'Les commandes correctives proposées sont à exécuter vous-même, ailleurs.',
  'instanceDetail.seeDiagnostics': 'Voir les diagnostics',
  'instanceDetail.live.scoreChanged': 'Santé de {name} : {score} sur 100',

  // --- Instances : liste ----------------------------------------------------
  'instances.subtitle': 'Chaque instance est supervisée en lecture seule et notée indépendamment.',
  'instances.add': 'Ajouter une instance',
  'instances.count.one': '{count} instance',
  'instances.count.other': '{count} instances',
  'instances.empty.title': 'Aucune instance supervisée',
  'instances.empty.body':
    'Ajoutez une connexion en lecture seule. L’Advisor ne modifie jamais l’instance PostgreSQL : la session est forcée en lecture seule.',
  'instances.column.target': 'Cible',
  'instances.column.lastCollection': 'Dernière collecte',
  'instances.collectedAt': 'Collecte {when}',
  'instances.delete.title': 'Supprimer « {name} » ?',
  'instances.delete.body':
    'L’instance PostgreSQL n’est pas touchée : seuls la connexion enregistrée, ses diagnostics et son historique sont supprimés de l’Advisor.',
  'instances.delete.confirm': 'Supprimer l’instance',
  'instances.column.score': 'Santé',
  'instances.viewerNotice':
    'Votre compte consulte la supervision sans la configurer : la gestion des instances est réservée aux administrateurs.',

  // --- Instances : formulaire de connexion ----------------------------------
  'instances.form.addTitle': 'Ajouter une instance PostgreSQL',
  'instances.form.editTitle': 'Modifier « {name} »',
  'instances.form.target': 'Cible',
  'instances.form.authentication': 'Authentification',
  'instances.form.collection': 'Collecte',
  'instances.form.enabled': 'Instance active',
  'instances.form.nameHint': 'Libellé affiché dans le dashboard',
  'instances.form.host': 'Hôte',
  'instances.form.hostPlaceholder': 'db.exemple.local',
  'instances.form.port': 'Port',
  'instances.form.database': 'Base de données',
  'instances.form.username': 'Utilisateur',
  'instances.form.usernameHint': 'Un rôle en lecture, membre de pg_monitor si possible',
  'instances.form.password': 'Mot de passe',
  'instances.form.passwordHint': 'Laisser vide pour conserver le mot de passe enregistré',
  'instances.form.passwordNewHint': 'Conservé chiffré, jamais réaffiché après enregistrement',
  'instances.form.interval': 'Intervalle de collecte (s)',
  'instances.form.intervalHint': '0 pour suivre la périodicité globale du scheduler',
  'instances.form.test': 'Tester la connexion',
  'instances.form.testFailed': 'Test impossible.',
  'instances.form.saveFailed': 'Enregistrement impossible.',
  // Chaque indication dit la conséquence du réglage, pas la syntaxe attendue.
  'instances.form.hostHint': 'Adresse joignable depuis le conteneur de l’Advisor',
  'instances.form.portHint': '5432 sauf port personnalisé',
  'instances.form.databaseHint': 'Seule cette base est analysée sur le serveur',
  'instances.form.sslModeHint': 'Prefer chiffre la session dès que le serveur l’accepte',
  'instances.form.enabledHint': 'décochée, elle reste enregistrée mais n’est plus collectée',
  'instances.form.create': 'Ajouter l’instance',
  'instances.form.submit': 'Enregistrer l’instance',

  // --- Instances : résultat du test de connexion ----------------------------
  'instances.test.failedTitle': 'Connexion impossible',
  'instances.test.successTitle': 'Connexion établie — PostgreSQL {version}',
  'instances.test.timescale': 'TimescaleDB {version}',
  'instances.test.readOnly': 'Session en lecture seule : {state}',
  'instances.test.readOnlyConfirmed': 'confirmée',
  'instances.test.readOnlyUnconfirmed': 'non confirmée',
  'instances.test.available': 'Disponible ({count})',
  'instances.test.missing': 'Absent ({count})',

  // --- Notifications : liste ------------------------------------------------
  'webhooks.subtitle':
    'Chaque épisode de diagnostic n’est notifié qu’une seule fois par destination.',
  'webhooks.add': 'Ajouter un webhook',
  'webhooks.count.one': '{count} webhook',
  'webhooks.count.other': '{count} webhooks',
  'webhooks.empty.title': 'Aucun webhook configuré',
  'webhooks.empty.body':
    'Un webhook reçoit les nouveaux diagnostics et leurs résolutions. Chaque épisode n’est notifié qu’une fois par destination.',
  'webhooks.event.newFinding': 'Nouveau diagnostic',
  'webhooks.event.findingResolved': 'Diagnostic résolu',
  'webhooks.format.generic': 'Générique (JSON complet)',
  // Le nom long explique le choix dans la liste déroulante ; la pastille d'une ligne de liste
  // n'a la place que du nom court.
  'webhooks.format.genericShort': 'Générique',
  'webhooks.format.genericHint':
    'Charge complète : instance, diagnostic, preuves. Pour un webhook maison ou un routeur d’alertes.',
  'webhooks.format.discord': 'Discord',
  'webhooks.format.discordHint':
    'Embed Discord coloré par sévérité. Obligatoire pour une URL discord.com/api/webhooks/…',
  'webhooks.format.slack': 'Slack',
  'webhooks.format.slackHint':
    'Message Slack avec pièce jointe colorée. Pour une URL hooks.slack.com/services/…',
  'webhooks.tag.enabled': 'actif',
  'webhooks.tag.disabled': 'inactif',
  'webhooks.tag.headers': 'en-têtes',
  // « à partir de Avertissement » se lisait mal ; le signe dit la même chose sans élision.
  'webhooks.fromSeverity': 'sévérité ≥ {severity}',
  'webhooks.allInstances': 'Toutes les instances',
  'webhooks.lastSuccess': 'dernier envoi réussi {when}',
  'webhooks.lastFailure': 'dernier envoi en échec {when} — {error}',
  'webhooks.testSent': 'Test envoyé à « {key} » (HTTP {status}).',
  'webhooks.testFailed': 'Test en échec pour « {key} » : {error}',
  'webhooks.formatFixed':
    '« {key} » émet désormais au format {format}. Relancez un test pour confirmer.',
  'webhooks.fixFailed': 'Correction impossible.',
  'webhooks.mismatchTitle': 'Format inadapté pour une URL {service}',
  'webhooks.mismatchBody':
    'La charge est émise au format « {format} », que {service} refuse avec « Cannot send an empty message ».',
  'webhooks.switchTo': 'Passer au format {format}',

  // --- Notifications : historique -------------------------------------------
  'webhooks.history.title': 'Historique des notifications ({count})',
  'webhooks.history.empty': 'Aucune notification envoyée',
  'webhooks.history.date': 'Date',
  'webhooks.history.webhook': 'Webhook',
  'webhooks.history.event': 'Événement',
  'webhooks.history.result': 'Résultat',
  'webhooks.history.failure': 'échec après {attempts} — {error}',
  'webhooks.history.attempts.one': '{count} tentative',
  'webhooks.history.attempts.other': '{count} tentatives',

  // --- Notifications : formulaire -------------------------------------------
  'webhooks.form.addTitle': 'Ajouter un webhook',
  'webhooks.form.editTitle': 'Modifier « {key} »',
  'webhooks.form.destination': 'Destination',
  'webhooks.form.key': 'Identifiant',
  'webhooks.form.keyHint': 'Minuscules, sans espace : sert de référence dans les logs',
  'webhooks.form.url': 'URL',
  'webhooks.form.urlPlaceholder': 'https://hooks.exemple.local/pg-advisor',
  'webhooks.form.format': 'Format de la charge',
  'webhooks.form.enabled': 'Webhook actif',
  'webhooks.form.mismatch':
    'Cette URL ressemble à un webhook {service} : avec le format générique, le service répondra « HTTP 400 Bad Request ». Choisissez le format correspondant.',
  'webhooks.form.trigger': 'Déclenchement',
  'webhooks.form.minimumSeverity': 'Sévérité minimale',
  'webhooks.form.connection': 'Instance concernée',
  'webhooks.form.events': 'Événements',
  'webhooks.form.transport': 'Transport',
  'webhooks.form.headers': 'En-têtes HTTP',
  'webhooks.form.headersHint':
    'Un par ligne, au format Nom: valeur. Peut contenir un jeton : jamais renvoyé par l’API.',
  'webhooks.form.replaceHeaders': 'Remplacer les en-têtes enregistrés',
  'webhooks.form.headersKept': 'Les en-têtes HTTP enregistrés sont conservés tels quels.',
  'webhooks.form.saveFailed': 'Enregistrement impossible.',
  'webhooks.form.enabledHint': 'décoché, il reste enregistré mais n’émet plus rien',
  'webhooks.form.urlHint': 'Adresse appelée en POST à chaque envoi',
  'webhooks.form.minimumSeverityHint': 'Les diagnostics moins graves ne déclenchent aucun envoi',
  'webhooks.form.connectionHint': 'Restreint les envois à une seule instance supervisée',
  'webhooks.form.eventsHint': 'Au moins un événement, sans quoi rien n’est envoyé',
  'webhooks.form.create': 'Ajouter le webhook',
  'webhooks.form.submit': 'Enregistrer le webhook',
  'webhooks.delete.confirm': 'Supprimer le webhook',
  'webhooks.viewerNotice':
    'Votre compte consulte les notifications sans les configurer : leur gestion est réservée aux administrateurs.',

  // --- Comptes --------------------------------------------------------------
  'users.subtitle':
    'Un lecteur consulte la vue d’ensemble et les diagnostics ; un administrateur gère instances, règles et notifications.',
  'users.adminOnly': 'Cette page est réservée aux administrateurs.',
  'users.add': 'Ajouter un compte',
  'users.count.one': '{count} compte',
  'users.count.other': '{count} comptes',
  'users.empty': 'Ajouter un premier compte',
  'users.emptyHint':
    'Un compte donne accès à l’Advisor : un lecteur consulte la supervision, un administrateur la configure.',
  'users.column.username': 'Identifiant',
  'users.column.role': 'Rôle',
  'users.column.createdAt': 'Créé le',
  'users.column.lastLogin': 'Dernière connexion',
  'users.you': 'vous',
  'users.mustChangePassword': 'mot de passe à changer',
  'users.roleFor': 'Rôle de {name}',
  'users.resetPassword': 'Nouveau mot de passe',
  'users.createFailed': 'Création impossible.',
  'users.updateFailed': 'Modification impossible.',
  'users.deleteFailed': 'Suppression impossible.',
  'users.form.username': 'Identifiant',
  'users.form.password': 'Mot de passe',
  'users.form.passwordHint': '10 caractères minimum',
  'users.form.role': 'Rôle',
  'users.form.roleHint': 'Un lecteur consulte le dashboard mais ne modifie rien',
  'users.form.create': 'Créer le compte',
  'users.form.usernameHint': 'Sert à ouvrir la session ; il ne pourra plus être modifié',
  'users.reset.title': 'Nouveau mot de passe pour « {name} »',
  'users.reset.body':
    'Le compte devra utiliser ce mot de passe à sa prochaine connexion. Il n’est affiché nulle part après enregistrement : transmettez-le vous-même.',
  'users.reset.submit': 'Enregistrer le mot de passe',
  'users.delete.confirm': 'Supprimer le compte',
  'users.changeOwn.title': 'Changer mon mot de passe',
  'users.changeOwn.hint': 'La session en cours reste ouverte après le changement.',
  'users.changeOwn.current': 'Mot de passe actuel',
  'users.changeOwn.new': 'Nouveau mot de passe',
  'users.changeOwn.submit': 'Changer',
  'users.changeOwn.done': 'Mot de passe modifié.',
  'webhooks.delete.title': 'Supprimer « {name} » ?',
  'webhooks.delete.body':
    'La configuration et son historique d’envois sont retirés. Les diagnostics déjà notifiés ne sont pas renvoyés.',
  'webhooks.deleteFailed': 'Suppression impossible.',
  'users.delete.title': 'Supprimer « {name} » ?',
  'users.delete.body':
    'Le compte perd immédiatement son accès. Les diagnostics qu’il a ignorés gardent sa trace dans leur historique.',
}
