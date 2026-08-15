/**
 * Catalogue français — rules. Fichier dédié à cette zone de l'interface : plusieurs chantiers
 * peuvent avancer en parallèle sans se disputer un catalogue unique.
 *
 * La zone couvre les deux vues du travail quotidien sur les diagnostics : la liste des
 * recommandations avec son détail, et l'éditeur d'une règle avec son exécution à blanc. Les
 * clés sont préfixées par la vue, puis par le bloc où elles servent — `detail`, `action`,
 * `empty`, `notice`.
 */
export const frRules: Record<string, string> = {
  // --- Recommandations : en-tête et onglets ---------------------------------
  'findings.subtitle':
    'Chaque diagnostic indique la règle qui l’a produit, ses preuves et la commande corrective — jamais exécutée automatiquement.',
  'findings.statusTabs': 'Statut',
  'findings.tab.active': 'À traiter',
  'findings.tab.ignored': 'Ignorées',
  'findings.tab.resolved': 'Résolues',
  'findings.tab.all': 'Toutes',
  'findings.count.one': '{count} recommandation',
  'findings.count.other': '{count} recommandations',
  'findings.virtualized': 'liste virtualisée',
  'findings.limited': 'affichage limité aux {count} premières : affinez les filtres',

  // --- Recommandations : filtres --------------------------------------------
  'findings.searchPlaceholder': 'titre, objet, règle',
  'findings.searchHint': 'Entrée pour valider',

  // --- Recommandations : messages -------------------------------------------
  'findings.ignoredNotice':
    'Une recommandation ignorée n’est plus notifiée et ne pèse plus sur le score de santé. Elle continue d’être rafraîchie : « Ne plus ignorer » la remet dans la liste à traiter.',
  'findings.statusFailed': 'Changement de statut impossible.',
  'findings.verifyFailed': 'Vérification impossible.',
  'findings.notice.resolved': '« {title} » marquée résolue.',
  'findings.notice.ignored': '« {title} » est désormais ignorée.',
  'findings.notice.reactivated': '« {title} » revient à traiter.',

  // --- Recommandations : liste vide -----------------------------------------
  'findings.empty.title': 'Aucune recommandation pour ces filtres',
  'findings.empty.active': 'Aucun diagnostic à traiter sur le périmètre sélectionné.',
  'findings.empty.ignored':
    'Aucune recommandation ignorée. Le menu d’une ligne à traiter permet de l’y ranger.',
  'findings.empty.other': 'Essayez un autre statut ou élargissez les filtres.',

  // --- Recommandations : ligne de liste --------------------------------------
  'findings.detected': 'détecté {when}',
  'findings.occurrences.one': '{count} occurrence',
  'findings.occurrences.other': '{count} occurrences',
  'findings.durationMs': '{ms} ms',

  // --- Recommandations : actions --------------------------------------------
  'findings.action.resolve': 'Marquer résolue',
  'findings.action.ignore': 'Ignorer',
  'findings.action.ignoreHint': 'Sort de la liste à traiter, sans notification ni impact sur le score.',
  'findings.action.unignore': 'Ne plus ignorer',
  'findings.action.reactivate': 'Réactiver',
  'findings.action.verify': 'Vérifier',
  'findings.action.verifyHint': 'Rejoue la règle sur l’instance et résout si le problème a disparu.',

  // --- Recommandations : détail ---------------------------------------------
  'findings.detail.fallbackTitle': 'Recommandation',
  'findings.detail.diagnosis': 'Diagnostic',
  'findings.detail.impact': 'Impact estimé',
  'findings.detail.confidence': 'Confiance',
  'findings.detail.occurrences': 'Occurrences',
  'findings.detail.lastSeen': 'Vue pour la dernière fois',
  'findings.detail.detectedAt': 'Détecté le',
  'findings.detail.resolvedAt': 'Résolu le',
  'findings.detail.rule': 'Règle déclenchante',
  'findings.detail.ruleVersion': 'version {version}',
  'findings.detail.ruleMissing': 'Cette règle n’est plus chargée : le finding ne sera plus rafraîchi.',
  'findings.detail.evidence': 'Preuves collectées',
  'findings.detail.remediation': 'Commande corrective proposée',
  'findings.detail.remediationHint':
    'à exécuter manuellement : l’Advisor ne lance jamais cette commande, sa session de supervision est en lecture seule.',
  'findings.detail.documentation': 'Documentation PostgreSQL',
  'findings.detail.history': 'Historique',
  'findings.detail.notifications': 'Notifications envoyées',
  'findings.detail.sent': 'envoyée',
  'findings.detail.failed': 'échec {status}',
  'findings.detail.actor': 'par {actor}',

  // --- Éditeur de règle : en-tête -------------------------------------------
  'ruleEditor.newTitle': 'Nouvelle règle',
  'ruleEditor.group': 'groupe {group}',
  'ruleEditor.version': 'version {version}',
  'ruleEditor.providedTitle': 'Règle intégrée à l’application',
  'ruleEditor.providedBody':
    'L’enregistrement ne modifie pas le fichier livré : il crée une version personnalisée dans le volume de données qui la remplace. Supprimer cette version rétablira la règle d’origine.',
  'ruleEditor.saved': 'Règle « {id} » enregistrée et rechargée.',
  'ruleEditor.saveFailed': 'Enregistrement impossible.',
  'ruleEditor.deleteFailed': 'Suppression impossible.',

  // --- Éditeur de règle : définition YAML -----------------------------------
  'ruleEditor.yamlTitle': 'Définition YAML',
  'ruleEditor.yamlLabel': 'Définition YAML de la règle',
  'ruleEditor.validTag': 'valide',
  'ruleEditor.errorCount.one': '{count} erreur',
  'ruleEditor.errorCount.other': '{count} erreurs',
  'ruleEditor.unsavedTag': 'non enregistrée',
  'ruleEditor.unsavedTitle': 'Modifications non enregistrées.',
  'ruleEditor.invalidTitle': 'La règle n’est pas valide',

  // --- Éditeur de règle : exécution à blanc ---------------------------------
  'ruleEditor.dryRunTitle': 'Aperçu sur une instance',
  'ruleEditor.dryRunHint':
    'Exécution en lecture seule sur l’instance choisie, sans enregistrer la règle ni créer de finding.',
  'ruleEditor.dryRunTarget': 'Instance cible',
  'ruleEditor.dryRunRun': 'Exécuter à blanc',
  'ruleEditor.dryRunFailed': 'Aperçu impossible.',
  'ruleEditor.dryRunPending': 'Aucune exécution pour l’instant',
  'ruleEditor.dryRunPendingHint':
    'Le résultat s’affiche ici, en face de la définition : lignes retournées, findings produits et sortie SQL brute.',
  'ruleEditor.dryRunErrorTitle': 'Exécution en échec',
  'ruleEditor.dryRunSkippedTitle': 'Règle non applicable',
  'ruleEditor.dryRunRows.one': '{count} ligne retournée',
  'ruleEditor.dryRunRows.other': '{count} lignes retournées',
  'ruleEditor.dryRunFindings.one': '{count} finding produit',
  'ruleEditor.dryRunFindings.other': '{count} findings produits',
  'ruleEditor.dryRunSummary': '{rows} en {ms} ms — {findings}',
  'ruleEditor.dryRunFindingsTitle': 'Findings produits',
  'ruleEditor.dryRunSqlTitle': 'Résultat SQL',
  'ruleEditor.noInstance': 'Aucune instance à interroger',
  'ruleEditor.noInstanceBody': 'Ajoutez une connexion PostgreSQL pour exécuter une règle à blanc.',
  'ruleEditor.addInstance': 'Ajouter une instance',

  // --- Éditeur de règle : applicabilité et aide-mémoire ---------------------
  'ruleEditor.applicability': 'Applicabilité',
  'ruleEditor.applicableTag': 'applicable',
  'ruleEditor.skippedTag': 'ignorée',
  'ruleEditor.help': 'Aide-mémoire',
  'ruleEditor.helpShow': 'Afficher',
  'ruleEditor.helpHide': 'Réduire',
  'ruleEditor.helpSummary':
    'Catégories, groupes, filtres, fonctions de condition et handlers internes.',
  'ruleEditor.helpCategories': 'Catégories',
  'ruleEditor.helpGroups': 'Groupes de périodicité',
  'ruleEditor.helpFilters': 'Filtres de message',
  'ruleEditor.helpFunctions': 'Fonctions de condition',
  'ruleEditor.helpExtensions': 'Extensions reconnues',
  'ruleEditor.helpHandlers': 'Handlers internes',

  // --- Éditeur de règle : surcharges ----------------------------------------
  'ruleEditor.overrides': 'Surcharges',
  'ruleEditor.overridesHint':
    'Une surcharge n’écrit pas dans le fichier : elle ajuste l’activation, la sévérité, la périodicité ou les seuils, globalement ou pour une seule instance.',
  'ruleEditor.scope': 'Portée',
  'ruleEditor.allInstances': 'Toutes les instances',
  'ruleEditor.activation': 'Activation',
  'ruleEditor.ruleValue': 'Valeur de la règle ({value})',
  'ruleEditor.enabledOption': 'Activée',
  'ruleEditor.disabledOption': 'Désactivée',
  'ruleEditor.interval': 'Périodicité (s)',
  'ruleEditor.intervalHint': 'vide = celle du groupe',
  'ruleEditor.thresholds': 'Seuils',
  'ruleEditor.thresholdDefault': 'défaut : {value}',
  'ruleEditor.saveOverride': 'Enregistrer la surcharge',
  'ruleEditor.deleteOverride': 'Supprimer cette surcharge',
  'ruleEditor.savedOverrides': 'Surcharges enregistrées',
  'ruleEditor.editOverride': 'Modifier la surcharge de « {scope} »',
  'ruleEditor.overrideSeverity': 'sévérité {severity}',
  'ruleEditor.overrideInterval': 'toutes les {seconds} s',
}
