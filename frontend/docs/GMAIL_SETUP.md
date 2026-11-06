# Gmail Mail — multi-account (per team member)

Cal.ID **Mail** connects **each team member’s personal Gmail** with
`gmail.readonly`. Refresh tokens are encrypted server-side and never sent to
the browser. Admins read/sync all connected inboxes; there is **no forwarding**.

## Roles

| Role | Access |
|---|---|
| **Admin** | Settings: connect/disconnect any team member · Mail: sync, filter, star, trash, link |
| **Team member** | Settings + Mail: read-only view of all connections and mail (no connect/sync/edit) |
| **Caller** | No Mail · no Gmail controls in Settings |

## Exact redirect URI (register in Google Cloud)

```
http://localhost:5173/api/gmail/oauth/callback
```

Also set **Authorized JavaScript origin**:

```
http://localhost:5173
```

Use **`localhost`**, not `127.0.0.1`.

## Sync query (every connected account)

```
newer_than:7d -category:promotions -category:social {interview assessment recruiter "next steps" "schedule a call" "book a time" "technical interview" "coding challenge" shortlisted calendly}
```

## Google Cloud checklist

Project: **`interviewmanagement-513820`** · Client: **InterviewManagement**

1. Enable **Gmail API**
2. OAuth consent (Testing) → scopes: `gmail.readonly`, `userinfo.email`, `userinfo.profile`, `openid`
3. Add each team member Google account as a **test user**
4. Register the redirect URI above
5. Client ID / Secret in `frontend/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI`, `GMAIL_TOKEN_SECRET`)

## Database

1. `supabase/gmail_mail.sql` (if needed)
2. `supabase/gmail_multi_account.sql`

## Connect workflow

1. Add the person on **Team** with their Gmail address
2. **Settings → Gmail Connections → Connect Gmail**
3. Sign in as **that** Google user and approve `gmail.readonly`
4. Backend validates signed OAuth `state`, matches email to the Team row, calls Gmail `users.getProfile`, then stores the encrypted refresh token
5. Status becomes **Connected** only after that verification
6. A **small** initial sync runs (bounded + rate-limited). Quota failures show as **Sync error** / **Quota paused** — tokens are kept
7. Admin opens **Mail** (all / filter by member). Prefer Refresh; use **Full sync** to page through 7 days (resumable)

## Sync / quota notes

- Per-account rate limiting, exponential backoff (403/429 only), and sync locks prevent overlapping jobs
- Incremental sync uses Gmail `historyId` when available; otherwise a bounded `threads.list` with the interview `q`
- Full sync paginates (~30 threads/batch), dedupes cached conversations, and pauses on quota instead of retry-storming
- Do **not** hammer Reconnect when you see quota errors — wait ~1 minute, then Refresh / Full sync

## Disconnect / Reconnect

- **Disconnect** deletes the account row (and cascaded tokens/threads)
- **Reconnect** runs OAuth again (needed after Google revoke or email mismatch). Prefer Refresh for sync errors.

## Security notes

- Refresh tokens are encrypted with `GMAIL_TOKEN_SECRET` and stored only in `gmail_account_secrets` (no client RLS access)
- Tokens are never returned in API JSON or written to logs
- OAuth `state` is signed and checked on callback
