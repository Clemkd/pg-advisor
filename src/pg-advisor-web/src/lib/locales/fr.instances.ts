/**
 * Catalogue français — instances. Fichier dédié à cette zone de l'interface : plusieurs chantiers
 * peuvent avancer en parallèle sans se disputer un catalogue unique.
 *
 * La zone couvre les trois vues d'administration : instances supervisées, notifications et
 * comptes. Les clés sont préfixées par la vue, puis par le bloc où elles servent — `form`,
 * `column`, `test`, `history`.
 */
export const frInstances: Record<string, string> = {
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
    'L’instance PostgreSQL n’est pas touchée : seuls la connexion enregistrée, ses findings et son historique sont supprimés de l’Advisor.',

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
  'instances.form.interval': 'Intervalle de collecte (s)',
  'instances.form.intervalHint': '0 pour suivre la périodicité globale du scheduler',
  'instances.form.test': 'Tester la connexion',
  'instances.form.testFailed': 'Test impossible.',
  'instances.form.saveFailed': 'Enregistrement impossible.',

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
    'Chaque épisode de finding n’est notifié qu’une seule fois par destination.',
  'webhooks.add': 'Ajouter un webhook',
  'webhooks.count.one': '{count} webhook',
  'webhooks.count.other': '{count} webhooks',
  'webhooks.empty.title': 'Aucun webhook configuré',
  'webhooks.empty.body':
    'Un webhook reçoit les nouveaux findings et leurs résolutions. Chaque épisode n’est notifié qu’une fois par destination.',
  'webhooks.event.newFinding': 'Nouveau finding',
  'webhooks.event.findingResolved': 'Finding résolu',
  'webhooks.format.generic': 'Générique (JSON complet)',
  'webhooks.format.genericHint':
    'Charge complète : instance, finding, preuves. Pour un webhook maison ou un routeur d’alertes.',
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

  // --- Comptes --------------------------------------------------------------
  'users.subtitle':
    'Un lecteur consulte le dashboard et les recommandations ; un administrateur gère instances, règles et notifications.',
  'users.adminOnly': 'Cette page est réservée aux administrateurs.',
  'users.add': 'Ajouter un compte',
  'users.count.one': '{count} compte',
  'users.count.other': '{count} comptes',
  'users.empty': 'Aucun compte',
  'users.column.username': 'Identifiant',
  'users.column.role': 'Rôle',
  'users.column.createdAt': 'Créé le',
  'users.column.lastLogin': 'Dernière connexion',
  'users.you': 'vous',
  'users.mustChangePassword': 'mot de passe à changer',
  'users.roleFor': 'Rôle de {name}',
  'users.resetPassword': 'Mot de passe',
  'users.createFailed': 'Création impossible.',
  'users.updateFailed': 'Modification impossible.',
  'users.deleteFailed': 'Suppression impossible.',
  'users.form.username': 'Identifiant',
  'users.form.password': 'Mot de passe',
  'users.form.passwordHint': '10 caractères minimum',
  'users.form.role': 'Rôle',
  'users.form.roleHint': 'Un lecteur consulte le dashboard mais ne modifie rien',
  'users.reset.title': 'Nouveau mot de passe pour « {name} »',
  'users.changeOwn.title': 'Changer mon mot de passe',
  'users.changeOwn.current': 'Mot de passe actuel',
  'users.changeOwn.new': 'Nouveau mot de passe',
  'users.changeOwn.submit': 'Changer',
  'users.changeOwn.done': 'Mot de passe modifié.',
}
