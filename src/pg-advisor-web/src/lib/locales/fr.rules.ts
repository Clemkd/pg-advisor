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
  'findings.viewerNotice':
    'Votre compte consulte les diagnostics sans agir dessus : ignorer, se dédire ou vérifier à la demande est réservé aux administrateurs.',
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

  // --- Garde-fou de coût ----------------------------------------------------
  // Une règle qui pèse sur la base observée est d'abord signalée, puis écartée de l'instance.
  // Les termes d'API — healthy, degraded, quarantined, timeout, error, slow — restent les clés :
  // seul l'affichage est traduit.
  'ruleHealth.state.healthy': 'saine',
  'ruleHealth.state.degraded': 'dégradée',
  'ruleHealth.state.quarantined': 'en quarantaine',
  'ruleHealth.kind.timeout': 'timeout',
  'ruleHealth.kind.error': 'erreur SQL',
  'ruleHealth.kind.slow': 'exécution trop lente',
  // La nature de l'incident ne conduit pas à la même conclusion : le délai dépassé et la lenteur
  // disent que l'instance souffre, l'erreur SQL que la règle est fautive.
  'ruleHealth.kindHint.timeout':
    'L’instance n’a pas rendu la main dans le timeout accordé : c’est elle qui souffre, pas la règle.',
  'ruleHealth.kindHint.error':
    'La requête de la règle a échoué : c’est la règle qu’il faut corriger, pas l’instance.',
  'ruleHealth.kindHint.slow':
    'La règle aboutit, mais coûte trop cher à l’instance pour être répétée à cette fréquence.',

  // --- Catalogue : état des règles ------------------------------------------
  // Libellés d'option du filtre d'état : un seul mot, la colonne est étroite et l'option
  // tronquée ne se distingue plus de sa voisine.
  'rules.degradedTag': 'dégradée',
  'rules.quarantinedTag': 'quarantaine',
  'rules.degradedOn.one': 'dégradée sur {count} instance',
  'rules.degradedOn.other': 'dégradée sur {count} instances',
  'rules.quarantinedOn.one': 'écartée de {count} instance',
  'rules.quarantinedOn.other': 'écartée de {count} instances',
  'rules.guard.quarantinedTitle.one': '{count} règle écartée par le garde-fou',
  'rules.guard.quarantinedTitle.other': '{count} règles écartées par le garde-fou',
  'rules.guard.quarantinedBody':
    'Leur diagnostic n’est plus produit sur les instances concernées : la catégorie cesse d’y être notée, et le score remonte sans qu’aucune base n’aille mieux.',
  'rules.guard.degradedTitle.one': '{count} règle signalée par le garde-fou',
  'rules.guard.degradedTitle.other': '{count} règles signalées par le garde-fou',
  'rules.guard.degradedBody':
    'Elles s’exécutent encore, mais accumulent des incidents : au seuil suivant, elles seront écartées de l’instance et leur diagnostic cessera.',
  'rules.guard.alsoDegraded.one': '{count} autre règle est signalée sans être écartée.',
  'rules.guard.alsoDegraded.other': '{count} autres règles sont signalées sans être écartées.',
  'rules.guard.show': 'Voir ces règles',
  'rules.live.degraded': 'Règle « {rule} » dégradée sur {instance}',
  'rules.live.quarantined': 'Règle « {rule} » écartée de {instance}',
  'rules.live.recovered': 'Règle « {rule} » rétablie sur {instance}',

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
  'ruleEditor.applicableTag': 'applicable',
  'ruleEditor.skippedTag': 'ignorée',
  // État du garde-fou, instance par instance. Une règle parfaitement applicable peut avoir été
  // écartée parce qu'elle coûtait trop cher : les deux se lisent sur la même ligne.
  'ruleEditor.degradedTag': 'dégradée',
  'ruleEditor.quarantinedTag': 'écartée',
  'ruleEditor.strikesLabel': 'Incidents',
  'ruleEditor.strikes.one': '{count} sur {max}',
  'ruleEditor.strikes.other': '{count} sur {max}',
  'ruleEditor.lastIncidentLabel': 'Dernier incident',
  'ruleEditor.durationLabel': 'Durée / timeout',
  'ruleEditor.durationTitle': '{observed} observées pour {timeout} accordées',
  'ruleEditor.quarantineUntilLabel': 'Écartée jusqu’au',
  'ruleEditor.reactivate': 'Réactiver',
  'ruleEditor.reactivateAll': 'Réactiver partout',
  'ruleEditor.reactivateTitle': 'Réactiver « {rule} » sur {instance} ?',
  'ruleEditor.reactivateAllTitle': 'Réactiver « {rule} » sur toutes les instances ?',
  // La confirmation dit ce qu'elle suppose, pas ce qu'elle fait : réactiver sans avoir traité la
  // cause fait simplement recommencer le décompte.
  'ruleEditor.reactivateBody':
    'Cette action suppose que la cause est traitée. Le décompte d’incidents repart de zéro et la règle est réexécutée au prochain cycle ; si la cause subsiste, elle sera écartée de nouveau.',
  'ruleEditor.reactivateConfirm': 'Réactiver la règle',
  'ruleEditor.reactivated': 'Règle réactivée sur {scope} : le décompte d’incidents repart de zéro.',
  'ruleEditor.reactivateFailed': 'Réactivation impossible.',
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

  // --- Éditeur de règle : instances et variables -----------------------------
  'ruleEditor.repairTitle': 'Corriger {file}',
  'ruleEditor.repairHint':
    'Ce fichier a été refusé au chargement : la règle n’est pas active. Corrigez-le ici, il sera rechargé à l’enregistrement.',
  'ruleEditor.variables': 'Application et variables',
  'ruleEditor.variablesHint':
    'Où la règle travaille, et avec quelles valeurs. Le reste — activation, sévérité, périodicité, timeout — s’écrit dans le YAML.',
  'ruleEditor.instances': 'Instances',
  'ruleEditor.allInstancesHint': 'valeurs par défaut',
  'ruleEditor.appliedHere': 'Appliquer la règle sur cette instance',
  'ruleEditor.variablesFor': 'Variables — {scope}',
  'ruleEditor.variableLegend':
    'La valeur en vigueur est à gauche ; à droite, celle qu’elle remplace, barrée.',
  'ruleEditor.noVariables': 'Cette règle n’expose aucune variable.',
  'ruleEditor.saveVariables': 'Enregistrer les variables',
  'ruleEditor.clearVariables': 'Revenir aux valeurs de la règle',
  'ruleEditor.changedLines.one': '{count} ligne modifiée',
  'ruleEditor.changedLines.other': '{count} lignes modifiées',
  'ruleEditor.allInstances': 'Toutes les instances',
  // Convention de lecture du tableau : sans elle, une valeur barrée se lit comme interdite.
  'ruleEditor.fromRule': 'règle',
  'ruleEditor.fromGlobal': 'globale',
  'ruleEditor.reset': 'Rétablir',
  'ruleEditor.resetTitle': 'Rétablir « {label} » à la valeur héritée',
  // « Timeout » et non « délai maximal » : c'est le mot du champ YAML, du garde-fou et des
  // journaux. Le traduire obligerait à retraduire mentalement à chaque aller-retour.
  'ruleEditor.overrideInterval': 'toutes les {seconds} s',
  'ruleEditor.overrideTimeout': 'timeout {seconds} s',
}
