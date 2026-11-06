import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canAccessRole, ROLE_HOME } from '../../lib/roles';

function ProtectedRoute({ children, roles = [] }) {
  const { loading, isAuthenticated, profile } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-loading">
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }

  if (roles.length && !canAccessRole(profile.user_role, roles)) {
    const home = ROLE_HOME[profile?.user_role] || '/dashboard/schedule';
    if (location.pathname === home || location.pathname.startsWith(`${home}/`)) {
      return (
        <div className="auth-loading">
          <p>You do not have access to this page.</p>
        </div>
      );
    }
    return <Navigate to={home} replace />;
  }

  return children;
}

export default ProtectedRoute;
