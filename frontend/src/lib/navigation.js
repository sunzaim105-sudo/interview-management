import { DASHBOARD_HOME, ROLES } from './roles';

export { DASHBOARD_HOME };

export const NAV_ITEMS = [
  {
    id: 'schedule',
    label: 'Schedule',
    path: '/dashboard/schedule',
    roles: [ROLES.ADMIN, ROLES.CALLER, ROLES.TEAM_MEMBER],
  },
  {
    id: 'report',
    label: 'Report',
    path: '/dashboard/report',
    roles: [ROLES.ADMIN, ROLES.CALLER, ROLES.TEAM_MEMBER],
  },
  {
    id: 'team',
    label: 'Team',
    path: '/dashboard/team',
    roles: [ROLES.ADMIN, ROLES.CALLER, ROLES.TEAM_MEMBER],
  },
  {
    id: 'mail',
    label: 'Mail',
    path: '/dashboard/mail',
    roles: [ROLES.ADMIN, ROLES.TEAM_MEMBER],
  },
  {
    id: 'jobs',
    label: 'Jobs',
    path: '/dashboard/jobs',
    roles: [ROLES.ADMIN, ROLES.CALLER, ROLES.TEAM_MEMBER],
  },
  {
    id: 'users',
    label: 'Users',
    path: '/dashboard/users',
    roles: [ROLES.ADMIN],
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/dashboard/settings',
    roles: [ROLES.ADMIN, ROLES.TEAM_MEMBER],
  },
];

export function getNavItemsForRole(role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
