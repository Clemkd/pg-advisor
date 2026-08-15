import type {
  Connection,
  ConnectionDetail,
  CurrentUser,
  Dashboard,
  DryRunResult,
  Finding,
  FindingDetail,
  FindingPage,
  FindingStatus,
  FindingSummary,
  Rule,
  RuleDetail,
  RuleError,
  RuleHealth,
  RuleSchema,
  RulesStatus,
  TestConnectionResult,
  UserAccount,
  ValidateRuleResult,
  WebhookConfiguration,
} from './types'

/** Erreur d'API portant le code HTTP et le message lisible renvoyé par le serveur. */
export class ApiError extends Error {
  readonly status: number
  readonly details?: string[]

  /**
   * Corps de la réponse, tel que renvoyé par le serveur. Certaines erreurs portent des données
   * exploitables — le nombre de paramètres attendus par une requête, par exemple — et les lire
   * ici vaut mieux que d'aller les repêcher dans le texte du message.
   */
  readonly payload?: Record<string, unknown>

  constructor(status: number, message: string, details?: string[], payload?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
    this.payload = payload
  }
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()

/** Permet au contexte d'authentification de réagir à une session expirée. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (response.status === 401) {
    // Sur le formulaire de connexion, un 401 signifie « identifiants invalides », pas une
    // session perdue : le message du serveur est alors le seul utile.
    if (path.endsWith('/auth/login')) {
      const [message, details] = await describeError(response)
      throw new ApiError(401, message, details)
    }

    // Ne pas prévenir sur la vérification initiale de session : c'est un état normal.
    if (!path.endsWith('/auth/me')) {
      unauthorizedListeners.forEach((listener) => listener())
    }

    throw new ApiError(401, 'Session expirée. Reconnectez-vous.')
  }

  if (!response.ok) {
    throw new ApiError(response.status, ...(await describeError(response)))
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

type ErrorDescription = [string, string[]?, Record<string, unknown>?]

/** Extrait le message d'un ProblemDetails ou d'un ValidationProblemDetails ASP.NET Core. */
async function describeError(response: Response): Promise<ErrorDescription> {
  try {
    const problem = (await response.json()) as {
      title?: string
      detail?: string
      errors?: Record<string, string[]>
    }

    const details = problem.errors ? Object.values(problem.errors).flat() : undefined
    const message =
      problem.title ??
      problem.detail ??
      details?.[0] ??
      `Erreur ${response.status}`

    return [message, details, problem as Record<string, unknown>]
  } catch {
    return [`Erreur ${response.status} ${response.statusText}`.trim()]
  }
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value))
    }
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const api = {
  auth: {
    me: () => get<CurrentUser>('/api/auth/me'),
    login: (username: string, password: string) =>
      post<CurrentUser>('/api/auth/login', { username, password }),
    logout: () => post<void>('/api/auth/logout'),
    changePassword: (currentPassword: string, newPassword: string) =>
      post<void>('/api/auth/password', { currentPassword, newPassword }),
    users: () => get<UserAccount[]>('/api/auth/users'),
    createUser: (username: string, password: string, role: string) =>
      post<UserAccount>('/api/auth/users', { username, password, role }),
    updateUser: (id: number, body: { role?: string; password?: string }) =>
      request<void>(`/api/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteUser: (id: number) => del<void>(`/api/auth/users/${id}`),
  },

  dashboard: () => get<Dashboard>('/api/dashboard'),

  connections: {
    list: () => get<Connection[]>('/api/connections'),
    get: (id: number) => get<ConnectionDetail>(`/api/connections/${id}`),
    create: (body: unknown) => post<Connection>('/api/connections', body),
    update: (id: number, body: unknown) => put<Connection>(`/api/connections/${id}`, body),
    remove: (id: number) => del<void>(`/api/connections/${id}`),
    test: (body: unknown) => post<TestConnectionResult>('/api/connections/test', body),
  },

  findings: {
    list: (params: {
      connectionId?: number
      status?: string
      severity?: string
      category?: string
      ruleId?: string
      search?: string
      page?: number
      pageSize?: number
    }) => get<FindingPage>(`/api/findings${query(params)}`),
    get: (id: number) => get<FindingDetail>(`/api/findings/${id}`),
    summary: (connectionId?: number) =>
      get<FindingSummary>(`/api/findings/summary${query({ connectionId })}`),
    setStatus: (id: number, status: FindingStatus, note?: string) =>
      post<Finding>(`/api/findings/${id}/status`, { status, note }),
    verify: (id: number) => post<import('./types').VerifyFindingResult>(`/api/findings/${id}/verify`),
  },

  rules: {
    list: (params: { category?: string; origin?: string; search?: string } = {}) =>
      get<Rule[]>(`/api/rules${query(params)}`),
    get: (id: string) => get<RuleDetail>(`/api/rules/${encodeURIComponent(id)}`),
    /** État du garde-fou pour toutes les règles suivies, sans ouvrir chacune d'elles. */
    health: (params: { connectionId?: number; state?: string } = {}) =>
      get<RuleHealth[]>(`/api/rules/health${query(params)}`),
    /** Lève la quarantaine : sur une instance, ou partout si `connectionId` vaut null. */
    reactivate: (id: string, connectionId: number | null = null) =>
      post<RuleHealth[]>(`/api/rules/${encodeURIComponent(id)}/reactivate`, { connectionId }),
    schema: () => get<RuleSchema>('/api/rules/schema'),
    errors: () => get<RuleError[]>('/api/rules/errors'),
    validate: (yaml: string) => post<ValidateRuleResult>('/api/rules/validate', { yaml }),
    create: (yaml: string) => post<RuleDetail>('/api/rules', { yaml }),
    update: (id: string, yaml: string) =>
      put<RuleDetail>(`/api/rules/${encodeURIComponent(id)}`, { yaml }),
    remove: (id: string) => del<void>(`/api/rules/${encodeURIComponent(id)}`),
    reload: () => post<RulesStatus>('/api/rules/reload'),
    dryRun: (id: string, connectionId: number, yaml?: string) =>
      post<DryRunResult>(`/api/rules/${encodeURIComponent(id)}/dry-run`, { connectionId, yaml }),
    saveOverride: (
      id: string,
      body: {
        connectionId?: number | null
        enabled?: boolean | null
        severity?: string | null
        intervalSeconds?: number | null
        timeoutSeconds?: number | null
        parameters?: Record<string, unknown> | null
      },
    ) => put<unknown>(`/api/rules/${encodeURIComponent(id)}/override`, body),
    deleteOverride: (id: string, connectionId?: number | null) =>
      del<void>(`/api/rules/${encodeURIComponent(id)}/override${query({ connectionId })}`),
  },

  queries: {
    analyze: (
      connectionId: number,
      body: {
        sql?: string
        queryId?: string
        buffers?: boolean
        parameters?: string[]
      },
    ) =>
      post<import('./types').QueryAnalysisResult>(
        `/api/instances/${connectionId}/queries/analyze`,
        body,
      ),
    /**
     * Dernier plan conservé pour cette requête, ou `null` s'il n'y en a pas. L'absence de plan
     * est un état normal à l'ouverture d'une analyse, pas une erreur à remonter à l'appelant.
     */
    savedPlan: async (connectionId: number, body: { sql?: string; queryId?: string }) => {
      try {
        return await post<import('./types').QueryAnalysisResult>(
          `/api/instances/${connectionId}/queries/plan`,
          body,
        )
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) return null
        throw cause
      }
    },
    /** Classement fusionné de plusieurs instances. */
    across: (params: {
      connectionIds: string
      sort?: string
      limit?: number
      search?: string
      includeAdvisor?: boolean
    }) => get<import('./types').MergedQueriesResponse>(`/api/queries${query(params)}`),
    suggestParameters: (connectionId: number, body: { sql?: string; queryId?: string }) =>
      post<{ items: import('./types').ParameterSuggestion[] }>(
        `/api/instances/${connectionId}/queries/parameters`,
        body,
      ),
  },

  webhooks: {
    list: () => get<WebhookConfiguration[]>('/api/notifications'),
    create: (body: unknown) => post<WebhookConfiguration>('/api/notifications', body),
    update: (id: number, body: unknown) => put<WebhookConfiguration>(`/api/notifications/${id}`, body),
    remove: (id: number) => del<void>(`/api/notifications/${id}`),
    test: (id: number) =>
      post<{ success: boolean; statusCode: number | null; error: string | null }>(
        `/api/notifications/${id}/test`,
      ),
    history: (configurationId?: number) =>
      get<import('./types').NotificationHistoryEntry[]>(
        `/api/notifications/history${query({ configurationId })}`,
      ),
  },
}
