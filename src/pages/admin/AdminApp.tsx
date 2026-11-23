import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import {
  BarChart3, CalendarDays, CalendarRange, Clock, CreditCard, ExternalLink, Gauge, LayoutGrid, ListChecks, LogOut, Menu, RefreshCw, Settings, ShieldCheck, SlidersHorizontal, Users, Wrench, X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { PageLoader } from '@/components/ui/misc';
import { RequireRole } from '@/components/layout/Guards';
import { Logo } from '@/components/layout/Logo';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { NotFoundPage } from '@/pages/Info';

const Overview = lazy(() => import('./Overview'));
const Schedule = lazy(() => import('./Schedule'));
const Bookings = lazy(() => import('./Bookings'));
const CalendarPage = lazy(() => import('./CalendarPage'));
const Courts = lazy(() => import('./Courts'));
const Customers = lazy(() => import('./Customers'));
const Payments = lazy(() => import('./Payments'));
const Pricing = lazy(() => import('./Pricing'));
const Hours = lazy(() => import('./Hours'));
const Blocks = lazy(() => import('./Blocks'));
const Reports = lazy(() => import('./Reports'));
const Staff = lazy(() => import('./Staff'));
const SettingsPage = lazy(() => import('./SettingsPage'));

interface NavItem { to: string; label: string; icon: typeof Gauge; adminOnly?: boolean; end?: boolean }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Operations', items: [
    { to: '/admin', label: 'Overview', icon: Gauge, end: true },
    { to: '/admin/schedule', label: 'Live Court Schedule', icon: LayoutGrid },
    { to: '/admin/bookings', label: 'Bookings', icon: ListChecks },
    { to: '/admin/calendar', label: 'Calendar', icon: CalendarDays },
    { to: '/admin/payments', label: 'Payments', icon: CreditCard },
    { to: '/admin/customers', label: 'Customers', icon: Users },
  ] },
  { group: 'Facility', items: [
    { to: '/admin/courts', label: 'Courts', icon: CalendarRange, adminOnly: true },
    { to: '/admin/pricing', label: 'Pricing & Rules', icon: SlidersHorizontal, adminOnly: true },
    { to: '/admin/hours', label: 'Operating Hours', icon: Clock, adminOnly: true },
    { to: '/admin/blocks', label: 'Maintenance & Blocks', icon: Wrench },
  ] },
  { group: 'Business', items: [
    { to: '/admin/reports', label: 'Reports', icon: BarChart3, adminOnly: true },
    { to: '/admin/staff', label: 'Staff & Permissions', icon: ShieldCheck, adminOnly: true },
    { to: '/admin/settings', label: 'Settings', icon: Settings, adminOnly: true },
  ] },
];

/**
 * Number of customer payments waiting to be checked, kept live. A new receipt
 * also pops a notice, so staff know someone just booked and paid.
 */
function usePendingPayments() {
  const toast = useToast();
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = async () => {
      const { count: n } = await supabase.from('payments').select('id', { count: 'exact', head: true }).eq('payment_status', 'pending');
      setCount(n ?? 0);
    };
    void load();
    const ch = supabase.channel('admin-pending-payments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, (e) => {
        void load();
        if (e.eventType === 'INSERT' && (e.new as { payment_status?: string }).payment_status === 'pending') {
          toast.info('New booking payment to check', 'A customer booked a slot and uploaded their receipt.');
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return count;
}

function Sidebar({ onNavigate, pending = 0 }: { onNavigate?: () => void; pending?: number }) {
  const { isAdmin, profile, signOut } = useAuth();
  const { settings } = useFacility();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between gap-2 px-5">
        <Link to="/admin" onClick={onNavigate}><Logo name={settings?.facility_name ?? "Nth Play"} dark /></Link>
        <NotificationBell tone="dark" />
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Admin">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.adminOnly || isAdmin);
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.group}</p>
              <ul className="mt-2 space-y-0.5">
                {items.map(({ to, label, icon: I, end }) => (
                  <li key={to}>
                    <NavLink to={to} end={end} onClick={onNavigate}
                      className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white')}>
                      <I className="size-4.5" aria-hidden />{label}
                      {to === '/admin/payments' && pending > 0 && (
                        <span className="ml-auto rounded-full bg-ball px-2 py-0.5 text-xs font-bold text-ink-900" aria-label={`${pending} waiting`}>{pending}</span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4 text-sm">
        <p className="truncate font-medium text-white">{profile?.full_name ?? profile?.email}</p>
        <p className="text-xs capitalize text-slate-400">{profile?.role}</p>
        <div className="mt-3 flex gap-2">
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10"><ExternalLink className="size-3.5" /> View site</Link>
          <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10"><LogOut className="size-3.5" /> Sign out</button>
        </div>
      </div>
    </div>
  );
}

const adminOnly = (el: ReactNode) => <RequireRole role="admin">{el}</RequireRole>;

export default function AdminApp() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const pending = usePendingPayments();
  return (
    <div className="min-h-dvh bg-slate-50 lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-ink-950 lg:block"><Sidebar pending={pending} /></aside>
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <div className="-ml-2 flex items-center">
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-2" aria-label="Open admin menu" aria-expanded={open}><Menu className="size-6" /></button>
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg p-2" aria-label="Reload page" title="Reload page"><RefreshCw className="size-5" /></button>
        </div>
        <span className="flex items-center gap-1"><span className="font-semibold">Admin</span><NotificationBell /></span>
        <Link to="/" className="text-sm text-brand-700">Site</Link>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-ink-950">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-lg p-1.5 text-slate-300" aria-label="Close menu"><X className="size-5" /></button>
            <Sidebar onNavigate={() => setOpen(false)} pending={pending} />
          </div>
        </div>
      )}
      <main id="main">
        {pending > 0 && loc.pathname !== '/admin/payments' && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 sm:px-6" role="status">
            <span className="font-semibold">{pending} payment{pending === 1 ? '' : 's'} waiting for you to check.</span>{' '}
            Verify the receipt, then confirm the booking.{' '}
            <Link to="/admin/payments" className="font-semibold underline">Review payments</Link>
          </div>
        )}
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route index element={<Overview />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="payments" element={<Payments />} />
            <Route path="customers" element={<Customers />} />
            <Route path="blocks" element={<Blocks />} />
            <Route path="courts" element={adminOnly(<Courts />)} />
            <Route path="pricing" element={adminOnly(<Pricing />)} />
            <Route path="hours" element={adminOnly(<Hours />)} />
            <Route path="reports" element={adminOnly(<Reports />)} />
            <Route path="staff" element={adminOnly(<Staff />)} />
            <Route path="settings" element={adminOnly(<SettingsPage />)} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
