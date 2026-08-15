/**
 * Catalogue français — queries. Fichier dédié à cette zone de l'interface : plusieurs chantiers
 * peuvent avancer en parallèle sans se disputer un catalogue unique.
 *
 * La zone couvre la vue des requêtes, sa modale d'analyse et le rendu du plan d'exécution. Les
 * clés sont préfixées par `queries.` pour la liste et l'analyse, `plan.` pour le plan lui-même —
 * un plan reste un plan, quelle que soit la vue qui l'affiche.
 */
export const frQueries: Record<string, string> = {
  // --- Requêtes : filtres et liste ------------------------------------------
  'queries.subtitle': 'Classement des requêtes d’une ou plusieurs instances, et analyse de leur plan à la demande.',
  'queries.filter.instances': 'Instances',
  'queries.filter.instancesHint': 'Classement fusionné',
  'queries.filter.instancesLabel': 'Instances à classer',
  'queries.filter.sort': 'Classer par',
  'queries.filter.sortHint': 'Critère appliqué côté serveur',
  'queries.filter.limit': 'Nombre de requêtes à lire',
  'queries.filter.limitHint': 'De 1 à 200',
  'queries.filter.advisor': 'Requêtes de l’Advisor',
  'queries.filter.advisorTitle':
    'Règles, collecteurs et analyses lancés par l’Advisor, reconnus au rôle qui les exécute',
  'queries.refresh': 'Actualiser',

  'queries.sort.total_time': 'Temps cumulé',
  'queries.sort.mean_time': 'Temps moyen',
  'queries.sort.calls': 'Nombre d’appels',
  'queries.sort.rows': 'Lignes retournées',
  'queries.sort.io': 'Blocs lus sur disque',
  'queries.sort.temp': 'Fichiers temporaires',

  'queries.list.title': 'Requêtes les plus coûteuses',
  'queries.list.merged': 'Classement fusionné de {count} instances ; la part est relative à la base d’origine.',
  'queries.list.single': 'Colonnes triables et filtrables ; la liste est virtualisée.',
  'queries.empty.title': 'Aucune requête à afficher',
  'queries.empty.extension':
    'Installez pg_stat_statements sur les instances signalées pour obtenir leur classement.',
  'queries.empty.statistics': 'Aucune requête enregistrée depuis la dernière remise à zéro des statistiques.',
  'queries.loadFailed': 'Chargement impossible.',

  // --- Requêtes : colonnes du tableau ---------------------------------------
  'queries.column.query': 'Requête',
  'queries.column.share': 'Part',
  'queries.column.total': 'Cumulé',
  'queries.column.mean': 'Moyen',
  'queries.column.max': 'Max',
  'queries.column.calls': 'Appels',
  'queries.column.rowsPerCall': 'Lignes/appel',
  'queries.column.cache': 'Cache',
  'queries.column.temp': 'Temp.',
  'queries.unit.blocks': 'blocs',
  'queries.filterPlaceholder': 'filtrer…',
  'queries.clearFilters': 'Effacer',
  'queries.rowTitle': 'Ouvrir l’analyse de cette requête',
  'queries.badge.advisor': 'Advisor',
  'queries.badge.parameterized': 'paramétrée',
  'queries.badge.tempFiles': 'fichiers temporaires',
  'queries.badge.savedPlan': 'plan enregistré',
  'queries.badge.savedPlanTitle': 'Un plan mesuré est conservé : il s’affiche sans réexécuter la requête.',
  'queries.footer.shown.one': '{count} requête affichée',
  'queries.footer.shown.other': '{count} requêtes affichées',
  'queries.footer.read.one': 'sur {count} lue',
  'queries.footer.read.other': 'sur {count} lues',
  'queries.footer.hint': 'une ligne ouvre son analyse',

  // --- Analyse : modale -----------------------------------------------------
  'queries.modal.title': 'Analyse de la requête',
  'queries.modal.readOnly':
    'La requête est exécutée une fois, en lecture seule et dans une transaction annulée : les temps sont mesurés, jamais estimés.',
  'queries.modal.measure': 'Mesurer le plan',
  'queries.modal.remeasure': 'Remesurer',
  'queries.modal.sqlTitle': 'Requête analysée',
  'queries.modal.loading': 'Analyse en cours…',
  'queries.modal.reading': 'Lecture du plan conservé…',

  // Panneaux superposés au diagramme : libellés courts, l'en-tête de la modale les aligne.
  'queries.panel.sql': 'SQL',
  'queries.panel.parameters': 'Paramètres',
  'queries.panel.notes': 'Remarques',
  'queries.panel.notesTitle': 'Remarques sur cette mesure',

  'queries.plan.measured': 'Plan mesuré {when}',
  'queries.plan.measuredOn': 'Mesuré le {date}',
  'queries.plan.duration': 'mesure en {duration}',
  'queries.plan.stored': 'plan conservé',
  'queries.plan.storedTitle':
    'Ce plan vient de la base de l’Advisor : l’ouvrir n’a rien exécuté sur l’instance supervisée.',
  'queries.plan.justMeasured': 'mesuré à l’instant',
  'queries.plan.parameters': 'Valeurs utilisées',
  'queries.plan.stale':
    'Les valeurs saisies diffèrent de celles qui ont produit ce plan : remesurez pour les prendre en compte.',

  'queries.empty.plan.title': 'Aucun plan enregistré pour cette requête',
  'queries.empty.plan.body':
    'Aucune mesure n’a encore été conservée pour cette requête sur cette instance. Le plan obtenu sera enregistré et relu tel quel aux ouvertures suivantes.',

  // --- Analyse : paramètres -------------------------------------------------
  'queries.params.title': 'Valeurs des paramètres',
  'queries.params.description':
    'Le texte est normalisé par pg_stat_statements : ses valeurs ont été remplacées par $1, $2… Le plan dépend des valeurs fournies.',
  'queries.params.suggest': 'Proposer des valeurs',
  'queries.params.source.statistics': 'valeur la plus fréquente',
  'queries.params.source.sample': 'valeur existante',
  'queries.params.suggestFailed': 'Aucune valeur n’a pu être proposée.',

  'queries.error.title': 'Analyse impossible',
  'queries.error.failed': 'L’analyse a échoué.',

  // Remarques de l'API, traduites par leur code ; le message anglais reste le repli.
  'queries.note.explain-prefix-removed': 'Le préfixe EXPLAIN a été retiré de la requête avant l’analyse.',
  'queries.note.parameters-substituted.one':
    '{count} paramètre a été remplacé par la valeur fournie : le plan dépend de cette valeur.',
  'queries.note.parameters-substituted.other':
    '{count} paramètres ont été remplacés par les valeurs fournies : le plan dépend de ces valeurs.',
  'queries.note.plan-not-parsed': 'Le plan JSON n’a pas pu être structuré ; seule la vue texte est disponible.',

  // --- Plan : cadre général -------------------------------------------------
  'plan.viewLabel': 'Vue du plan',
  'plan.view.graph': 'Diagramme',
  'plan.view.graphHint': 'Arbre d’exécution, carte par étape',
  'plan.view.text': 'Texte',
  'plan.view.textHint': 'Sortie brute d’EXPLAIN',
  'plan.view.table': 'Tableaux',
  'plan.view.tableHint': 'Nœuds en grille, triables',

  // Les compteurs du plan gardent le nom qu'EXPLAIN leur donne, en anglais dans les deux
  // langues : c'est sous ce nom qu'on les retrouve dans psql et dans la documentation de
  // PostgreSQL. Seuls les libellés d'interface et les explications sont traduits.
  'plan.total.execution': 'Execution Time',
  'plan.total.planning': 'Planning Time',
  'plan.total.cost': 'Total Cost',
  'plan.total.nodes': 'Nœuds',

  'plan.highlight': 'Mettre en évidence',
  'plan.metric.self': 'Self Time',
  'plan.metric.inclusive': 'Actual Total Time',
  'plan.metric.cost': 'Self Cost',
  'plan.metric.rows': 'Actual Rows',
  'plan.metric.none': 'Aucune',

  'plan.culprit.slowest': 'le plus lent',
  'plan.culprit.largest': 'le plus gros',
  'plan.culprit.costliest': 'le plus coûteux',
  'plan.rows.one': '{count} ligne',
  'plan.rows.other': '{count} lignes',

  'plan.expandAll': 'Tout déplier',
  'plan.collapseAll': 'Tout replier',
  'plan.zoomOut': 'Dézoomer',
  'plan.zoomIn': 'Zoomer',
  'plan.fit': 'Ajuster à la fenêtre (touche 0)',
  'plan.canvasLabel': 'Diagramme du plan : glisser pour déplacer, molette pour zoomer',
  'plan.unstructured': 'Le plan n’a pas pu être structuré ; utilisez la vue texte.',

  // Légende tenue sur une ligne : chaque ligne prise ici est prise au diagramme.
  'plan.legend.flow': 'Les données remontent des feuilles vers la racine ; l’épaisseur d’un lien dit les lignes remontées.',
  'plan.legend.heat': 'Pastille :',
  'plan.legend.notable': 'notable',
  'plan.legend.heavy': 'lourd',
  'plan.legend.dominant': 'dominant',
  'plan.legend.controls': 'Glisser déplace, la molette zoome au curseur, la touche 0 réajuste.',

  // --- Plan : carte d'un nœud -----------------------------------------------
  'plan.node.heatTitle': 'Poids de cette étape pour la métrique mise en évidence : {level}',
  'plan.node.heat.0': 'anodin',
  'plan.node.heat.1': 'notable',
  'plan.node.heat.2': 'lourd',
  'plan.node.heat.3': 'dominant',
  'plan.node.neverExecuted': 'jamais exécuté',
  'plan.node.neverExecutedTitle': 'Branche non atteinte à l’exécution',
  'plan.node.selfTitle': 'Self Time — temps propre à l’étape, hors sous-arbre',
  'plan.node.rowsTitle': 'Actual Rows — lignes remontées, boucles comprises',
  'plan.node.underestimated': 'Lignes sous-estimées par le planificateur',
  'plan.node.overestimated': 'Lignes surestimées par le planificateur',
  'plan.node.costTitle': 'Self Cost — coût propre à l’étape, enfants déduits ; Total Cost {total}',
  'plan.node.parallel': 'parallèle',
  'plan.node.parallelTitle': 'Parcours parallèle',
  'plan.node.parallelWorkers': 'Parcours parallèle : {count} processus',
  'plan.node.foldBranch': 'Replier cette branche',
  'plan.node.unfoldBranch': 'Déplier cette branche',

  'plan.warning.seq-scan': 'parcours complet',
  'plan.warning.bad-estimate': 'estimation fausse',
  'plan.warning.hotspot': 'temps concentré',
  'plan.warning.sort-on-disk': 'tri sur disque',
  'plan.warning.temp-blocks': 'fichiers temporaires',
  'plan.warning.many-loops': 'boucles nombreuses',
  'plan.warning.heap-fetches': 'accès au heap',

  // --- Plan : détail d'une étape --------------------------------------------
  'plan.tab.general': 'Général',
  'plan.tab.io': 'E/S & tampons',
  'plan.tab.output': 'Sortie',
  'plan.tab.workers': 'Parallélisme',
  'plan.tab.misc': 'Divers',
  'plan.detail.empty': 'Rien à afficher pour cette étape.',

  // Champs d'un nœud : le nom de la sortie d'EXPLAIN, en anglais dans les deux langues. Un
  // lecteur qui cherche « Rows Removed by Filter » dans la documentation doit lire ici le même
  // mot que là-bas. Restent traduits les seuls libellés que PostgreSQL n'émet pas.
  'plan.field.selfMs': 'Self Time',
  'plan.field.inclusiveMs': 'Actual Total Time',
  'plan.field.actualRows': 'Actual Rows',
  'plan.field.planRows': 'Plan Rows',
  'plan.field.estimation': 'Écart d’estimation',
  'plan.field.loops': 'Loops',
  'plan.field.startupCost': 'Startup Cost',
  'plan.field.totalCost': 'Total Cost',
  'plan.field.width': 'Plan Width',
  'plan.field.sharedHit': 'Shared Hit Blocks',
  'plan.field.sharedRead': 'Shared Read Blocks',
  'plan.field.sharedDirtied': 'Shared Dirtied Blocks',
  'plan.field.sharedWritten': 'Shared Written Blocks',
  'plan.field.tempRead': 'Temp Read Blocks',
  'plan.field.tempWritten': 'Temp Written Blocks',
  'plan.field.heapFetches': 'Heap Fetches',
  'plan.field.sortMethod': 'Sort Method',
  'plan.field.sortSpace': 'Sort Space Used',
  'plan.field.rowsRemoved': 'Rows Removed by Filter',
  'plan.field.indexCondition': 'Index Cond',
  'plan.field.filter': 'Filter',
  'plan.field.recheck': 'Recheck Cond',
  'plan.field.hashCondition': 'Hash Cond',
  'plan.field.joinFilter': 'Join Filter',
  'plan.field.sortKey': 'Sort Key',
  'plan.field.groupKey': 'Group Key',
  'plan.field.parallelAware': 'Parallel Aware',
  'plan.field.workersPlanned': 'Workers Planned',
  'plan.field.workersLaunched': 'Workers Launched',
  'plan.field.nodeType': 'Node Type',
  'plan.field.subplan': 'Subplan Name',
  'plan.field.relation': 'Relation Name',
  'plan.field.alias': 'Alias',
  'plan.field.index': 'Index Name',
  'plan.field.joinType': 'Join Type',
  'plan.field.scanDirection': 'Scan Direction',
  'plan.field.parentRelationship': 'Parent Relationship',
  'plan.field.costShare': 'Part du coût',
  'plan.field.execution': 'Exécution',
  'plan.value.skipped': 'branche jamais atteinte',
  'plan.value.none': 'aucun',

  'plan.estimation.exact': 'juste',
  'plan.estimation.more': '×{factor} de plus',
  'plan.estimation.less': '×{factor} de moins',
  'plan.unit.blocks': '{count} blocs',
  'plan.unit.blocksWithSize': '{count} blocs ({size} Mio)',
  'plan.unit.sortSpace': '{size} kio ({type})',
  'plan.unit.bytes': '{count} o',

  // --- Plan : vues texte et tableaux ----------------------------------------
  'plan.text.title': 'Plan d’exécution (EXPLAIN, format texte)',
  'plan.json.title': 'Plan brut (format JSON)',
  'plan.table.title': 'Nœuds du plan',
  'plan.table.sortBy': 'Trier par',
  'plan.table.column.node': 'Nœud',
  'plan.table.column.cost': 'Total Cost',
  'plan.table.column.self': 'Self Time',
  'plan.table.column.inclusive': 'Actual Total Time',
  'plan.table.column.rows': 'Actual Rows',
  'plan.table.column.estimation': 'Estimation',
  'plan.table.column.reads': 'Shared Read Blocks',
  'plan.relations.title': 'Cumul par relation',
  'plan.relations.column.relation': 'Relation',
  'plan.relations.column.nodes': 'Nœuds',
  'plan.settings.title': 'Paramètres non standard actifs à la planification',

  // --- Plan : ce que fait chaque type de nœud -------------------------------
  'plan.describe.default': 'Étape d’exécution du plan.',
  'plan.describe.Aggregate': 'Regroupe les lignes et calcule les agrégats (count, sum, avg…).',
  'plan.describe.Append': 'Concatène les résultats de plusieurs sous-plans, sans les trier.',
  'plan.describe.Bitmap Heap Scan':
    'Relit la table aux emplacements désignés par un index, dans l’ordre des blocs.',
  'plan.describe.Bitmap Index Scan': 'Parcourt un index pour construire la carte des blocs à relire.',
  'plan.describe.CTE Scan': 'Lit le résultat matérialisé d’une expression WITH.',
  'plan.describe.Function Scan': 'Lit les lignes produites par une fonction.',
  'plan.describe.Gather': 'Rassemble les lignes des processus parallèles, sans ordre garanti.',
  'plan.describe.Gather Merge': 'Rassemble les lignes des processus parallèles en conservant leur tri.',
  'plan.describe.Group': 'Regroupe une entrée déjà triée par la clé de regroupement.',
  'plan.describe.GroupAggregate':
    'Calcule les agrégats sur une entrée déjà triée par la clé de regroupement.',
  'plan.describe.Hash': 'Charge son entrée dans une table de hachage, pour la jointure située au-dessus.',
  'plan.describe.HashAggregate':
    'Regroupe les lignes par clé dans une table de hachage, puis calcule les agrégats.',
  'plan.describe.Hash Join':
    'Joint deux ensembles en sondant la table de hachage construite sur le plus petit.',
  'plan.describe.Incremental Sort': 'Trie par paquets, en profitant d’un tri partiel déjà présent.',
  'plan.describe.Index Only Scan':
    'Lit l’index seul, sans toucher la table quand la carte de visibilité le permet.',
  'plan.describe.Index Scan': 'Parcourt l’index, puis lit dans la table les lignes correspondantes.',
  'plan.describe.Limit': 'Ne remonte que le nombre de lignes demandé, puis interrompt son entrée.',
  'plan.describe.LockRows': 'Pose les verrous demandés par FOR UPDATE / FOR SHARE sur les lignes remontées.',
  'plan.describe.Materialize': 'Conserve son entrée en mémoire pour pouvoir la relire plusieurs fois.',
  'plan.describe.Memoize': 'Met en cache les résultats de la boucle interne pour les clés déjà rencontrées.',
  'plan.describe.Merge Append': 'Concatène plusieurs sous-plans déjà triés en conservant l’ordre.',
  'plan.describe.Merge Join': 'Joint deux entrées triées en les parcourant de front.',
  'plan.describe.ModifyTable': 'Applique les INSERT, UPDATE ou DELETE aux lignes reçues.',
  'plan.describe.Nested Loop': 'Pour chaque ligne de l’entrée externe, parcourt l’entrée interne.',
  'plan.describe.ProjectSet': 'Développe les fonctions qui retournent plusieurs lignes.',
  'plan.describe.Recursive Union': 'Enchaîne le terme initial et le terme récursif d’un WITH RECURSIVE.',
  'plan.describe.Result': 'Évalue une expression sans lire de table, ou filtre sur une condition constante.',
  'plan.describe.Sample Scan': 'Lit un échantillon de la table (TABLESAMPLE).',
  'plan.describe.Seq Scan': 'Lit la table entière, bloc par bloc, sans passer par un index.',
  'plan.describe.SetOp': 'Applique INTERSECT ou EXCEPT à deux entrées triées.',
  'plan.describe.Sort': 'Trie son entrée ; au-delà de work_mem, le tri déborde sur disque.',
  'plan.describe.Subquery Scan': 'Lit le résultat d’une sous-requête.',
  'plan.describe.Tid Scan': 'Lit directement les lignes désignées par leur ctid.',
  'plan.describe.Unique': 'Élimine les doublons consécutifs d’une entrée triée.',
  'plan.describe.Values Scan': 'Lit les lignes littérales d’une clause VALUES.',
  'plan.describe.WindowAgg': 'Calcule les fonctions de fenêtrage sur une entrée triée par partition.',
}
