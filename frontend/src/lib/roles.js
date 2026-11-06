export const ROLES = {
  ADMIN: 'admin',
  CALLER: 'caller',
  TEAM_MEMBER: 'team_member',
};

export const ROLE_OPTIONS = [
  { id: ROLES.ADMIN, label: 'Admin' },
  { id: ROLES.CALLER, label: 'Caller' },
  { id: ROLES.TEAM_MEMBER, label: 'Team member' },
];

export const USER_STATUS = {
  PENDING: 'pending',
  ALLOWED: 'allowed',
  SUSPENDED: 'suspended',
  BLOCKED: 'blocked',
};

export const PERMISSION_OPTIONS = [
  { id: USER_STATUS.ALLOWED, label: 'Allowed' },
  { id: USER_STATUS.SUSPENDED, label: 'Suspended' },
  { id: USER_STATUS.BLOCKED, label: 'Blocked' },
  { id: USER_STATUS.PENDING, label: 'Pending' },
];

export const DASHBOARD_HOME = '/dashboard/schedule';

export const ROLE_HOME = {
  [ROLES.ADMIN]: DASHBOARD_HOME,
  [ROLES.CALLER]: DASHBOARD_HOME,
  [ROLES.TEAM_MEMBER]: DASHBOARD_HOME,
};

/** Tab access */
export const SCHEDULE_ACCESS_ROLES = [
  ROLES.ADMIN,
  ROLES.CALLER,
  ROLES.TEAM_MEMBER,
];
export const REPORT_ACCESS_ROLES = [
  ROLES.ADMIN,
  ROLES.CALLER,
  ROLES.TEAM_MEMBER,
];
export const TEAM_ACCESS_ROLES = [
  ROLES.ADMIN,
  ROLES.CALLER,
  ROLES.TEAM_MEMBER,
];
export const JOBS_ACCESS_ROLES = [
  ROLES.ADMIN,
  ROLES.CALLER,
  ROLES.TEAM_MEMBER,
];
/** Settings Gmail status: admins manage; team members view-only. */
export const SETTINGS_ACCESS_ROLES = [ROLES.ADMIN, ROLES.TEAM_MEMBER];
/** Mail: admins manage; team members read-only (same mailbox data as admin). */
export const MAIL_ACCESS_ROLES = [ROLES.ADMIN, ROLES.TEAM_MEMBER];
export const USERS_ACCESS_ROLES = [ROLES.ADMIN];

/** @deprecated use SCHEDULE_ACCESS_ROLES / REPORT_ACCESS_ROLES */
export const INTERVIEW_ACCESS_ROLES = SCHEDULE_ACCESS_ROLES;

/** Detail pages for jobs / team members linked from interviews. */
export const INTERVIEW_DETAIL_ROLES = [
  ROLES.ADMIN,
  ROLES.CALLER,
  ROLES.TEAM_MEMBER,
];

export function canAccessRole(userRole, allowedRoles = []) {
  if (!userRole) return false;
  if (!allowedRoles.length) return true;
  return allowedRoles.includes(userRole);
}

export function isAdminRole(userRole) {
  return userRole === ROLES.ADMIN;
}

export function isCallerRole(userRole) {
  return userRole === ROLES.CALLER;
}

export function isTeamMemberRole(userRole) {
  return userRole === ROLES.TEAM_MEMBER;
}

/**
 * Only admins can create / update / delete workspace data
 * (schedule, team, jobs, report stage/results, Gmail connect/sync).
 * Team members may view the same data read-only.
 */
export function canEditWorkspace(userRole) {
  return userRole === ROLES.ADMIN;
}

/**
 * Interviews / report query scope (client-side):
 * - admin → ALL interviews (never scoped)
 * - team_member → ALL interviews (never scoped to self)
 * - caller → only interviews where they are the assigned caller
 */
export function interviewCallerScopeId(profile) {
  if (!profile) return null;
  if (profile.user_role === ROLES.CALLER) return profile.id;
  return null;
}

/** Admin-only Mail mutations: connect, sync, disconnect, star, trash, link. */
export function canManageMail(userRole) {
  return userRole === ROLES.ADMIN;
}

export function canDeleteMail(userRole) {
  return userRole === ROLES.ADMIN;
}

/** Admins and team members may read the shared mailbox. */
export function canReadMail(userRole) {
  return MAIL_ACCESS_ROLES.includes(userRole);
}

export function formatRoleLabel(role) {
  return ROLE_OPTIONS.find((item) => item.id === role)?.label || role || '—';
}

export function formatPermissionLabel(status) {
  return (
    PERMISSION_OPTIONS.find((item) => item.id === status)?.label ||
    status ||
    '—'
  );
}
