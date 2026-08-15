/**
 * English catalogue — instances. Fichier dédié à cette zone de l'interface : plusieurs chantiers
 * peuvent avancer en parallèle sans se disputer un catalogue unique.
 *
 * Mêmes clés que fr.instances.ts, dans le même ordre : une clé absente ici retomberait sur le
 * français, et l'écart se verrait à l'écran.
 */
export const enInstances: Record<string, string> = {
  // --- Instances: list ------------------------------------------------------
  'instances.subtitle': 'Every instance is monitored read-only and scored on its own.',
  'instances.add': 'Add an instance',
  'instances.count.one': '{count} instance',
  'instances.count.other': '{count} instances',
  'instances.empty.title': 'No monitored instance',
  'instances.empty.body':
    'Add a read-only connection. The Advisor never modifies the PostgreSQL instance: the session is forced read-only.',
  'instances.column.target': 'Target',
  'instances.column.lastCollection': 'Last collection',
  'instances.collectedAt': 'Collected {when}',
  'instances.delete.title': 'Delete “{name}”?',
  'instances.delete.body':
    'The PostgreSQL instance is left untouched: only the stored connection, its findings and its history are removed from the Advisor.',

  // --- Instances: connection form -------------------------------------------
  'instances.form.addTitle': 'Add a PostgreSQL instance',
  'instances.form.editTitle': 'Edit “{name}”',
  'instances.form.target': 'Target',
  'instances.form.authentication': 'Authentication',
  'instances.form.collection': 'Collection',
  'instances.form.enabled': 'Instance enabled',
  'instances.form.nameHint': 'Label shown on the dashboard',
  'instances.form.host': 'Host',
  'instances.form.hostPlaceholder': 'db.example.local',
  'instances.form.port': 'Port',
  'instances.form.database': 'Database',
  'instances.form.username': 'User',
  'instances.form.usernameHint': 'A read-only role, member of pg_monitor if possible',
  'instances.form.password': 'Password',
  'instances.form.passwordHint': 'Leave empty to keep the stored password',
  'instances.form.interval': 'Collection interval (s)',
  'instances.form.intervalHint': '0 to follow the global scheduler period',
  'instances.form.test': 'Test connection',
  'instances.form.testFailed': 'Unable to run the test.',
  'instances.form.saveFailed': 'Unable to save.',

  // --- Instances: connection test result ------------------------------------
  'instances.test.failedTitle': 'Connection failed',
  'instances.test.successTitle': 'Connected — PostgreSQL {version}',
  'instances.test.timescale': 'TimescaleDB {version}',
  'instances.test.readOnly': 'Read-only session: {state}',
  'instances.test.readOnlyConfirmed': 'confirmed',
  'instances.test.readOnlyUnconfirmed': 'not confirmed',
  'instances.test.available': 'Available ({count})',
  'instances.test.missing': 'Missing ({count})',

  // --- Notifications: list --------------------------------------------------
  'webhooks.subtitle': 'Each finding episode is notified only once per destination.',
  'webhooks.add': 'Add a webhook',
  'webhooks.count.one': '{count} webhook',
  'webhooks.count.other': '{count} webhooks',
  'webhooks.empty.title': 'No webhook configured',
  'webhooks.empty.body':
    'A webhook receives new findings and their resolutions. Each episode is notified only once per destination.',
  'webhooks.event.newFinding': 'New finding',
  'webhooks.event.findingResolved': 'Finding resolved',
  'webhooks.format.generic': 'Generic (full JSON)',
  'webhooks.format.genericHint':
    'Full payload: instance, finding, evidence. For a custom webhook or an alert router.',
  'webhooks.format.discord': 'Discord',
  'webhooks.format.discordHint':
    'Discord embed coloured by severity. Required for a discord.com/api/webhooks/… URL.',
  'webhooks.format.slack': 'Slack',
  'webhooks.format.slackHint':
    'Slack message with a coloured attachment. For a hooks.slack.com/services/… URL.',
  'webhooks.tag.enabled': 'enabled',
  'webhooks.tag.disabled': 'disabled',
  'webhooks.tag.headers': 'headers',
  'webhooks.fromSeverity': 'severity ≥ {severity}',
  'webhooks.allInstances': 'All instances',
  'webhooks.lastSuccess': 'last delivery succeeded {when}',
  'webhooks.lastFailure': 'last delivery failed {when} — {error}',
  'webhooks.testSent': 'Test sent to “{key}” (HTTP {status}).',
  'webhooks.testFailed': 'Test failed for “{key}”: {error}',
  'webhooks.formatFixed': '“{key}” now emits in {format} format. Run a test to confirm.',
  'webhooks.fixFailed': 'Unable to apply the fix.',
  'webhooks.mismatchTitle': 'Wrong format for a {service} URL',
  'webhooks.mismatchBody':
    'The payload is emitted in “{format}” format, which {service} rejects with “Cannot send an empty message”.',
  'webhooks.switchTo': 'Switch to {format} format',

  // --- Notifications: history -----------------------------------------------
  'webhooks.history.title': 'Notification history ({count})',
  'webhooks.history.empty': 'No notification sent',
  'webhooks.history.date': 'Date',
  'webhooks.history.webhook': 'Webhook',
  'webhooks.history.event': 'Event',
  'webhooks.history.result': 'Result',
  'webhooks.history.failure': 'failed after {attempts} — {error}',
  'webhooks.history.attempts.one': '{count} attempt',
  'webhooks.history.attempts.other': '{count} attempts',

  // --- Notifications: form --------------------------------------------------
  'webhooks.form.addTitle': 'Add a webhook',
  'webhooks.form.editTitle': 'Edit “{key}”',
  'webhooks.form.destination': 'Destination',
  'webhooks.form.key': 'Identifier',
  'webhooks.form.keyHint': 'Lower case, no space: used as the reference in the logs',
  'webhooks.form.url': 'URL',
  'webhooks.form.urlPlaceholder': 'https://hooks.example.local/pg-advisor',
  'webhooks.form.format': 'Payload format',
  'webhooks.form.enabled': 'Webhook enabled',
  'webhooks.form.mismatch':
    'This URL looks like a {service} webhook: with the generic format, the service will answer “HTTP 400 Bad Request”. Pick the matching format.',
  'webhooks.form.trigger': 'Trigger',
  'webhooks.form.minimumSeverity': 'Minimum severity',
  'webhooks.form.connection': 'Instance scope',
  'webhooks.form.events': 'Events',
  'webhooks.form.transport': 'Transport',
  'webhooks.form.headers': 'HTTP headers',
  'webhooks.form.headersHint':
    'One per line, as Name: value. May hold a token: never returned by the API.',
  'webhooks.form.replaceHeaders': 'Replace the stored headers',
  'webhooks.form.headersKept': 'The stored HTTP headers are kept as they are.',
  'webhooks.form.saveFailed': 'Unable to save.',

  // --- Accounts -------------------------------------------------------------
  'users.subtitle':
    'A viewer reads the dashboard and the recommendations; an administrator manages instances, rules and notifications.',
  'users.adminOnly': 'This page is reserved for administrators.',
  'users.add': 'Add an account',
  'users.count.one': '{count} account',
  'users.count.other': '{count} accounts',
  'users.empty': 'No account',
  'users.column.username': 'Username',
  'users.column.role': 'Role',
  'users.column.createdAt': 'Created on',
  'users.column.lastLogin': 'Last sign-in',
  'users.you': 'you',
  'users.mustChangePassword': 'password to change',
  'users.roleFor': 'Role of {name}',
  'users.resetPassword': 'Password',
  'users.createFailed': 'Unable to create the account.',
  'users.updateFailed': 'Unable to save the change.',
  'users.deleteFailed': 'Unable to delete the account.',
  'users.form.username': 'Username',
  'users.form.password': 'Password',
  'users.form.passwordHint': '10 characters minimum',
  'users.form.role': 'Role',
  'users.form.roleHint': 'A viewer reads the dashboard but changes nothing',
  'users.reset.title': 'New password for “{name}”',
  'users.changeOwn.title': 'Change my password',
  'users.changeOwn.current': 'Current password',
  'users.changeOwn.new': 'New password',
  'users.changeOwn.submit': 'Change',
  'users.changeOwn.done': 'Password changed.',
  'webhooks.delete.title': 'Delete "{name}"?',
  'webhooks.delete.body':
    'The configuration and its delivery history are removed. Findings already notified are not sent again.',
  'webhooks.deleteFailed': 'Unable to delete.',
  'users.delete.title': 'Delete "{name}"?',
  'users.delete.body':
    'The account loses access immediately. Findings it resolved or ignored keep its name in their history.',
}
