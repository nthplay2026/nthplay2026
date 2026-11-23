import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';

export function AdminPage({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  useEffect(() => { document.title = `${title} · Admin`; }, [title]);
  const loc = useLocation();
  const navigate = useNavigate();
  // Back to wherever the admin came from (the overview when opened directly).
  const back = () => (loc.key !== 'default' ? navigate(-1) : navigate('/admin'));
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {loc.pathname !== '/admin' && (
        <button type="button" onClick={back} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-ink-900">
          <ArrowLeft className="size-4" aria-hidden /> Back
        </button>
      )}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
