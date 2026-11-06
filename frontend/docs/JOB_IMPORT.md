# Job import (Jobright & HiringCafe)

## Setup

1. Install browser binaries once:

```bash
npx playwright install chromium
```

2. Run this SQL in the Supabase SQL editor so descriptions persist:

`supabase/add_job_description.sql`

## How Import works

1. Server fetches the posting HTML (JSON-LD / `__NEXT_DATA__` / DOM).
2. If the page is bot-protected, a public link-preview summary is used.
3. Optional **Unlock with browser** opens a local Playwright window so you can complete CAPTCHA/login. Cookies stay in `frontend/.browser-profile` (gitignored) and are never sent to the client.

## Notes

- Jobright info URLs usually import fully without a browser.
- HiringCafe is Cloudflare-protected; summary fields import via preview; full HTML needs CAPTCHA in the browser window.
- Sites that set `X-Frame-Options` / CSP `frame-ancestors` show “Open in new tab” instead of an iframe. Cal.ID does not bypass framing restrictions.
