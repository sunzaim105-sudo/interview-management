-- Clear synced Gmail cache so Mail can be re-imported with the current filter.
-- Keeps gmail_accounts + encrypted OAuth secrets (no reconnect needed).
-- Safe to re-run.

truncate table public.mail_messages restart identity cascade;
truncate table public.mail_threads restart identity cascade;

update public.gmail_accounts
set
  history_id = '',
  last_error = '',
  last_sync_at = null,
  status = case when status = 'revoked' then 'revoked' else 'connected' end
where status is distinct from 'revoked';
