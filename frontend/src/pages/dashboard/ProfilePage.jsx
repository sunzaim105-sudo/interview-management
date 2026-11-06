import { useAuth } from '../../context/AuthContext';
import UserMenu from '../../components/dashboard/UserMenu';
import './ProfilePage.css';

function ProfilePage() {
  const { profile } = useAuth();

  const fields = [
    { label: 'Username', value: profile?.username || '—' },
    { label: 'User ID', value: profile?.user_id || '—' },
    { label: 'Email', value: profile?.email || '—' },
    { label: 'Role', value: formatRole(profile?.user_role) },
    { label: 'Status', value: formatStatus(profile?.status) },
  ];

  return (
    <div className="profile-page">
      <header className="profile-page__header">
        <div>
          <h1>Profile</h1>
          <p>Your account information for Cal.ID.</p>
        </div>
        <UserMenu />
      </header>

      <section className="profile-page__card" aria-label="Account details">
        <div className="profile-page__identity">
          <div className="profile-page__avatar" aria-hidden="true">
            {getInitials(profile?.username)}
          </div>
          <div>
            <h2>{profile?.username || 'User'}</h2>
            <p>{profile?.user_id}</p>
          </div>
        </div>

        <dl className="profile-page__fields">
          {fields.map((field) => (
            <div key={field.label} className="profile-page__field">
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function getInitials(name = '') {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'U'
  );
}

function formatRole(role) {
  if (!role) return '—';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatStatus(status) {
  if (!status) return '—';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default ProfilePage;
