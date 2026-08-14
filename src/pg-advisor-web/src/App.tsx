import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/app/AuthContext'
import { EventsProvider } from '@/app/EventsContext'
import { ThemeProvider } from '@/app/ThemeContext'
import { AppShell } from '@/components/layout/AppShell'
import { LoadingBlock } from '@/components/ui/primitives'
import { LocaleProvider } from '@/lib/i18n'
import { DashboardPage } from '@/pages/DashboardPage'
import { FindingsPage } from '@/pages/FindingsPage'
import { InstanceDetailPage } from '@/pages/InstanceDetailPage'
import { InstancesPage } from '@/pages/InstancesPage'
import { LoginPage } from '@/pages/LoginPage'
import { QueriesPage } from '@/pages/QueriesPage'
import { RuleEditorPage } from '@/pages/RuleEditorPage'
import { RulesPage } from '@/pages/RulesPage'
import { UsersPage } from '@/pages/UsersPage'
import { WebhooksPage } from '@/pages/WebhooksPage'

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="bg-canvas grid min-h-dvh place-items-center">
        <LoadingBlock />
      </div>
    )
  }

  return user ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <LocaleProvider>
      <ThemeProvider>
        <AuthProvider>
          <EventsProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <Protected>
                    <AppShell />
                  </Protected>
                }
              >
                <Route path="/" element={<DashboardPage />} />
                <Route path="/instances" element={<InstancesPage />} />
                <Route path="/instances/:id" element={<InstanceDetailPage />} />
                <Route path="/findings" element={<FindingsPage />} />
                <Route path="/queries" element={<QueriesPage />} />
                <Route path="/rules" element={<RulesPage />} />
                <Route path="/rules/new" element={<RuleEditorPage />} />
                <Route path="/rules/:id" element={<RuleEditorPage />} />
                <Route path="/webhooks" element={<WebhooksPage />} />
                <Route path="/users" element={<UsersPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </EventsProvider>
        </AuthProvider>
      </ThemeProvider>
    </LocaleProvider>
  )
}
