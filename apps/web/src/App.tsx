import { Route, Routes } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { GuestOnly, RequireAuth } from '@/components/route-guards';
import { AirlineScopeProvider } from '@/lib/airline-scope';
import { AuthCallbackPage } from '@/pages/auth/auth-callback-page';
import { ForgotPasswordPage } from '@/pages/auth/forgot-password-page';
import { ResetPasswordPage } from '@/pages/auth/reset-password-page';
import { SignInPage } from '@/pages/auth/sign-in-page';
import { SignUpPage } from '@/pages/auth/sign-up-page';
import { DashboardPage } from '@/pages/dashboard-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { PublicHomePage } from '@/pages/public-home-page';
import { SettingsPage } from '@/pages/settings-page';

export function App() {
  return (
    <Routes>
      <Route path="bienvenida" element={<PublicHomePage />} />
      <Route path="auth/callback" element={<AuthCallbackPage />} />
      <Route path="restablecer" element={<ResetPasswordPage />} />

      <Route element={<GuestOnly />}>
        <Route path="entrar" element={<SignInPage />} />
        <Route path="registro" element={<SignUpPage />} />
        <Route path="recuperar" element={<ForgotPasswordPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route
          element={
            <AirlineScopeProvider>
              <AppShell />
            </AirlineScopeProvider>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
