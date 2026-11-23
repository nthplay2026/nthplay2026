import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { CalendarCheck, LayoutDashboard, LogOut, Mail, MapPin, Menu, Phone, RefreshCw, UserRound, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { supabaseConfigured } from '@/lib/supabase';
import { Logo } from './Logo';
import { InstallAppButton } from './InstallApp';
import { FacebookIcon, InstagramIcon, PhoneButton } from './ContactButtons';
import { NotificationBell } from './NotificationBell';
import { FACEBOOK_NAME, FACEBOOK_URL, INSTAGRAM_HANDLE, INSTAGRAM_URL } from '@/lib/contact';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/book', label: 'Book a Court' },
  { to: '/my-bookings', label: 'My Bookings' },
  { to: '/contact', label: 'Contact' },
];

export function SiteHeader() {
  const { user, profile, isStaff, signOut } = useAuth();
  const { settings } = useFacility();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cn('whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive ? 'text-brand-700' : 'text-ink-700 hover:text-ink-900');

  const handleSignOut = async () => { await signOut(); navigate('/'); };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link to="/" className="shrink-0" aria-label={`${settings?.facility_name ?? "Nth Play"} home`}>
          <Logo name={settings?.facility_name ?? "Nth Play"} />
        </Link>
        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={linkCls}>{n.label}</NavLink>)}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <InstallAppButton className="hidden xl:inline-flex" />
          <NotificationBell />
          {isStaff && (
            <Link to="/admin" className={buttonVariants({ variant: 'ghost', size: 'sm' })}><LayoutDashboard /> Admin</Link>
          )}
          {user ? (
            <>
              <Link to="/account" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                <UserRound /> {profile?.full_name?.split(' ')[0] ?? 'Account'}
              </Link>
              <Button variant="outline" size="sm" onClick={handleSignOut} aria-label="Sign out" title="Sign out"><LogOut /><span className="hidden xl:inline">Sign out</span></Button>
            </>
          ) : (
            <Link to="/login" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Log in</Link>
          )}
          <Link to="/book" className={buttonVariants({ size: 'sm' })}><CalendarCheck /> Book now</Link>
        </div>
        <div className="-mr-2 flex items-center gap-1 lg:hidden">
          <NotificationBell />
          <button type="button" className="rounded-lg p-2 text-ink-800" aria-label="Reload page" title="Reload page" onClick={() => window.location.reload()}>
            <RefreshCw className="size-5" />
          </button>
          <button type="button" className="rounded-lg p-2 text-ink-800" aria-expanded={open} aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" className="border-t border-slate-200 bg-white lg:hidden" aria-label="Main">
          <div className="container-page flex flex-col gap-1 py-3">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn('rounded-lg px-3 py-3 text-base font-medium', isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-800')}>
                {n.label}
              </NavLink>
            ))}
            {isStaff && <NavLink to="/admin" className="rounded-lg px-3 py-3 text-base font-medium text-ink-800">Admin dashboard</NavLink>}
            <InstallAppButton variant="outline" className="mt-1 h-11 justify-center text-base" label="Install the app" />
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
              {user ? (
                <>
                  <Link to="/account" className={buttonVariants({ variant: 'outline' })}>Account</Link>
                  <Button variant="outline" onClick={handleSignOut}>Sign out</Button>
                </>
              ) : (
                <>
                  <Link to="/login" className={buttonVariants({ variant: 'outline' })}>Log in</Link>
                  <Link to="/register" className={buttonVariants({ variant: 'secondary' })}>Sign up</Link>
                </>
              )}
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  const { settings } = useFacility();
  const year = new Date().getFullYear();
  return (
    <footer className="mt-20 bg-ink-900 text-slate-300">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo name={settings?.facility_name ?? "Nth Play"} dark />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">{settings?.tagline}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Visit us</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {settings?.address && <li><a className="flex gap-2.5 hover:text-white" href={settings.map_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}`} target="_blank" rel="noreferrer"><MapPin className="mt-0.5 size-4 shrink-0 text-ball" aria-hidden />{settings.address}</a></li>}
            {settings?.contact_phone && (
              <li>
                <PhoneButton phone={settings.contact_phone} className="flex gap-2.5 text-left hover:text-white">
                  <Phone className="mt-0.5 size-4 shrink-0 text-ball" aria-hidden />{settings.contact_phone}
                </PhoneButton>
              </li>
            )}
            <li><a className="flex gap-2.5 hover:text-white" href={FACEBOOK_URL} target="_blank" rel="noreferrer"><FacebookIcon className="mt-0.5 size-4 shrink-0 text-ball" />Facebook: {FACEBOOK_NAME}</a></li>
            <li><a className="flex gap-2.5 hover:text-white" href={INSTAGRAM_URL} target="_blank" rel="noreferrer"><InstagramIcon className="mt-0.5 size-4 shrink-0 text-ball" />Instagram: {INSTAGRAM_HANDLE}</a></li>
            {settings?.contact_email && <li><a className="flex gap-2.5 hover:text-white" href={`mailto:${settings.contact_email}`}><Mail className="mt-0.5 size-4 shrink-0 text-ball" aria-hidden />{settings.contact_email}</a></li>}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Explore</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link className="hover:text-white" to="/book">Book a court</Link></li>
            <li><Link className="hover:text-white" to="/my-bookings">My bookings</Link></li>
            <li><Link className="hover:text-white" to="/contact">Location &amp; operating hours</Link></li>
            <li><Link className="hover:text-white" to="/party-rules">Parties &amp; events</Link></li>
            <li><Link className="hover:text-white" to="/terms">Terms &amp; booking policy</Link></li>
            <li><Link className="hover:text-white" to="/privacy">Privacy policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="container-page py-5 text-xs text-slate-500">© {year} {settings?.facility_name ?? "Nth Play"}. All rights reserved.</p>
      </div>
    </footer>
  );
}

export function SiteLayout() {
  const { error } = useFacility();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lift">Skip to content</a>
      <SiteHeader />
      {!supabaseConfigured && (
        <div className="container-page pt-4">
          <Alert tone="warning" title="Supabase is not configured">
            Copy <code>.env.example</code> to <code>.env</code> and set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
          </Alert>
        </div>
      )}
      {supabaseConfigured && error && (
        <div className="container-page pt-4"><Alert tone="error" title="We couldn't load the facility details">{error}</Alert></div>
      )}
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
