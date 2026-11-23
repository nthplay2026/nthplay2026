import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { FacilityProvider } from '@/hooks/useFacility';
import { ToastProvider } from '@/components/ui/toast';
import { PageLoader } from '@/components/ui/misc';
import { SiteLayout } from '@/components/layout/SiteLayout';
import { RequireAuth, RequireRole } from '@/components/layout/Guards';
import { SESSION_EXPIRED_EVENT } from '@/lib/api';
import HomePage from '@/pages/Home';
import BookPage from '@/pages/Book';
import CourtDetailsPage from '@/pages/CourtDetails';
import CheckoutPage from '@/pages/Checkout';
import ConfirmationPage from '@/pages/Confirmation';
import MyBookingsPage from '@/pages/MyBookings';
import BookingDetailsPage from '@/pages/BookingDetails';
import { AccountPage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '@/pages/Auth';
import { ContactPage, NotFoundPage, PrivacyPage, TermsPage } from '@/pages/Info';

const AdminApp = lazy(() => import('@/pages/admin/AdminApp'));

function SessionWatcher() {
  const { signOut, recovering } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    const onExpired = async () => {
      await signOut();
      navigate(`/login?expired=1&next=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [signOut, navigate, loc]);
  // Arriving from a password-reset email: go straight to the reset form.
  useEffect(() => {
    if (recovering && loc.pathname !== '/reset-password') navigate('/reset-password', { replace: true });
  }, [recovering, loc.pathname, navigate]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <FacilityProvider>
            <SessionWatcher />
            <Routes>
              <Route path="/admin/*" element={
                <RequireRole role="staff">
                  <Suspense fallback={<PageLoader />}><AdminApp /></Suspense>
                </RequireRole>
              } />
              <Route element={<SiteLayout />}>
                <Route index element={<HomePage />} />
                <Route path="book" element={<BookPage />} />
                <Route path="courts/:id" element={<CourtDetailsPage />} />
                <Route path="checkout/:holdId" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
                <Route path="booking/:reference/confirmed" element={<RequireAuth><ConfirmationPage /></RequireAuth>} />
                <Route path="my-bookings" element={<RequireAuth><MyBookingsPage /></RequireAuth>} />
                <Route path="my-bookings/:reference" element={<RequireAuth><BookingDetailsPage /></RequireAuth>} />
                <Route path="account" element={<RequireAuth><AccountPage /></RequireAuth>} />
                <Route path="login" element={<LoginPage />} />
                <Route path="register" element={<RegisterPage />} />
                <Route path="forgot-password" element={<ForgotPasswordPage />} />
                <Route path="reset-password" element={<ResetPasswordPage />} />
                <Route path="contact" element={<ContactPage />} />
                <Route path="terms" element={<TermsPage />} />
                <Route path="privacy" element={<PrivacyPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </FacilityProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
