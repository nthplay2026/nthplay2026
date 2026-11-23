import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { EmptyState, PageLoader } from '@/components/ui/misc';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** UI guard only — the database enforces the same rules on every request. */
export function RequireRole({ role, children }: { role: 'staff' | 'admin'; children: ReactNode }) {
  const { user, profile, loading } = useAuth();
  const loc = useLocation();
  if (loading || (user && !profile)) return <PageLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  const ok = role === 'staff' ? profile?.role === 'staff' || profile?.role === 'admin' : profile?.role === 'admin';
  if (!ok) {
    return (
      <div className="container-page py-16">
        <EmptyState icon={<ShieldAlert />} title={role === 'admin' ? 'Administrators only' : 'Staff only'}>
          Your account doesn't have access to this area. If you think this is a mistake, ask an administrator to update your role.
        </EmptyState>
      </div>
    );
  }
  return <>{children}</>;
}
