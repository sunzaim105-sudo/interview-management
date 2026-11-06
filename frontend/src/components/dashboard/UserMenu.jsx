import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isAdminRole } from '../../lib/roles';
import './UserMenu.css';

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

function UserMenu() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = isAdminRole(profile?.user_role);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function goTo(path) {
    setOpen(false);
    navigate(path);
  }

  async function handleLogout() {
    setOpen(false);
    await signOut();
    navigate('/signin', { replace: true });
  }

  return (
    <div className={`user-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="user-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={profile?.email || 'Account menu'}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="user-menu__avatar" aria-hidden="true">
          {getInitials(profile?.username)}
        </span>
        <span className="user-menu__chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>

      {open ? (
        <div className="user-menu__dropdown" id={menuId} role="menu">
          <button
            type="button"
            className="user-menu__item"
            role="menuitem"
            onClick={() => goTo('/dashboard/profile')}
          >
            <ProfileIcon />
            <span>Profile</span>
          </button>
          {isAdmin ? (
            <button
              type="button"
              className="user-menu__item"
              role="menuitem"
              onClick={() => goTo('/dashboard/settings')}
            >
              <SettingsIcon />
              <span>Settings</span>
            </button>
          ) : null}
          <div className="user-menu__divider" role="separator" />
          <button
            type="button"
            className="user-menu__item user-menu__item--danger"
            role="menuitem"
            onClick={handleLogout}
          >
            <LogoutIcon />
            <span>Logout</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 19c1.8-3.2 4.2-4.8 7-4.8S17.2 15.8 19 19"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 7V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M3 12h11M10 8l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default UserMenu;
