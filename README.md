# Cal ID — Interview Booking App

Interview scheduling software for recruiters and talent teams.

## Stack

- **Frontend:** React (Vite)
- **Backend:** Node.js (coming next)
- **Database / Auth:** Supabase

## Setup

### 1. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173`.

### 2. Supabase schema

In the Supabase SQL Editor, run:

`supabase/schema.sql`

This creates the `public.users` table with:

| Column | Purpose |
| --- | --- |
| `username` | Display / signup name |
| `user_id` | Login ID used on Sign In |
| `user_role` | `admin` or `caller` |
| `email` | Auth email |
| `status` | `pending`, `allowed`, or `blocked` |

New signups are created as `caller` + `pending`. They cannot sign in until an admin sets `status = 'allowed'`.

### 3. Bootstrap your first admin

1. Sign up in the app.
2. In SQL Editor:

```sql
update public.users
set user_role = 'admin', status = 'allowed'
where email = 'your-admin@email.com';
```

3. Sign in with that **User Name** (used as User ID) and password.

### Auth notes

- Sign Up: email, user name, password
- Sign In: **user ID** (same as signup user name) + password
- Role homes: `/admin` for admins, `/caller` for callers
- Pending/blocked users are signed out immediately
