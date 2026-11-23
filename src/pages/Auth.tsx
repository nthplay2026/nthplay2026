import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useFacility } from '@/hooks/useFacility';
import { loginSchema, passwordSchema, profileSchema, registerSchema, type LoginValues, type ProfileValues, type RegisterValues } from '@/lib/schemas';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert, Card, PageLoader } from '@/components/ui/misc';
import { BrandMark } from '@/components/layout/Logo';
import { useToast } from '@/components/ui/toast';

/** Only allow same-site relative redirects. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/my-bookings';
}

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="container-page flex justify-center py-12 sm:py-16">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <BrandMark className="mx-auto size-16 rounded-2xl" />
          <h1 className="mt-4 text-2xl font-bold text-ink-900 sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-slate-600">{subtitle}</p>}
        </div>
        <Card className="p-6 sm:p-8">{children}</Card>
        {footer && <div className="mt-5 text-center text-sm text-slate-600">{footer}</div>}
      </div>
    </div>
  );
}

const authMessage = (msg: string) =>
  /invalid login credentials/i.test(msg) ? 'Incorrect email or password.'
    : /email not confirmed/i.test(msg) ? 'Please confirm your email address first — check your inbox for the link.'
      : /already registered|already exists/i.test(msg) ? 'An account with this email already exists. Try logging in instead.'
        : /rate limit|too many/i.test(msg) ? 'Too many attempts. Please wait a minute and try again.'
          : msg;

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  if (loading) return <PageLoader />;
  if (user) return <Navigate to={next} replace />;

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password });
    if (e) { setError(authMessage(e.message)); return; }
    navigate(next, { replace: true });
  });

  return (
    <AuthShell title="Welcome back" subtitle={params.get('reason') === 'book' ? 'Log in to reserve your court — your selection is saved.' : 'Log in to manage your bookings.'}
      footer={<>New here? <Link className="font-semibold text-brand-700 hover:underline" to={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {params.get('expired') && <Alert tone="warning">Your session expired. Please log in again.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Email" error={errors.email?.message}><Input type="email" autoComplete="email" {...register('email')} /></Field>
        <Field label="Password" error={errors.password?.message}><Input type="password" autoComplete="current-password" {...register('password')} /></Field>
        <div className="text-right"><Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">Forgot password?</Link></div>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Log in</Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  if (loading) return <PageLoader />;
  if (user && !checkEmail) return <Navigate to={next} replace />;

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const { data, error: e } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: {
        data: { full_name: v.fullName, mobile_number: v.mobile },
        emailRedirectTo: `${window.location.origin}${next}`,
      },
    });
    if (e) { setError(authMessage(e.message)); return; }
    if (data.session) navigate(next, { replace: true });
    else setCheckEmail(v.email);
  });

  if (checkEmail) {
    return (
      <AuthShell title="Check your email">
        <div className="text-center">
          <MailCheck className="mx-auto size-10 text-brand-600" aria-hidden />
          <p className="mt-4 text-ink-800">We sent a confirmation link to <strong>{checkEmail}</strong>. Open it to activate your account, then come back to book.</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Book faster and manage your reservations in one place."
      footer={<>Already have an account? <Link className="font-semibold text-brand-700 hover:underline" to={`/login?next=${encodeURIComponent(next)}`}>Log in</Link></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Full name" required error={errors.fullName?.message}><Input autoComplete="name" {...register('fullName')} /></Field>
        <Field label="Email" required error={errors.email?.message}><Input type="email" autoComplete="email" {...register('email')} /></Field>
        <Field label="Mobile number" required error={errors.mobile?.message}><Input type="tel" autoComplete="tel" placeholder="0917 123 4567" {...register('mobile')} /></Field>
        <Field label="Password" required error={errors.password?.message} hint="At least 8 characters."><Input type="password" autoComplete="new-password" {...register('password')} /></Field>
        <Field label="Confirm password" required error={errors.confirm?.message}><Input type="password" autoComplete="new-password" {...register('confirm')} /></Field>
        <p className="text-xs text-slate-500">By creating an account you agree to our <Link to="/terms" className="underline">terms</Link> and <Link to="/privacy" className="underline">privacy policy</Link>.</p>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: z.string().trim().email('Please enter a valid email address.') })),
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: `${window.location.origin}/reset-password` });
    // Same message whether or not the account exists (prevents account discovery).
    if (e && /rate limit|too many/i.test(e.message)) { setError(authMessage(e.message)); return; }
    setSent(true);
  });
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new password."
      footer={<Link className="font-semibold text-brand-700 hover:underline" to="/login">Back to log in</Link>}>
      {sent ? (
        <Alert tone="success" title="Check your inbox">If an account exists for that email, a reset link is on its way. The link expires after a short time.</Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email" error={errors.email?.message}><Input type="email" autoComplete="email" {...register('email')} /></Field>
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { session, loading, clearRecovering } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match.', path: ['confirm'] });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  if (loading) return <PageLoader />;
  if (!session) {
    return (
      <AuthShell title="Link expired" footer={<Link className="font-semibold text-brand-700 hover:underline" to="/forgot-password">Request a new link</Link>}>
        <Alert tone="warning">This password reset link is invalid or has expired.</Alert>
      </AuthShell>
    );
  }
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await supabase.auth.updateUser({ password: v.password });
    if (e) { setError(authMessage(e.message)); return; }
    clearRecovering();
    toast.success('Password updated', 'You can now use your new password.');
    navigate('/my-bookings', { replace: true });
  });
  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="New password" error={errors.password?.message} hint="At least 8 characters."><Input type="password" autoComplete="new-password" {...register('password')} /></Field>
        <Field label="Confirm new password" error={errors.confirm?.message}><Input type="password" autoComplete="new-password" {...register('confirm')} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Update password</Button>
      </form>
    </AuthShell>
  );
}

export function AccountPage() {
  const { user, profile, refreshProfile } = useAuth();
  const { settings } = useFacility();
  const toast = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty }, reset } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: { full_name: profile?.full_name ?? '', mobile_number: profile?.mobile_number ?? '' },
  });
  const pwSchema = z.object({ password: passwordSchema });
  const pw = useForm<{ password: string }>({ resolver: zodResolver(pwSchema) });

  const save = handleSubmit(async (v) => {
    try {
      await api.updateMyProfile(user!.id, v);
      await refreshProfile();
      reset(v);
      toast.success('Profile saved');
    } catch (e) {
      toast.error("Couldn't save", errorMessage(e));
    }
  });
  const changePw = pw.handleSubmit(async (v) => {
    const { error } = await supabase.auth.updateUser({ password: v.password });
    if (error) toast.error("Couldn't change password", authMessage(error.message));
    else { toast.success('Password changed'); pw.reset({ password: '' }); }
  });

  return (
    <div className="container-page max-w-2xl py-8 sm:py-10">
      <h1 className="text-3xl font-bold text-ink-900">Your account</h1>
      <p className="mt-1 text-slate-600">Signed in as <strong>{user?.email}</strong>{profile && profile.role !== 'customer' && <> · <span className="capitalize">{profile.role}</span></>}</p>
      <Card className="mt-6 p-6">
        <h2 className="text-lg font-semibold">Profile</h2>
        <p className="text-sm text-slate-600">Used to pre-fill your bookings so {settings?.facility_name ?? 'we'} can reach you.</p>
        <form onSubmit={save} noValidate className="mt-5 space-y-4">
          <Field label="Full name" error={errors.full_name?.message}><Input autoComplete="name" {...register('full_name')} /></Field>
          <Field label="Mobile number" error={errors.mobile_number?.message}><Input type="tel" autoComplete="tel" {...register('mobile_number')} /></Field>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save changes</Button>
        </form>
      </Card>
      <Card className="mt-6 p-6">
        <h2 className="text-lg font-semibold">Change password</h2>
        <form onSubmit={changePw} noValidate className="mt-5 space-y-4">
          <Field label="New password" error={pw.formState.errors.password?.message} hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" {...pw.register('password')} />
          </Field>
          <Button type="submit" variant="outline" loading={pw.formState.isSubmitting}>Update password</Button>
        </form>
      </Card>
    </div>
  );
}
