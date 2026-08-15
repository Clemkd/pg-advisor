export type Severity = 'info' | 'warning' | 'critical'
export type FindingStatus = 'active' | 'resolved' | 'ignored'
export type Role = 'Admin' | 'Viewer'

export interface CurrentUser {
  id: number
  username: string
  role: Role
  mustChangePassword: boolean
}

export interface HealthScore {
  global: number
  categories: Record<string, number>
  critical: number
  warning: number
  info: number
  /** Somme des trois compteurs, calculée côté serveur. */
  total: number
  computedAt: string
}

export interface InstanceMetrics {
  collectedAt: string
  connections: number
  maxConnections: number
  reservedConnections: number
  activeQueries: number
  idleInTransaction: number
  waitingSessions: number
  blockedSessions: number
  longestTransactionSeconds: number
  longestQuerySeconds: number
  databaseSizeBytes: number
  cacheHitRatio: number | null
  commits: number
  rollbacks: number
  deadlocks: number
  tempBytes: number
  connectionUsage: number
}

export type CollectionState =
  | 'unknown'
  | 'collecting'
  | 'analyzing'
  | 'idle'
  | 'error'
  | 'disabled'

export interface Connection {
  id: number
  name: string
  host: string
  port: number
  database: string
  username: string
  sslMode: string
  collectionIntervalSeconds: number
  enabled: boolean
  createdAt: string
  lastCollectedAt: string | null
  lastError: string | null
  serverVersion: string | null
  timescaleVersion: string | null
  collectionState: CollectionState
  analysisProgress: number | null
  health: HealthScore | null
  metrics: InstanceMetrics | null

  /**
   * Règles écartées de cette instance par le garde-fou de coût. Leur catégorie n'est plus notée :
   * un score qui remonte doit pouvoir s'expliquer par cette liste plutôt que par une embellie.
   *
   * Facultatif : une API antérieure au garde-fou ne renvoie pas ce champ, et le tableau de bord
   * ne doit pas s'effondrer pour autant. Voir la note sur les champs du garde-fou plus bas.
   */
  quarantinedRules?: string[]
}

export interface CapabilityStatus {
  name: string
  kind: 'view' | 'extension'
  available: boolean
  version: string | null
}

export interface ConnectionDetail {
  connection: Connection
  capabilities: {
    serverVersion: string
    serverVersionNum: number
    inRecovery: boolean
    currentUser: string
    isSuperuser: boolean
    hasPgMonitor: boolean
    extensions: Record<string, string>
    availableExtensions: string[]
    views: string[]
    detectedAt: string
  } | null
  capabilitySummary: CapabilityStatus[]
}

export interface TestConnectionResult {
  success: boolean
  error: string | null
  serverVersion: string | null
  timescaleVersion: string | null
  readOnlyEnforced: boolean
  capabilities: CapabilityStatus[]
  warnings: string[]
}

export interface Finding {
  id: number
  connectionId: number
  connectionName: string
  ruleId: string
  ruleVersion: number
  target: string
  category: string
  severity: Severity
  title: string
  message: string
  impact: string | null
  confidence: string | null
  remediationSql: string | null
  documentation: string | null
  status: FindingStatus
  detectedAt: string
  lastSeenAt: string
  resolvedAt: string | null
  occurrences: number
  evidence: Record<string, unknown> | null
  ruleName: string | null
  ruleMissing: boolean
}

export interface FindingPage {
  items: Finding[]
  total: number
  page: number
  pageSize: number
}

export interface FindingHistoryEntry {
  at: string
  fromStatus: string | null
  toStatus: string
  severity: string | null
  note: string | null
  actor: string | null
}

export interface NotificationHistoryEntry {
  at: string
  webhook: string
  event: string
  severity: string
  success: boolean
  attempts: number
  statusCode: number | null
  error: string | null
}

export interface FindingDetail {
  finding: Finding
  history: FindingHistoryEntry[]
  notifications: NotificationHistoryEntry[]
}

export interface VerifyFindingResult {
  verified: boolean
  stillPresent: boolean
  resolved: boolean
  message: string
  skipReason: string | null
  error: string | null
  durationMs: number
  finding: Finding | null
}

export interface FindingSummary {
  active: number
  resolved: number
  ignored: number
  critical: number
  warning: number
  info: number
  byCategory: Record<string, number>
}

export interface RuleError {
  file: string
  ruleId: string | null
  message: string
  origin: string
}

/**
 * Fichier refusé par le moteur, avec son contenu. Une règle en erreur n'entre pas dans le
 * catalogue : elle n'a pas d'identifiant à éditer, on ouvre donc son fichier.
 */
export interface FailingRule extends RuleError {
  yaml: string
  /** Faux pour un fichier livré avec l'application : son répertoire est monté en lecture seule. */
  writable: boolean
}

export interface RulesStatus {
  total: number
  enabled: number
  provided: number
  user: number
  loadedAt: string
  errors: RuleError[]
  byCategory: Record<string, number>
}

export interface Dashboard {
  globalHealth: number | null
  instances: Connection[]
  summary: FindingSummary
  rules: RulesStatus
}

export interface RuleRequirements {
  views: string[]
  extensions: string[]
  missingExtensions: string[]
  minVersion: number | null
  maxVersion: number | null
  monitorRole: boolean | null
  primary: boolean | null
}

export interface RuleOverride {
  connectionId: number | null
  connectionName: string | null
  enabled: boolean | null
  severity: Severity | null
  intervalSeconds: number | null
  /** Délai maximal accordé à la règle sur cette cible ; null = valeur du fichier. */
  timeoutSeconds?: number | null
  parameters: Record<string, unknown>
  updatedAt: string
}

/*
 * Champs du garde-fou : tous facultatifs.
 *
 * Ils sont apparus avec le garde-fou et l'API les renvoie désormais toujours. Mais l'interface
 * et l'API se déploient ensemble sans être servies ensemble en développement — un SPA récent
 * interrogeant une API antérieure lisait `undefined` là où le type promettait un tableau, et la
 * vue entière disparaissait sur un « Cannot read properties of undefined ». Les déclarer
 * facultatifs fait porter cette vérification au compilateur plutôt qu'à la relecture.
 */

/** Trois états du garde-fou, tels que les renvoie l'API. */
export type RuleHealthState = 'healthy' | 'degraded' | 'quarantined'

/**
 * Nature du dernier incident. La distinction commande la conclusion de l'exploitant :
 * `timeout` et `slow` disent que l'instance souffre, `error` que la règle est fautive.
 */
export type RuleFailureKind = 'timeout' | 'error' | 'slow'

/** État d'une règle sur une instance, du point de vue du garde-fou de coût. */
export interface RuleHealth {
  connectionId: number
  connectionName: string
  ruleId: string
  state: RuleHealthState
  /** Vrai tant que l'échéance de quarantaine n'est pas atteinte. */
  quarantined: boolean
  /** Incidents consécutifs, toutes natures confondues : c'est ce que comparent les seuils. */
  strikes: number
  consecutiveFailures: number
  consecutiveSlowRuns: number
  failureKind: RuleFailureKind | null
  failureMessage: string | null
  lastFailureAt: string | null
  lastSuccessAt: string | null
  lastDurationMs: number | null
  maxDurationMs: number | null
  /** Délai en vigueur lors de la dernière exécution, pour situer la durée mesurée. */
  lastTimeoutSeconds: number | null
  quarantinedAt: string | null
  quarantinedUntil: string | null
  quarantineReason: string | null
  quarantineCount: number
  warningThreshold: number
  quarantineThreshold: number
  updatedAt: string
}

export interface Rule {
  id: string
  name: string
  description: string | null
  category: string
  severity: Severity
  group: string
  version: number
  enabled: boolean
  origin: 'provided' | 'user'
  editable: boolean
  overridesProvided: boolean
  file: string
  handler: string | null
  hasQuery: boolean
  intervalSeconds: number | null
  /** Délai propre déclaré par la règle ; null = délai global du scheduler. */
  timeoutSeconds?: number | null
  /** Délai appliqué à défaut de délai propre, en secondes. */
  defaultTimeoutSeconds?: number
  requires: RuleRequirements
  parameters: Record<string, unknown>
  overrides: RuleOverride[]
  /** Instances où la règle est signalée par le garde-fou sans être écartée. */
  degradedInstances?: number
  /** Instances où la règle est écartée : son diagnostic n'y est plus produit. */
  quarantinedInstances?: number
}

export interface RuleApplicability {
  connectionId: number
  connectionName: string
  applicable: boolean
  reason: string | null
  /** Délai réellement appliqué à cette règle sur cette instance, surcharges comprises. */
  timeoutSeconds?: number
  /** État du garde-fou ; null tant que la règle n'a jamais été exécutée ici. */
  health?: RuleHealth | null
}

export interface RuleDetail {
  rule: Rule
  yaml: string
  applicability: RuleApplicability[]
}

export interface RuleSchema {
  categories: string[]
  severities: Severity[]
  groups: string[]
  filters: string[]
  functions: string[]
  knownViews: string[]
  notableExtensions: string[]
  handlers: { name: string; description: string }[]
  template: string
}

export interface ValidateRuleResult {
  valid: boolean
  errors: string[]
  rule: Rule | null
}

export interface DryRunFinding {
  target: string
  severity: Severity
  title: string
  message: string
  remediationSql: string | null
  evidence: Record<string, unknown>
}

export interface DryRunResult {
  executed: boolean
  skipReason: string | null
  error: string | null
  rowCount: number
  durationMs: number
  rows: Record<string, unknown>[]
  findings: DryRunFinding[]
}

export type WebhookFormat = 'generic' | 'discord' | 'slack'

export interface WebhookConfiguration {
  id: number
  key: string
  url: string
  enabled: boolean
  minimumSeverity: Severity
  format: WebhookFormat
  events: string[]
  connectionId: number | null
  connectionName: string | null
  hasHeaders: boolean
  createdAt: string
  lastAttemptAt: string | null
  lastAttemptSucceeded: boolean | null
  lastError: string | null
}

export interface UserAccount {
  id: number
  username: string
  role: Role
  createdAt: string
  lastLoginAt: string | null
  mustChangePassword: boolean
}

export interface TopQuery {
  connectionId: number
  connectionName: string
  queryId: string
  query: string
  calls: number
  totalExecMs: number
  meanExecMs: number
  minExecMs: number
  maxExecMs: number
  stddevExecMs: number
  rows: number
  rowsPerCall: number
  sharedBlksHit: number
  sharedBlksRead: number
  cacheHitRatio: number | null
  tempBlksWritten: number
  shareOfTotal: number
  hasParameters: boolean
  /** Requête exécutée par l'Advisor lui-même : règles, collecteurs, analyses. */
  fromAdvisor: boolean
  /** Un plan mesuré est conservé : l'analyse s'ouvre sans réexécuter la requête. */
  hasSavedPlan: boolean
}

export interface TopQueriesResponse {
  available: boolean
  reason: string | null
  items: TopQuery[]
}

/** État d'une instance dans un classement fusionné : une seule peut manquer à l'appel. */
export interface InstanceQueryStatus {
  id: number
  name: string
  available: boolean
  reason: string | null
  count: number
}

export interface MergedQueriesResponse {
  available: boolean
  items: TopQuery[]
  instances: InstanceQueryStatus[]
}

export interface PlanWarning {
  kind: string
  severity: string
  message: string
}

export interface PlanNode {
  id: number
  parentId: number | null
  depth: number
  nodeType: string
  parentRelationship: string | null
  subplanName: string | null
  relationName: string | null
  alias: string | null
  indexName: string | null
  joinType: string | null
  scanDirection: string | null
  filter: string | null
  indexCondition: string | null
  recheckCondition: string | null
  hashCondition: string | null
  joinFilter: string | null
  sortKey: string | null
  sortMethod: string | null
  groupKey: string | null
  startupCost: number
  totalCost: number
  planRows: number
  planWidth: number
  actualStartupMs: number | null
  actualTotalMs: number | null
  actualRows: number | null
  actualLoops: number | null
  rowsRemovedByFilter: number | null
  heapFetches: number | null
  inclusiveMs: number | null
  selfMs: number | null
  selfSharePercent: number | null
  costSharePercent: number
  estimationFactor: number | null
  sharedHitBlocks: number | null
  sharedReadBlocks: number | null
  sharedDirtiedBlocks: number | null
  sharedWrittenBlocks: number | null
  tempReadBlocks: number | null
  tempWrittenBlocks: number | null
  sortSpaceUsedKb: number | null
  sortSpaceType: string | null
  workersPlanned: number | null
  workersLaunched: number | null
  parallelAware: boolean
  neverExecuted: boolean
  warnings: PlanWarning[]
  label: string
}

export interface ExplainPlan {
  nodes: PlanNode[]
  planningMs: number | null
  executionMs: number | null
  totalCost: number
  analyzed: boolean
  settings: Record<string, string>
  warnings: PlanWarning[]
}

/** Valeur proposée pour un paramètre $n d'une requête normalisée. */
export interface ParameterSuggestion {
  index: number
  column: string | null
  relation: string | null
  value: string | null
  source: string | null
}

/**
 * Remarque sur le déroulement d'une analyse. Le `code` est stable et sert de clé de traduction ;
 * `message`, produit par l'API en anglais comme le reste du backend, sert de repli.
 */
export interface AnalysisNote {
  code: string
  message: string
  count: number | null
}

export interface QueryAnalysisResult {
  sql: string
  planText: string
  planJson: string
  plan: ExplainPlan
  notes: AnalysisNote[]
  /** Date de la mesure — celle de l'EXPLAIN, pas celle de la lecture d'un plan conservé. */
  measuredAt: string
  /** Durée de la mesure elle-même, en millisecondes. */
  durationMs: number
  /** Valeurs utilisées pour $1, $2… : le plan n'a de sens qu'avec elles. */
  parameters: string[]
  /** Vrai lorsque le plan a été relu depuis la base, sans nouvelle exécution. */
  fromStorage: boolean
}

/** Événement poussé par le flux SSE du serveur. */
export interface AdvisorEvent {
  type: string
  at: string
  connectionId: number | null
  data: unknown
}
