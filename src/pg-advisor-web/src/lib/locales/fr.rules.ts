/**
 * Catalogue français — rules. Fichier dédié à cette zone de l'interface : plusieurs chantiers
 * peuvent avancer en parallèle sans se disputer un catalogue unique.
 *
 * La zone couvre les deux vues du travail quotidien sur les diagnostics : la liste des
 * diagnostics avec son détail, et l'éditeur d'une règle avec son exécution à blanc. Les
 * clés sont préfixées par la vue, puis par le bloc où elles servent — `detail`, `action`,
 * `empty`, `notice`.
 *
 * Vocabulaire : un diagnostic est un fait constaté sur une instance, pas une tâche à cocher. Il
 * naît et meurt avec le fait ; l'utilisateur ne le résout pas, il peut seulement décider que le
 * constat ne l'intéresse pas. Aucun libellé ne doit laisser croire l'inverse.
 */
export const frRules: Record<string, string> = {
  // --- Diagnostics : en-tête et onglets -------------------------------------
  // Le descriptif tient sur la ligne du titre : sur une vue lue tous les jours, un en-tête de
  // trois lignes vole un tiers de l'écran utile.
  'findings.subtitle': 'Faits constatés sur vos instances. L’Advisor n’exécute jamais de commande.',
  'findings.statusTabs': 'Statut',
  'findings.tab.active': 'Actifs',
  'findings.tab.ignored': 'Ignorés',
  'findings.tab.resolved': 'Résolus',
  'findings.tab.all': 'Tous',
  'findings.count.one': '{count} diagnostic',
  'findings.count.other': '{count} diagnostics',
  'findings.limited': '{count} premiers seulement',

  // --- Diagnostics : point d'entrée -----------------------------------------
  'findings.hero.pending.one': 'sur {count} diagnostic actif',
  'findings.hero.pending.other': 'sur {count} diagnostics actifs',
  'findings.hero.warnings.one': '{count} avertissement',
  'findings.hero.warnings.other': '{count} avertissements',
  'findings.hero.infos.one': '{count} information',
  'findings.hero.infos.other': '{count} informations',
  'findings.hero.showCritical': 'Voir les critiques',

  // --- Diagnostics : colonnes et filtres -------------------------------------
  // Filtre et tri vivent dans l'en-tête de la colonne qu'ils gouvernent : le libellé de colonne
  // sert donc aussi de nom au contrôle.
  'findings.column.diagnostic': 'Diagnostic',
  'findings.column.detected': 'Détecté',
  'findings.rowTitle': 'Ouvrir le détail',
  'findings.searchPlaceholder': 'titre, objet, règle',
  'findings.unit.severity': 'sévérité',
  'findings.unit.severities': 'sévérités',
  'findings.unit.instance': 'instance',
  'findings.unit.instances': 'instances',
  'findings.unit.category': 'catégorie',
  'findings.unit.categories': 'catégories',

  // --- Diagnostics : temps réel ---------------------------------------------
  'findings.live.new.one': '{count} nouveau diagnostic',
  'findings.live.new.other': '{count} nouveaux diagnostics',
  'findings.live.newCritical.one': '{count} nouveau diagnostic critique',
  'findings.live.newCritical.other': '{count} nouveaux diagnostics critiques',

  // --- Diagnostics : messages -----------------------------------------------
  'findings.ignoredNotice':
    'Un diagnostic ignoré n’est plus notifié et ne pèse plus sur le score de santé. Il continue d’être rafraîchi : « Reconsidérer » le remet parmi les diagnostics actifs.',
  'findings.resolvedNotice':
    'Un diagnostic est résolu par le moteur lorsque le fait constaté a disparu de l’instance, à la prochaine exécution de la règle ou à la vérification. Personne ne le coche à la main.',
  'findings.statusFailed': 'Changement de statut impossible.',
  'findings.verifyFailed': 'Vérification impossible.',
  'findings.notice.ignored': '« {title} » est désormais ignoré.',
  'findings.notice.reconsidered': '« {title} » revient parmi les diagnostics actifs.',

  // --- Diagnostics : liste vide ---------------------------------------------
  // Un état vide filtré n'est pas un état vide initial : le premier propose d'effacer les
  // filtres, le second dit ce que l'absence signifie.
  'findings.empty.title': 'Aucun diagnostic',
  'findings.empty.active': 'Rien de constaté sur les instances supervisées.',
  'findings.empty.ignored':
    'Aucun diagnostic ignoré. Le menu d’une ligne active permet de l’y ranger.',
  'findings.empty.other': 'Essayez un autre statut.',
  'findings.empty.filtered': 'Aucun diagnostic pour ces filtres',
  'findings.empty.filteredHint': 'Le périmètre choisi ne renvoie rien : élargissez-le.',

  // --- Diagnostics : ligne de liste -----------------------------------------
  'findings.occurrences.one': '{count} occurrence',
  'findings.occurrences.other': '{count} occurrences',
  'findings.durationMs': '{ms} ms',

  // --- Diagnostics : actions ------------------------------------------------
  // Deux gestes, et deux seulement : décider que le constat n'intéresse pas, et se dédire. Clore
  // un diagnostic n'appartient qu'au moteur.
  'findings.action.ignore': 'Ignorer',
  'findings.action.reconsider': 'Reconsidérer',
  'findings.action.verify': 'Vérifier',
  'findings.action.verifyHint':
    'Rejoue la règle sur l’instance : le moteur clôt le diagnostic si le fait a disparu.',

  // --- Diagnostics : détail -------------------------------------------------
  'findings.detail.fallbackTitle': 'Diagnostic',
  'findings.detail.resolutionHint':
    'Ce constat disparaît de lui-même quand le fait qui l’a produit disparaît : c’est le moteur qui le clôt, à la prochaine exécution de la règle ou à la vérification.',
  'findings.detail.impact': 'Impact estimé',
  'findings.detail.confidence': 'Confiance',
  'findings.detail.occurrences': 'Occurrences',
  'findings.detail.lastSeen': 'Vu pour la dernière fois',
  'findings.detail.detectedAt': 'Détecté le',
  'findings.detail.resolvedAt': 'Résolu le',
  'findings.detail.rule': 'Règle déclenchante',
  'findings.detail.ruleVersion': 'version {version}',
  'findings.detail.ruleMissing':
    'Cette règle n’est plus chargée : ce diagnostic ne sera plus rafraîchi.',
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

  // --- Catalogue des règles -------------------------------------------------
  // Vue rare, consultée à l'installation puis à l'occasion : elle s'explique au lieu de se
  // compacter. Les clés historiques `rules.*` vivent dans le catalogue général ; celles-ci
  // complètent la reprise de la vue.
  'rules.new': 'Nouvelle règle',
  'rules.catalog': 'Catalogue',
  'rules.failing.one': '{count} règle en erreur',
  'rules.failing.other': '{count} règles en erreur',
  // Unités du résumé d'une sélection multiple : « 2 catégories » plutôt qu'une énumération.
  'rules.unit.category': 'catégorie',
  'rules.unit.categories': 'catégories',
  'rules.unit.severity': 'sévérité',
  'rules.unit.severities': 'sévérités',
  'rules.unit.origin': 'origine',
  'rules.unit.origins': 'origines',
  'rules.unit.state': 'état',
  'rules.unit.states': 'états',
  'rules.empty.title': 'Aucune règle chargée',
  'rules.empty.hint':
    'Les règles livrées avec l’application sont lues au démarrage. Une règle écrite ici s’ajoute à elles et se recharge à chaud.',
  'rules.noMatchHint': 'Aucune règle du catalogue ne répond à ces critères. Levez un filtre pour en revoir.',
  'rules.live.reloaded': 'Règles rechargées',

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
  'ruleEditor.deleteTitle': 'Supprimer la règle « {id} » ?',
  'ruleEditor.deleteBody':
    'La définition écrite dans le volume de données est effacée. Si elle remplaçait une règle intégrée, celle-ci reprend sa place au prochain rechargement.',
  'ruleEditor.deleteConfirm': 'Supprimer la règle',

  // --- Éditeur de règle : définition YAML -----------------------------------
  'ruleEditor.yamlTitle': 'Définition YAML',
  'ruleEditor.yamlLabel': 'Définition YAML de la règle',
  'ruleEditor.validTag': 'valide',
  'ruleEditor.errorCount.one': '{count} erreur',
  'ruleEditor.errorCount.other': '{count} erreurs',
  'ruleEditor.unsavedTag': 'non enregistrée',
  'ruleEditor.unsavedTitle': 'Modifications non enregistrées.',
  'ruleEditor.invalidTitle': 'La règle n’est pas valide',
  // Une erreur de validation se pose au plus près de la ligne fautive : elle la nomme, la teinte
  // dans l'éditeur, et y conduit d'un clic.
  'ruleEditor.line': 'ligne {line}',
  'ruleEditor.goToLine': 'Aller à la ligne {line}',

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
  'ruleEditor.applicabilityHint': 'où cette règle s’exécutera, en l’état des instances connues',
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
  'ruleEditor.scopeHint': 'une instance, ou toutes',
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
