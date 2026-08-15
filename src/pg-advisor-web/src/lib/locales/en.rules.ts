/**
 * English catalogue — rules. Fichier dédié à cette zone de l'interface : plusieurs chantiers
 * peuvent avancer en parallèle sans se disputer un catalogue unique.
 *
 * Keys mirror locales/fr.rules.ts exactly: diagnostics list and detail, rule editor and dry run.
 *
 * Wording: a diagnostic is a fact observed on an instance, not a task to tick off. It appears and
 * disappears with the fact; the user never resolves it, they can only decide the observation is of
 * no interest. No label may suggest otherwise.
 */
export const enRules: Record<string, string> = {
  // --- Diagnostics: header and tabs -------------------------------------------
  'findings.subtitle': 'Facts observed on your instances. The Advisor never runs a command.',
  'findings.statusTabs': 'Status',
  'findings.tab.active': 'Active',
  'findings.tab.ignored': 'Ignored',
  'findings.tab.resolved': 'Resolved',
  'findings.tab.all': 'All',
  'findings.count.one': '{count} diagnostic',
  'findings.count.other': '{count} diagnostics',
  'findings.limited': 'first {count} only',

  // --- Diagnostics: entry point -----------------------------------------------
  'findings.hero.pending.one': 'of {count} active diagnostic',
  'findings.hero.pending.other': 'of {count} active diagnostics',
  'findings.hero.warnings.one': '{count} warning',
  'findings.hero.warnings.other': '{count} warnings',
  'findings.hero.infos.one': '{count} info',
  'findings.hero.infos.other': '{count} info',
  'findings.hero.showCritical': 'Show critical',

  // --- Diagnostics: columns and filters ----------------------------------------
  'findings.column.diagnostic': 'Diagnostic',
  'findings.column.detected': 'Detected',
  'findings.rowTitle': 'Open the detail',
  'findings.searchPlaceholder': 'title, object, rule',
  'findings.unit.severity': 'severity',
  'findings.unit.severities': 'severities',
  'findings.unit.instance': 'instance',
  'findings.unit.instances': 'instances',
  'findings.unit.category': 'category',
  'findings.unit.categories': 'categories',

  // --- Diagnostics: real time -------------------------------------------------
  'findings.live.new.one': '{count} new diagnostic',
  'findings.live.new.other': '{count} new diagnostics',
  'findings.live.newCritical.one': '{count} new critical diagnostic',
  'findings.live.newCritical.other': '{count} new critical diagnostics',

  // --- Diagnostics: messages --------------------------------------------------
  'findings.ignoredNotice':
    'An ignored diagnostic is no longer notified and no longer weighs on the health score. It keeps being refreshed: “Reconsider” puts it back among the active diagnostics.',
  'findings.resolvedNotice':
    'A diagnostic is resolved by the engine once the observed fact is gone from the instance, at the next run of the rule or on verification. Nobody ticks it off by hand.',
  'findings.statusFailed': 'Status change failed.',
  'findings.verifyFailed': 'Verification failed.',
  'findings.notice.ignored': '“{title}” is now ignored.',
  'findings.notice.reconsidered': '“{title}” is back among the active diagnostics.',

  // --- Diagnostics: empty list ------------------------------------------------
  'findings.empty.title': 'No diagnostic',
  'findings.empty.active': 'Nothing observed on the supervised instances.',
  'findings.empty.ignored': 'No ignored diagnostic. Use the menu on an active row to move one here.',
  'findings.empty.other': 'Try another status.',
  'findings.empty.filtered': 'No diagnostic for these filters',
  'findings.empty.filteredHint': 'The chosen scope returns nothing: widen it.',

  // --- Diagnostics: list row --------------------------------------------------
  'findings.occurrences.one': '{count} occurrence',
  'findings.occurrences.other': '{count} occurrences',
  'findings.durationMs': '{ms} ms',

  // --- Diagnostics: actions ---------------------------------------------------
  // Two gestures, and two only: deciding the observation is of no interest, and taking it back.
  // Closing a diagnostic belongs to the engine alone.
  'findings.action.ignore': 'Ignore',
  'findings.action.reconsider': 'Reconsider',
  'findings.action.verify': 'Verify',
  'findings.action.verifyHint':
    'Replays the rule on the instance: the engine closes the diagnostic if the fact is gone.',

  // --- Diagnostics: detail ----------------------------------------------------
  'findings.detail.fallbackTitle': 'Diagnostic',
  'findings.detail.resolutionHint':
    'This observation goes away on its own once the fact behind it is gone: the engine closes it, at the next run of the rule or on verification.',
  'findings.detail.impact': 'Estimated impact',
  'findings.detail.confidence': 'Confidence',
  'findings.detail.occurrences': 'Occurrences',
  'findings.detail.lastSeen': 'Last seen',
  'findings.detail.detectedAt': 'Detected on',
  'findings.detail.resolvedAt': 'Resolved on',
  'findings.detail.rule': 'Triggering rule',
  'findings.detail.ruleVersion': 'version {version}',
  'findings.detail.ruleMissing':
    'This rule is no longer loaded: this diagnostic will not be refreshed.',
  'findings.detail.evidence': 'Collected evidence',
  'findings.detail.remediation': 'Suggested corrective command',
  'findings.detail.remediationHint':
    'to be run manually: the Advisor never runs this command, its supervision session is read-only.',
  'findings.detail.documentation': 'PostgreSQL documentation',
  'findings.detail.history': 'History',
  'findings.detail.notifications': 'Notifications sent',
  'findings.detail.sent': 'sent',
  'findings.detail.failed': 'failed {status}',
  'findings.detail.actor': 'by {actor}',

  // --- Rule catalogue -----------------------------------------------------------
  'rules.new': 'New rule',
  'rules.catalog': 'Catalogue',
  'rules.failing.one': '{count} failing rule',
  'rules.failing.other': '{count} failing rules',
  // Units for the summary of a multiple selection: “2 categories”, not a list.
  'rules.unit.category': 'category',
  'rules.unit.categories': 'categories',
  'rules.unit.severity': 'severity',
  'rules.unit.severities': 'severities',
  'rules.unit.origin': 'origin',
  'rules.unit.origins': 'origins',
  'rules.unit.state': 'state',
  'rules.unit.states': 'states',
  'rules.empty.title': 'No rule loaded',
  'rules.empty.hint':
    'Rules shipped with the application are read at startup. A rule written here adds to them and is reloaded on the fly.',
  'rules.noMatchHint': 'No rule in the catalogue matches these criteria. Lift a filter to see more.',
  'rules.live.reloaded': 'Rules reloaded',

  // --- Cost guard -------------------------------------------------------------
  'ruleHealth.state.healthy': 'healthy',
  'ruleHealth.state.degraded': 'degraded',
  'ruleHealth.state.quarantined': 'quarantined',
  'ruleHealth.kind.timeout': 'timed out',
  'ruleHealth.kind.error': 'SQL error',
  'ruleHealth.kind.slow': 'ran too slowly',
  'ruleHealth.kindHint.timeout':
    'The instance did not answer within the allotted time: it is the instance that is struggling, not the rule.',
  'ruleHealth.kindHint.error':
    'The rule’s query failed: the rule is what needs fixing, not the instance.',
  'ruleHealth.kindHint.slow':
    'The rule completes, but costs the instance too much to be repeated this often.',

  // --- Catalogue: rule state --------------------------------------------------
  'rules.degradedTag': 'degraded',
  'rules.quarantinedTag': 'quarantined',
  'rules.degradedOn.one': 'degraded on {count} instance',
  'rules.degradedOn.other': 'degraded on {count} instances',
  'rules.quarantinedOn.one': 'set aside on {count} instance',
  'rules.quarantinedOn.other': 'set aside on {count} instances',
  'rules.guard.quarantinedTitle.one': '{count} rule set aside by the cost guard',
  'rules.guard.quarantinedTitle.other': '{count} rules set aside by the cost guard',
  'rules.guard.quarantinedBody':
    'Their diagnostic is no longer produced on the instances concerned: the category stops being scored there, and the score climbs without any database getting better.',
  'rules.guard.degradedTitle.one': '{count} rule flagged by the cost guard',
  'rules.guard.degradedTitle.other': '{count} rules flagged by the cost guard',
  'rules.guard.degradedBody':
    'They still run, but are piling up incidents: at the next threshold they will be set aside on the instance and their diagnostic will stop.',
  'rules.guard.alsoDegraded.one': '{count} more rule is flagged without being set aside.',
  'rules.guard.alsoDegraded.other': '{count} more rules are flagged without being set aside.',
  'rules.guard.show': 'View these rules',
  'rules.live.degraded': 'Rule “{rule}” degraded on {instance}',
  'rules.live.quarantined': 'Rule “{rule}” set aside on {instance}',
  'rules.live.recovered': 'Rule “{rule}” recovered on {instance}',

  // --- Rule editor: header ----------------------------------------------------
  'ruleEditor.newTitle': 'New rule',
  'ruleEditor.group': 'group {group}',
  'ruleEditor.version': 'version {version}',
  'ruleEditor.providedTitle': 'Rule bundled with the application',
  'ruleEditor.providedBody':
    'Saving does not touch the shipped file: it writes a custom version in the data volume that supersedes it. Deleting that version restores the original rule.',
  'ruleEditor.saved': 'Rule “{id}” saved and reloaded.',
  'ruleEditor.saveFailed': 'Save failed.',
  'ruleEditor.deleteFailed': 'Deletion failed.',
  'ruleEditor.deleteTitle': 'Delete rule “{id}”?',
  'ruleEditor.deleteBody':
    'The definition written in the data volume is erased. If it superseded a bundled rule, that rule takes its place again at the next reload.',
  'ruleEditor.deleteConfirm': 'Delete the rule',

  // --- Rule editor: YAML definition -------------------------------------------
  'ruleEditor.yamlTitle': 'YAML definition',
  'ruleEditor.yamlLabel': 'YAML definition of the rule',
  'ruleEditor.validTag': 'valid',
  'ruleEditor.errorCount.one': '{count} error',
  'ruleEditor.errorCount.other': '{count} errors',
  'ruleEditor.unsavedTag': 'unsaved',
  'ruleEditor.unsavedTitle': 'Unsaved changes.',
  'ruleEditor.invalidTitle': 'The rule is not valid',
  // A validation error is placed as close as possible to the offending line: it names it, tints
  // it in the editor, and takes you there in one click.
  'ruleEditor.line': 'line {line}',
  'ruleEditor.goToLine': 'Go to line {line}',

  // --- Rule editor: dry run ---------------------------------------------------
  'ruleEditor.dryRunTitle': 'Preview on an instance',
  'ruleEditor.dryRunHint':
    'Read-only execution on the chosen instance, without saving the rule or creating any finding.',
  'ruleEditor.dryRunTarget': 'Target instance',
  'ruleEditor.dryRunRun': 'Dry run',
  'ruleEditor.dryRunFailed': 'Preview failed.',
  'ruleEditor.dryRunPending': 'No run yet',
  'ruleEditor.dryRunPendingHint':
    'The result appears here, facing the definition: rows returned, findings produced and raw SQL output.',
  'ruleEditor.dryRunErrorTitle': 'Execution failed',
  'ruleEditor.dryRunSkippedTitle': 'Rule not applicable',
  'ruleEditor.dryRunRows.one': '{count} row returned',
  'ruleEditor.dryRunRows.other': '{count} rows returned',
  'ruleEditor.dryRunFindings.one': '{count} finding produced',
  'ruleEditor.dryRunFindings.other': '{count} findings produced',
  'ruleEditor.dryRunSummary': '{rows} in {ms} ms — {findings}',
  'ruleEditor.dryRunFindingsTitle': 'Findings produced',
  'ruleEditor.dryRunSqlTitle': 'SQL result',
  'ruleEditor.noInstance': 'No instance to query',
  'ruleEditor.noInstanceBody': 'Add a PostgreSQL connection to dry-run a rule.',
  'ruleEditor.addInstance': 'Add an instance',

  // --- Rule editor: applicability and cheat sheet -----------------------------
  'ruleEditor.applicability': 'Applicability',
  'ruleEditor.applicabilityHint': 'where this rule will run, given the instances known today',
  'ruleEditor.applicableTag': 'applicable',
  'ruleEditor.skippedTag': 'skipped',
  'ruleEditor.degradedTag': 'degraded',
  'ruleEditor.quarantinedTag': 'set aside',
  'ruleEditor.strikesLabel': 'Incidents',
  'ruleEditor.strikes.one': '{count} of {max}',
  'ruleEditor.strikes.other': '{count} of {max}',
  'ruleEditor.lastIncidentLabel': 'Last incident',
  'ruleEditor.durationLabel': 'Duration / limit',
  'ruleEditor.durationTitle': '{observed} observed against {timeout} allowed',
  'ruleEditor.quarantineUntilLabel': 'Set aside until',
  'ruleEditor.reactivate': 'Reactivate',
  'ruleEditor.reactivateAll': 'Reactivate everywhere',
  'ruleEditor.reactivateTitle': 'Reactivate “{rule}” on {instance}?',
  'ruleEditor.reactivateAllTitle': 'Reactivate “{rule}” on every instance?',
  'ruleEditor.reactivateBody':
    'This assumes the cause has been dealt with. The incident count starts again from zero and the rule runs at the next cycle; if the cause is still there, it will be set aside again.',
  'ruleEditor.reactivateConfirm': 'Reactivate the rule',
  'ruleEditor.reactivated': 'Rule reactivated on {scope}: the incident count starts again from zero.',
  'ruleEditor.reactivateFailed': 'Reactivation failed.',
  'ruleEditor.help': 'Cheat sheet',
  'ruleEditor.helpShow': 'Show',
  'ruleEditor.helpHide': 'Hide',
  'ruleEditor.helpSummary':
    'Categories, groups, filters, condition functions and built-in handlers.',
  'ruleEditor.helpCategories': 'Categories',
  'ruleEditor.helpGroups': 'Schedule groups',
  'ruleEditor.helpFilters': 'Message filters',
  'ruleEditor.helpFunctions': 'Condition functions',
  'ruleEditor.helpExtensions': 'Known extensions',
  'ruleEditor.helpHandlers': 'Built-in handlers',

  // --- Rule editor: overrides -------------------------------------------------
  'ruleEditor.overrides': 'Overrides',
  'ruleEditor.overridesHint':
    'An override does not write to the file: it adjusts activation, severity, schedule or thresholds, globally or for a single instance.',
  'ruleEditor.scope': 'Scope',
  'ruleEditor.scopeHint': 'one instance, or all of them',
  'ruleEditor.allInstances': 'All instances',
  'ruleEditor.activation': 'Activation',
  'ruleEditor.ruleValue': 'Rule value ({value})',
  'ruleEditor.enabledOption': 'Enabled',
  'ruleEditor.disabledOption': 'Disabled',
  'ruleEditor.interval': 'Schedule (s)',
  'ruleEditor.intervalHint': 'empty = the group’s',
  'ruleEditor.timeout': 'Time limit (s)',
  'ruleEditor.timeoutHint': 'default {value} s, from 1 to 300',
  'ruleEditor.thresholds': 'Thresholds',
  'ruleEditor.thresholdDefault': 'default: {value}',
  'ruleEditor.saveOverride': 'Save override',
  'ruleEditor.deleteOverride': 'Delete this override',
  'ruleEditor.savedOverrides': 'Saved overrides',
  'ruleEditor.editOverride': 'Edit the “{scope}” override',
  'ruleEditor.overrideSeverity': 'severity {severity}',
  'ruleEditor.overrideInterval': 'every {seconds} s',
  'ruleEditor.overrideTimeout': '{seconds} s limit',
}
