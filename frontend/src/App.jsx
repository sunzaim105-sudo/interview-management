import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Routes, Route, useParams } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import DashboardLayout from './components/dashboard/DashboardLayout';
import LandingPage from './pages/LandingPage';
import SignInPage from './pages/auth/SignInPage';
import SignUpPage from './pages/auth/SignUpPage';
import { useAuth } from './context/AuthContext';
import {
  INTERVIEW_DETAIL_ROLES,
  JOBS_ACCESS_ROLES,
  MAIL_ACCESS_ROLES,
  REPORT_ACCESS_ROLES,
  ROLE_HOME,
  SCHEDULE_ACCESS_ROLES,
  SETTINGS_ACCESS_ROLES,
  TEAM_ACCESS_ROLES,
  USERS_ACCESS_ROLES,
} from './lib/roles';

const SchedulePage = lazy(() => import('./pages/dashboard/SchedulePage'));
const ProfilePage = lazy(() => import('./pages/dashboard/ProfilePage'));
const ReportPage = lazy(() => import('./pages/dashboard/ReportPage'));
const UsersPage = lazy(() => import('./pages/dashboard/UsersPage'));
const TeamManagementPage = lazy(
  () => import('./pages/dashboard/TeamManagementPage'),
);
const TeamMemberDetailPage = lazy(
  () => import('./pages/dashboard/TeamMemberDetailPage'),
);
const JobsPage = lazy(() => import('./pages/dashboard/JobsPage'));
const JobDetailPage = lazy(() => import('./pages/dashboard/JobDetailPage'));
const MailPage = lazy(() => import('./pages/dashboard/MailPage'));
const MailThreadPage = lazy(() => import('./pages/dashboard/MailThreadPage'));
const SettingsPage = lazy(() => import('./pages/dashboard/SettingsPage'));

function PageFallback() {
  return (
    <div className="auth-loading">
      <p>Loading...</p>
    </div>
  );
}

function LegacyJobRedirect() {
  const { jobId } = useParams();
  return <Navigate to={`/dashboard/jobs/${jobId}`} replace />;
}

function DashboardIndexRedirect() {
  const { profile } = useAuth();
  const home = ROLE_HOME[profile?.user_role] || '/dashboard/schedule';
  return <Navigate to={home.replace(/^\/dashboard\/?/, '') || 'schedule'} replace />;
}

function Lazy({ children }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardIndexRedirect />} />
            <Route
              path="schedule"
              element={
                <ProtectedRoute roles={SCHEDULE_ACCESS_ROLES}>
                  <Lazy>
                    <SchedulePage />
                  </Lazy>
                </ProtectedRoute>
              }
            />
            <Route
              path="profile"
              element={
                <Lazy>
                  <ProfilePage />
                </Lazy>
              }
            />
            <Route
              path="report"
              element={
                <ProtectedRoute roles={REPORT_ACCESS_ROLES}>
                  <Lazy>
                    <ReportPage />
                  </Lazy>
                </ProtectedRoute>
              }
            />
            <Route
              path="team"
              element={
                <ProtectedRoute roles={TEAM_ACCESS_ROLES}>
                  <Lazy>
                    <TeamManagementPage />
                  </Lazy>
                </ProtectedRoute>
              }
            />
            <Route
              path="team/members/:memberId"
              element={
                <ProtectedRoute roles={INTERVIEW_DETAIL_ROLES}>
                  <Lazy>
                    <TeamMemberDetailPage />
                  </Lazy>
                </ProtectedRoute>
              }
            />
            <Route
              path="mail"
              element={
                <ProtectedRoute roles={MAIL_ACCESS_ROLES}>
                  <Lazy>
                    <MailPage />
                  </Lazy>
                </ProtectedRoute>
              }
            />
            <Route
              path="mail/t/:threadId"
              element={
                <ProtectedRoute roles={MAIL_ACCESS_ROLES}>
                  <Lazy>
                    <MailThreadPage />
                  </Lazy>
                </ProtectedRoute>
              }
            />
            <Route
              path="jobs"
              element={
                <ProtectedRoute roles={JOBS_ACCESS_ROLES}>
                  <Lazy>
                    <JobsPage />
                  </Lazy>
                </ProtectedRoute>
              }
            />
            <Route
              path="jobs/:jobId"
              element={
                <ProtectedRoute roles={INTERVIEW_DETAIL_ROLES}>
                  <Lazy>
                    <JobDetailPage />
                  </Lazy>
                </ProtectedRoute>
              }
            />
            <Route path="team/jobs/:jobId" element={<LegacyJobRedirect />} />
            <Route
              path="users"
              element={
                <ProtectedRoute roles={USERS_ACCESS_ROLES}>
                  <Lazy>
                    <UsersPage />
                  </Lazy>
                </ProtectedRoute>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedRoute roles={SETTINGS_ACCESS_ROLES}>
                  <Lazy>
                    <SettingsPage />
                  </Lazy>
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="/admin" element={<Navigate to="/dashboard/schedule" replace />} />
          <Route path="/caller" element={<Navigate to="/dashboard/schedule" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
