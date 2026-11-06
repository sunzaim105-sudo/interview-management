import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import UserMenu from '../../components/dashboard/UserMenu';
import { useAuth } from '../../context/AuthContext';
import {
  formatMailDate,
  senderLabel,
} from '../../lib/mailHelpers';
import {
  fetchMailBootstrap,
  fetchMailThreads,
  markMailThreadSeen,
  starMailThread,
  syncAllGmailAccounts,
  trashMailThreadRefs,
} from '../../lib/mailApi';
import { canDeleteMail, canManageMail } from '../../lib/roles';
import './MailPage.css';

const PAGE_SIZE = 40;

const FOLDERS = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'starred', label: 'Starred', icon: 'star' },
  { id: 'sent', label: 'Sent', icon: 'send' },
  { id: 'all', label: 'All mail', icon: 'all' },
];

const DATE_WITHIN_OPTIONS = [
  { value: '1d', label: '1 day' },
  { value: '3d', label: '3 days' },
  { value: '1w', label: '1 week' },
  { value: '2w', label: '2 weeks' },
  { value: '1m', label: '1 month' },
  { value: '2m', label: '2 months' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: '1 year' },
];

const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'from_asc', label: 'From A–Z' },
];

const EMPTY_FILTER = {
  from: '',
  to: '',
  subject: '',
  hasWords: '',
  dateWithin: '1d',
  date: '',
};

function FolderIcon({ type }) {
  if (type === 'star') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 17.3l-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z" />
      </svg>
    );
  }
  if (type === 'send') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
      </svg>
    );
  }
  if (type === 'all') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 3H5a2 2 0 00-2 2v14l4-4h12a2 2 0 002-2V5a2 2 0 00-2-2z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.65 6.35A7.95 7.95 0 0012 4a8 8 0 00-8 8h2a6 6 0 016-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35zM6.35 17.65A7.95 7.95 0 0012 20a8 8 0 008-8h-2a6 6 0 01-6 6c-1.66 0-3.14-.69-4.22-1.78L11 13H4v7l2.35-2.35z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

function MarkReadIcon({ unread }) {
  if (unread) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 8.98V18c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h10.1c-.06.32-.1.66-.1 1 0 1.48.65 2.79 1.67 3.71L12 13 4 8v10h16V8.98c.7-.15 1.34-.48 1.87-.93.07.3.13.6.13.93zM20 6c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2z" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 11h10v2H7zm-4 5h18v2H3zm6-10h6v2H9z" />
    </svg>
  );
}

function buildQueryFromFilters(filters) {
  const parts = [];
  if (filters.from.trim()) parts.push(`from:(${filters.from.trim()})`);
  if (filters.to.trim()) parts.push(`to:(${filters.to.trim()})`);
  if (filters.subject.trim()) parts.push(`subject:(${filters.subject.trim()})`);
  if (filters.hasWords.trim()) parts.push(filters.hasWords.trim());
  return parts.join(' ');
}

function MailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterRef = useRef(null);
  const { profile } = useAuth();
  const isMailAdmin = canManageMail(profile?.user_role);
  const canDelete = canDeleteMail(profile?.user_role);

  const [teamMembers, setTeamMembers] = useState([]);
  const [connections, setConnections] = useState([]);
  const [memberFilter, setMemberFilter] = useState('');
  const [folder, setFolder] = useState('inbox');
  const [query, setQuery] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTER);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sort, setSort] = useState('date_desc');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [threads, setThreads] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const connectedCount = useMemo(
    () => connections.filter((row) => row.connected).length,
    [connections],
  );

  const allSelected =
    threads.length > 0 && threads.every((thread) => selected.has(thread.id));
  const someSelected = selected.size > 0;

  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);
  const rangeLabel = total ? `${rangeStart}–${rangeEnd} of ${total}` : '0–0';
  const canPrev = page > 0;
  const canNext = (page + 1) * PAGE_SIZE < total;

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchMailBootstrap();
      setTeamMembers(data.teamMembers || []);
      setConnections(data.connections || []);
    } catch (err) {
      setError(err.message || 'Failed to load mail.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    const gmailError = searchParams.get('gmail_error');
    if (gmailError) {
      setError(decodeURIComponent(gmailError));
      navigate('/dashboard/mail', { replace: true });
    }
  }, [searchParams, navigate]);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [folder, query, unreadOnly, memberFilter, sort, appliedFilters]);

  const loadThreads = useCallback(async () => {
    if (!connectedCount) {
      setThreads([]);
      setTotal(0);
      return;
    }
    setListLoading(true);
    setError('');
    try {
      const data = await fetchMailThreads({
        folder,
        q: query,
        page,
        pageSize: PAGE_SIZE,
        unreadOnly,
        teamMemberId: memberFilter,
        sort,
        from: appliedFilters.from,
        to: appliedFilters.to,
        subject: appliedFilters.subject,
        hasWords: appliedFilters.hasWords,
        dateWithin: appliedFilters.date ? appliedFilters.dateWithin : '',
        date: appliedFilters.date,
      });
      setThreads(data.threads || []);
      setTotal(Number(data.total || data.threads?.length || 0));
      setSelected(new Set());
    } catch (err) {
      setError(err.message || 'Failed to load messages.');
    } finally {
      setListLoading(false);
    }
  }, [
    connectedCount,
    folder,
    query,
    page,
    unreadOnly,
    memberFilter,
    sort,
    appliedFilters,
  ]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!connectedCount || !isMailAdmin) return undefined;
    // Incremental only, infrequent — never Full sync on a timer (quota).
    const timer = setInterval(() => {
      syncAllGmailAccounts({ full: false })
        .then((result) => {
          if (result?.errorCount) return;
          return loadThreads();
        })
        .catch(() => {});
    }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [connectedCount, loadThreads, isMailAdmin]);

  useEffect(() => {
    if (!filterOpen) return undefined;
    function onPointerDown(event) {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [filterOpen]);

  function openThread(thread) {
    const account = thread.accountId || '';
    navigate(
      `/dashboard/mail/t/${encodeURIComponent(thread.id)}?account=${encodeURIComponent(account)}`,
    );
  }

  function applySearch(nextDraft = searchDraft) {
    setQuery(nextDraft.trim());
    setFilterOpen(false);
  }

  function applyAdvancedFilter(event) {
    event.preventDefault();
    setAppliedFilters({ ...filters });
    const built = buildQueryFromFilters(filters);
    setSearchDraft(built);
    setQuery(built);
    setFilterOpen(false);
  }

  function clearAdvancedFilter() {
    setFilters(EMPTY_FILTER);
    setAppliedFilters(EMPTY_FILTER);
    setSearchDraft('');
    setQuery('');
    setFilterOpen(false);
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(threads.map((thread) => thread.id)));
  }

  function toggleSelect(threadId, event) {
    event.stopPropagation();
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  async function handleStar(thread, event) {
    event.stopPropagation();
    if (!isMailAdmin || !thread.accountId) return;
    const next = !thread.isStarred;
    setThreads((rows) =>
      rows.map((row) =>
        row.id === thread.id ? { ...row, isStarred: next } : row,
      ),
    );
    try {
      await starMailThread(thread.accountId, thread.id, next);
    } catch (err) {
      setThreads((rows) =>
        rows.map((row) =>
          row.id === thread.id ? { ...row, isStarred: thread.isStarred } : row,
        ),
      );
      setError(err.message || 'Failed to update star.');
    }
  }

  async function handleToggleRead(thread, event) {
    event?.stopPropagation();
    if (!isMailAdmin || !thread.accountId) return;
    const nextUnread = !thread.isUnread;
    setThreads((rows) =>
      rows.map((row) =>
        row.id === thread.id ? { ...row, isUnread: nextUnread } : row,
      ),
    );
    try {
      await markMailThreadSeen(thread.accountId, thread.id, nextUnread);
    } catch (err) {
      setThreads((rows) =>
        rows.map((row) =>
          row.id === thread.id ? { ...row, isUnread: thread.isUnread } : row,
        ),
      );
      setError(err.message || 'Failed to update read state.');
    }
  }

  async function handleTrash(ids, event) {
    event?.stopPropagation();
    if (!canDelete || !ids.length) return;
    const idSet = new Set(ids);
    const refs = threads
      .filter((row) => idSet.has(row.id))
      .map((row) => ({
        accountId: row.accountId,
        gmailThreadId: row.id,
      }));
    const previous = threads;
    setThreads((rows) => rows.filter((row) => !idSet.has(row.id)));
    setSelected(new Set());
    try {
      await trashMailThreadRefs(refs);
      setTotal((value) => Math.max(0, value - ids.length));
    } catch (err) {
      setThreads(previous);
      setError(err.message || 'Failed to delete.');
    }
  }

  async function handleRefresh(full = false) {
    if (!isMailAdmin) {
      await loadThreads();
      return;
    }
    if (!connectedCount) {
      setError('Connect team Gmail accounts in Settings first.');
      return;
    }
    setBusy('sync');
    setError('');
    setStatus(
      full
        ? 'Full sync across connected Gmail accounts…'
        : 'Refreshing connected Gmail accounts…',
    );
    try {
      const result = await syncAllGmailAccounts({ full });
      const failed = (result.results || []).filter(
        (row) => row.error && !row.skipped,
      );
      const paused = (result.results || []).filter((row) => row.quotaPaused);
      const pending = (result.results || []).some((row) => row.hasMore);
      setStatus(
        `${full ? 'Full sync' : 'Refresh'}: ${result.syncedThreads || 0} conversation${
          result.syncedThreads === 1 ? '' : 's'
        } from ${result.accounts || 0} account${
          result.accounts === 1 ? '' : 's'
        }.${
          pending ? ' More pages remain — run Full sync again to resume.' : ''
        }${
          paused.length
            ? ` ${paused.length} account${paused.length === 1 ? '' : 's'} paused for Gmail quota.`
            : ''
        }${
          failed.length
            ? ` ${failed.length} account${failed.length === 1 ? '' : 's'} reported errors.`
            : ''
        }`,
      );
      if (failed.length || paused.length) {
        setError(
          [...failed, ...paused.filter((p) => !failed.includes(p))]
            .map((row) => `${row.gmailAddress || 'account'}: ${row.error}`)
            .join(' · '),
        );
      } else {
        setError('');
      }
      await loadThreads();
      await loadBootstrap();
    } catch (err) {
      setError(err.message || 'Sync failed.');
      setStatus('');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="gmail-app">
      <header className="gmail-topbar">
        <div className="gmail-topbar__brand">
          <span className="gmail-topbar__logo" aria-hidden="true">
            M
          </span>
          <div>
            <strong>Mail</strong>
            <em>Interview inbox</em>
          </div>
        </div>

        <div className="gmail-search-wrap" ref={filterRef}>
          <form
            className="gmail-search"
            onSubmit={(e) => {
              e.preventDefault();
              applySearch();
            }}
          >
            <SearchIcon />
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search mail"
              disabled={!connectedCount}
            />
            <button
              type="button"
              className="gmail-search__filter"
              title="Show search options"
              disabled={!connectedCount}
              onClick={() => setFilterOpen((open) => !open)}
            >
              <FilterIcon />
            </button>
            <button type="submit" disabled={!connectedCount || listLoading}>
              Search
            </button>
          </form>

          {filterOpen ? (
            <form className="gmail-filter-panel" onSubmit={applyAdvancedFilter}>
              <label>
                <span>From</span>
                <input
                  value={filters.from}
                  onChange={(e) =>
                    setFilters((current) => ({ ...current, from: e.target.value }))
                  }
                />
              </label>
              <label>
                <span>To</span>
                <input
                  value={filters.to}
                  onChange={(e) =>
                    setFilters((current) => ({ ...current, to: e.target.value }))
                  }
                />
              </label>
              <label>
                <span>Subject</span>
                <input
                  value={filters.subject}
                  onChange={(e) =>
                    setFilters((current) => ({
                      ...current,
                      subject: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Has the words</span>
                <input
                  value={filters.hasWords}
                  onChange={(e) =>
                    setFilters((current) => ({
                      ...current,
                      hasWords: e.target.value,
                    }))
                  }
                />
              </label>
              <label className="gmail-filter-panel__date">
                <span>Date within</span>
                <div>
                  <select
                    value={filters.dateWithin}
                    onChange={(e) =>
                      setFilters((current) => ({
                        ...current,
                        dateWithin: e.target.value,
                      }))
                    }
                  >
                    {DATE_WITHIN_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={filters.date}
                    onChange={(e) =>
                      setFilters((current) => ({
                        ...current,
                        date: e.target.value,
                      }))
                    }
                  />
                </div>
              </label>
              <div className="gmail-filter-panel__actions">
                <button type="button" onClick={clearAdvancedFilter}>
                  Clear
                </button>
                <button type="submit" className="gmail-btn gmail-btn--primary">
                  Search
                </button>
              </div>
            </form>
          ) : null}
        </div>

        <UserMenu />
      </header>

      {error ? <div className="gmail-banner gmail-banner--error">{error}</div> : null}
      {status ? <div className="gmail-banner gmail-banner--status">{status}</div> : null}

      <div className="gmail-body">
        <aside className="gmail-nav" aria-label="Mail folders">
          <div className="gmail-nav__account">
            <span>Connected inboxes</span>
            <strong>
              {connectedCount
                ? `${connectedCount} account${connectedCount === 1 ? '' : 's'}`
                : 'None connected'}
            </strong>
          </div>

          <nav className="gmail-folders">
            {FOLDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`gmail-folder${folder === item.id ? ' is-active' : ''}`}
                onClick={() => setFolder(item.id)}
                disabled={!connectedCount}
              >
                <FolderIcon type={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <label className="gmail-filter">
            <span>Team member</span>
            <select
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              disabled={!connectedCount}
            >
              <option value="">All team members</option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <label className="gmail-check">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              disabled={!connectedCount}
            />
            <span>Unread only</span>
          </label>

          <div className="gmail-nav__hint">
            <p>
              {isMailAdmin
                ? 'Connect each team member’s Gmail in Settings. Sync and manage all connected accounts here.'
                : 'Browse interview mail from all connected accounts. Sync and edits are admin-only.'}
            </p>
          </div>

          <div className="gmail-nav__actions">
            <button
              type="button"
              className="gmail-btn gmail-btn--primary"
              disabled={!connectedCount || busy === 'sync'}
              onClick={() => handleRefresh(false)}
            >
              {busy === 'sync'
                ? 'Refreshing…'
                : isMailAdmin
                  ? 'Refresh'
                  : 'Reload'}
            </button>
            {isMailAdmin ? (
              <button
                type="button"
                className="gmail-btn"
                disabled={!connectedCount || busy === 'sync'}
                onClick={() => handleRefresh(true)}
              >
                Full sync
              </button>
            ) : null}
          </div>
        </aside>

        <section className="gmail-list-panel" aria-label="Message list">
          <div className="gmail-list-toolbar">
            <div className="gmail-list-toolbar__left">
              <label className="gmail-check-control" title="Select">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={!threads.length}
                  ref={(node) => {
                    if (node) {
                      node.indeterminate = someSelected && !allSelected;
                    }
                  }}
                  onChange={toggleSelectAll}
                />
              </label>
              <button
                type="button"
                className="gmail-icon-btn"
                title="Refresh"
                disabled={!connectedCount || busy === 'sync'}
                onClick={() => handleRefresh(false)}
              >
                <RefreshIcon />
              </button>
              {someSelected && isMailAdmin ? (
                <>
                  {canDelete ? (
                    <button
                      type="button"
                      className="gmail-icon-btn"
                      title="Delete"
                      onClick={(event) => handleTrash([...selected], event)}
                    >
                      <TrashIcon />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="gmail-icon-btn"
                    title="Mark as read"
                    onClick={async () => {
                      const ids = [...selected];
                      await Promise.all(
                        ids.map(async (id) => {
                          const thread = threads.find((row) => row.id === id);
                          if (thread?.isUnread) {
                            await handleToggleRead(thread);
                          }
                        }),
                      );
                    }}
                  >
                    <MarkReadIcon unread />
                  </button>
                </>
              ) : null}
              <label className="gmail-sort">
                <span>Sort</span>
                <select
                  value={sort}
                  disabled={!connectedCount}
                  onChange={(e) => setSort(e.target.value)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="gmail-list-toolbar__right">
              <span>{rangeLabel}</span>
              <button
                type="button"
                className="gmail-icon-btn"
                title="Newer"
                disabled={!canPrev || listLoading}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                </svg>
              </button>
              <button
                type="button"
                className="gmail-icon-btn"
                title="Older"
                disabled={!canNext || listLoading}
                onClick={() => setPage((value) => value + 1)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                </svg>
              </button>
            </div>
          </div>

          <div className="gmail-list-scroll">
            {loading ? (
              <div className="gmail-empty">Loading mail…</div>
            ) : !connectedCount ? (
              <div className="gmail-empty">
                <strong>No Gmail accounts connected</strong>
                <p>
                  {isMailAdmin
                    ? 'Open Settings and connect each team member’s personal Gmail with one-time Google consent (`gmail.readonly`). Then return here and run Full sync.'
                    : 'Ask an admin to connect team Gmail accounts in Settings, then sync interview mail.'}
                </p>
              </div>
            ) : listLoading && !threads.length ? (
              <div className="gmail-empty">Loading conversations…</div>
            ) : !threads.length ? (
              <div className="gmail-empty">
                <strong>
                  No interview-related messages
                  {memberFilter ? ' for this team member' : ''} in this folder.
                </strong>
                <p>
                  {isMailAdmin
                    ? memberFilter
                      ? 'Confirm this member’s Gmail is connected in Settings, then run Full sync.'
                      : 'Run Full sync to import the last 7 days of interview mail from connected accounts.'
                    : 'If mail is missing, ask an admin to run Full sync in Settings or Mail.'}
                </p>
              </div>
            ) : (
              <ul className="gmail-rows">
                {threads.map((thread) => {
                  const isChecked = selected.has(thread.id);
                  return (
                    <li key={thread.id}>
                      <div
                        className={`gmail-row${thread.isUnread ? ' is-unread' : ''}${
                          isChecked ? ' is-selected' : ''
                        }`}
                        role="button"
                        tabIndex={0}
                        onClick={() => openThread(thread)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openThread(thread);
                          }
                        }}
                      >
                        <label
                          className="gmail-check-control"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(event) => toggleSelect(thread.id, event)}
                          />
                        </label>
                        {isMailAdmin ? (
                          <button
                            type="button"
                            className={`gmail-star${thread.isStarred ? ' is-on' : ''}`}
                            title={thread.isStarred ? 'Unstar' : 'Star'}
                            onClick={(event) => handleStar(thread, event)}
                          >
                            ★
                          </button>
                        ) : (
                          <span
                            className={`gmail-star${thread.isStarred ? ' is-on' : ''}`}
                            aria-hidden="true"
                          >
                            ★
                          </span>
                        )}
                        <span className="gmail-row__from">
                          {senderLabel(thread.from)}
                        </span>
                        <span className="gmail-row__content">
                          <strong>{thread.subject || '(no subject)'}</strong>
                          <span> - {thread.snippet || ''}</span>
                        </span>
                        {thread.matchedMember?.name ? (
                          <span className="gmail-row__tag">
                            {thread.matchedMember.name}
                          </span>
                        ) : (
                          <span className="gmail-row__tag gmail-row__tag--empty" />
                        )}
                        <span className="gmail-row__meta">
                          <span className="gmail-row__date">
                            {formatMailDate(thread.date)}
                          </span>
                          <span className="gmail-row__actions">
                            {canDelete ? (
                              <button
                                type="button"
                                className="gmail-icon-btn"
                                title="Delete"
                                onClick={(event) =>
                                  handleTrash([thread.id], event)
                                }
                              >
                                <TrashIcon />
                              </button>
                            ) : null}
                            {isMailAdmin ? (
                              <button
                                type="button"
                                className="gmail-icon-btn"
                                title={
                                  thread.isUnread
                                    ? 'Mark as read'
                                    : 'Mark as unread'
                                }
                                onClick={(event) =>
                                  handleToggleRead(thread, event)
                                }
                              >
                                <MarkReadIcon unread={thread.isUnread} />
                              </button>
                            ) : null}
                          </span>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default MailPage;
