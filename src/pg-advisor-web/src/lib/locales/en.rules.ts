/**
 * English catalogue — rules. Fichier dédié à cette zone de l'interface : plusieurs chantiers
 * peuvent avancer en parallèle sans se disputer un catalogue unique.
 *
 * Keys mirror locales/fr.rules.ts exactly: findings list and detail, rule editor and dry run.
 */
export const enRules: Record<string, string> = {
  // --- Findings: header and tabs --------------------------------------------
  'findings.subtitle':
    'Every diagnosis names the rule that produced it, its evidence and the corrective command — never run automatically.',
  'findings.statusTabs': 'Status',
  'findings.tab.active': 'To handle',
  'findings.tab.ignored': 'Ignored',
  'findings.tab.resolved': 'Resolved',
  'findings.tab.all': 'All',
  'findings.count.one': '{count} recommendation',
  'findings.count.other': '{count} recommendations',
  'findings.virtualized': 'virtualised list',
  'findings.limited': 'showing the first {count} only: narrow the filters',

  // --- Findings: filters ------------------------------------------------------
  'findings.searchPlaceholder': 'title, object, rule',
  'findings.searchHint': 'Enter to apply',

  // --- Findings: messages -----------------------------------------------------
  'findings.ignoredNotice':
    'An ignored recommendation is no longer notified and no longer weighs on the health score. It keeps being refreshed: “Stop ignoring” puts it back in the list to handle.',
  'findings.statusFailed': 'Status change failed.',
  'findings.verifyFailed': 'Verification failed.',
  'findings.notice.resolved': '“{title}” marked as resolved.',
  'findings.notice.ignored': '“{title}” is now ignored.',
  'findings.notice.reactivated': '“{title}” is back in the list to handle.',

  // --- Findings: empty list ---------------------------------------------------
  'findings.empty.title': 'No recommendation for these filters',
  'findings.empty.active': 'Nothing to handle on the selected scope.',
  'findings.empty.ignored':
    'No ignored recommendation. Use the menu on a row to move one here.',
  'findings.empty.other': 'Try another status or widen the filters.',

  // --- Findings: list row -----------------------------------------------------
  'findings.detected': 'detected {when}',
  'findings.occurrences.one': '{count} occurrence',
  'findings.occurrences.other': '{count} occurrences',
  'findings.durationMs': '{ms} ms',

  // --- Findings: actions ------------------------------------------------------
  'findings.action.resolve': 'Mark as resolved',
  'findings.action.ignore': 'Ignore',
  'findings.action.ignoreHint': 'Leaves the list to handle, with no notification and no score impact.',
  'findings.action.unignore': 'Stop ignoring',
  'findings.action.reactivate': 'Reactivate',
  'findings.action.verify': 'Verify',
  'findings.action.verifyHint': 'Replays the rule on the instance and resolves if the problem is gone.',

  // --- Findings: detail -------------------------------------------------------
  'findings.detail.fallbackTitle': 'Recommendation',
  'findings.detail.diagnosis': 'Diagnosis',
  'findings.detail.impact': 'Estimated impact',
  'findings.detail.confidence': 'Confidence',
  'findings.detail.occurrences': 'Occurrences',
  'findings.detail.lastSeen': 'Last seen',
  'findings.detail.detectedAt': 'Detected on',
  'findings.detail.resolvedAt': 'Resolved on',
  'findings.detail.rule': 'Triggering rule',
  'findings.detail.ruleVersion': 'version {version}',
  'findings.detail.ruleMissing': 'This rule is no longer loaded: the finding will not be refreshed.',
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

  // --- Rule editor: YAML definition -------------------------------------------
  'ruleEditor.yamlTitle': 'YAML definition',
  'ruleEditor.yamlLabel': 'YAML definition of the rule',
  'ruleEditor.validTag': 'valid',
  'ruleEditor.errorCount.one': '{count} error',
  'ruleEditor.errorCount.other': '{count} errors',
  'ruleEditor.unsavedTag': 'unsaved',
  'ruleEditor.unsavedTitle': 'Unsaved changes.',
  'ruleEditor.invalidTitle': 'The rule is not valid',

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
  'ruleEditor.applicableTag': 'applicable',
  'ruleEditor.skippedTag': 'skipped',
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
  'ruleEditor.allInstances': 'All instances',
  'ruleEditor.activation': 'Activation',
  'ruleEditor.ruleValue': 'Rule value ({value})',
  'ruleEditor.enabledOption': 'Enabled',
  'ruleEditor.disabledOption': 'Disabled',
  'ruleEditor.interval': 'Schedule (s)',
  'ruleEditor.intervalHint': 'empty = the group’s',
  'ruleEditor.thresholds': 'Thresholds',
  'ruleEditor.thresholdDefault': 'default: {value}',
  'ruleEditor.saveOverride': 'Save override',
  'ruleEditor.deleteOverride': 'Delete this override',
  'ruleEditor.savedOverrides': 'Saved overrides',
  'ruleEditor.editOverride': 'Edit the “{scope}” override',
  'ruleEditor.overrideSeverity': 'severity {severity}',
  'ruleEditor.overrideInterval': 'every {seconds} s',
}
