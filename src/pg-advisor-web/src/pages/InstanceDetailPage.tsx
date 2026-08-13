import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ConnectionDetail } from '../api/types'
import { useEventListener } from '../app/EventsContext'
import {
  Alert,
  Card,
  EmptyState,
  PageHeader,
  ScoreBar,
  ScoreRing,
  Spinner,
  Tag,
} from '../components/ui'
import {
  categoryLabel,
  collectionStateLabel,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatSeconds,
} from '../lib/format'

export function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const connectionId = Number(id)

  const [detail, setDetail] = useState<ConnectionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setDetail(await api.connections.get(connectionId))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => {
    void load()
  }, [load])

  useEventListener(
    ['collection.state', 'instance.changed', 'health.changed', 'finding.created', 'finding.resolved'],
    (event) => {
      if (event.connectionId === null || event.connectionId === connectionId) {
        void load()
      }
    },
  )

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (error) {
    return <Alert title="Erreur">{error}</Alert>
  }

  if (!detail) {
    return null
  }

  const { connection, capabilities, capabilitySummary } = detail
  const metrics = connection.metrics
  const views = capabilitySummary.filter((capability) => capability.kind === 'view')
  const extensions = capabilitySummary.filter((capability) => capability.kind === 'extension')

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/instances" className="hover:underline">
              Instances
            </Link>{' '}
            / {connection.name}
          </>
        }
        title={connection.name}
        subtitle={`${connection.host}:${connection.port} · ${connection.database} · ${connection.username}`}
        meta={
          <>
            <Tag tone={connection.collectionState === 'error' ? 'bad' : 'accent'}>
              {connection.enabled ? collectionStateLabel(connection.collectionState) : 'désactivée'}
            </Tag>
            {connection.serverVersion && <Tag>PostgreSQL {connection.serverVersion}</Tag>}
            {connection.timescaleVersion && (
              <Tag tone="accent">TimescaleDB {connection.timescaleVersion}</Tag>
            )}
          </>
        }
        actions={
          <Link
            to={`/findings?connectionId=${connection.id}`}
            className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Voir les recommandations
          </Link>
        }
      />

      {connection.lastError && <Alert title="Dernière erreur de collecte">{connection.lastError}</Alert>}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Santé">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
            <ScoreRing score={connection.health?.global ?? null} />
            <dl className="w-full min-w-0 space-y-1 text-sm text-ink-muted">
              <div>
                Critiques :{' '}
                <span className="font-semibold text-ink">{connection.health?.critical ?? 0}</span>
              </div>
              <div>
                Avertissements :{' '}
                <span className="font-semibold text-ink">{connection.health?.warning ?? 0}</span>
              </div>
              <div>
                Informations :{' '}
                <span className="font-semibold text-ink">{connection.health?.info ?? 0}</span>
              </div>
              <div className="pt-1 text-xs text-ink-muted">
                Collecte {formatDateTime(connection.lastCollectedAt)}
              </div>
            </dl>
          </div>
        </Card>

        <Card title="Scores par catégorie" className="lg:col-span-2">
          {!connection.health || Object.keys(connection.health.categories).length === 0 ? (
            <EmptyState title="Pas encore de score">
              Les catégories seront notées après la première exécution des règles applicables.
            </EmptyState>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(connection.health.categories)
                .sort(([, a], [, b]) => a - b)
                .map(([category, score]) => (
                  <ScoreBar key={category} label={categoryLabel(category)} score={score} />
                ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Activité">
        {!metrics ? (
          <EmptyState title="Aucune métrique collectée">
            Les métriques d'activité apparaissent après le premier passage du groupe « santé ».
          </EmptyState>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <MetricTile
              label="Connexions"
              value={`${formatNumber(metrics.connections)} / ${formatNumber(metrics.maxConnections)}`}
              detail={formatPercent(metrics.connectionUsage)}
            />
            <MetricTile label="Requêtes actives" value={formatNumber(metrics.activeQueries)} />
            <MetricTile
              label="Inactives en transaction"
              value={formatNumber(metrics.idleInTransaction)}
            />
            <MetricTile label="Sessions bloquées" value={formatNumber(metrics.blockedSessions)} />
            <MetricTile
              label="Transaction la plus longue"
              value={formatSeconds(metrics.longestTransactionSeconds)}
            />
            <MetricTile
              label="Requête la plus longue"
              value={formatSeconds(metrics.longestQuerySeconds)}
            />
            <MetricTile label="Taux de cache" value={formatPercent(metrics.cacheHitRatio)} />
            <MetricTile label="Taille de la base" value={formatBytes(metrics.databaseSizeBytes)} />
            <MetricTile label="Commits" value={formatNumber(metrics.commits)} />
            <MetricTile label="Rollbacks" value={formatNumber(metrics.rollbacks)} />
            <MetricTile label="Deadlocks" value={formatNumber(metrics.deadlocks)} />
            <MetricTile label="Fichiers temporaires" value={formatBytes(metrics.tempBytes)} />
          </dl>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Capacités détectées">
          {capabilities ? (
            <>
              <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
                <Info label="Version" value={capabilities.serverVersion} />
                <Info label="Utilisateur" value={capabilities.currentUser} />
                <Info label="Superutilisateur" value={capabilities.isSuperuser ? 'oui' : 'non'} />
                <Info label="pg_monitor" value={capabilities.hasPgMonitor ? 'oui' : 'non'} />
                <Info label="En recovery" value={capabilities.inRecovery ? 'oui' : 'non'} />
                <Info label="Détecté" value={formatDateTime(capabilities.detectedAt)} />
              </dl>

              <p className="mb-1.5 text-xs font-semibold text-ink-muted">Extensions</p>
              <ul className="mb-3 space-y-0.5 font-mono text-xs">
                {extensions.map((extension) => (
                  <li
                    key={extension.name}
                    className={extension.available ? 'text-success' : 'text-ink-faint'}
                  >
                    {extension.available ? '✓' : '✗'} {extension.name}
                    {extension.version && ` ${extension.version}`}
                  </li>
                ))}
              </ul>

              <p className="mb-1.5 text-xs font-semibold text-ink-muted">
                Vues lisibles ({views.length})
              </p>
              <ul className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-xs text-success">
                {views.map((view) => (
                  <li key={view.name}>✓ {view.name}</li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState title="Capacités inconnues">
              La détection a lieu à la première connexion réussie.
            </EmptyState>
          )}
        </Card>

        <Card title="Paramètres de collecte">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Instance active" value={connection.enabled ? 'oui' : 'non'} />
            <Info label="Mode SSL" value={connection.sslMode} />
            <Info
              label="Intervalle propre"
              value={
                connection.collectionIntervalSeconds > 0
                  ? `${connection.collectionIntervalSeconds} s`
                  : 'périodicité globale'
              }
            />
            <Info label="Créée le" value={formatDateTime(connection.createdAt)} />
          </dl>

          <p className="mt-4 rounded-md bg-surface-sunken p-3 text-xs text-ink-muted">
            L'Advisor n'écrit jamais sur cette instance : la session est ouverte avec
            <code className="mx-1 rounded bg-border-subtle px-1">default_transaction_read_only=on</code>
            et un <code className="mx-1 rounded bg-border-subtle px-1">statement_timeout</code> borné. Les
            commandes correctives proposées sont à exécuter manuellement.
          </p>
        </Card>
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded-md border border-border-subtle px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</dd>
      {detail && <p className="text-xs text-ink-muted">{detail}</p>}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="truncate text-ink" title={value}>
        {value}
      </dd>
    </div>
  )
}
