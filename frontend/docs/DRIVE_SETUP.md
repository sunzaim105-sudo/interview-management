# Google Drive — Report video upload

Report → Video uploads recordings to a shared Drive folder
(**Interview Recordings**). Watch / Download go through `/api/drive/*` so files
stay private. Secrets live only in `frontend/.env`.

## Google Cloud

Project: **`interviewmanagement-513820`** · Client: **InterviewManagement**

| Setting | Value |
|---|---|
| Drive redirect | `http://localhost:53682/oauth2callback` |
| JS origin | `http://localhost:5173` |

1. Enable **Google Drive API**
2. OAuth consent → add your Drive account as a test user
3. Client ID / Secret in `frontend/.env`

## Obtain `GOOGLE_REFRESH_TOKEN`

From **Report**, click **Connect Google Drive** (admin/caller, signed in), approve
Drive access, then continue uploading.

Alternate CLI:

```bash
cd frontend
node scripts/google-drive-oauth.mjs
```

## Env

```env
GOOGLE_CLIENT_ID=877710506731-....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_DRIVE_FOLDER_NAME=Interview Recordings
```

Smoke: `GET /api/drive/status` → `{ configured: true }`.

## Roles

| Role | Actions |
|---|---|
| **Caller** (own interviews) | Upload, Watch, Replace |
| **Admin** | Watch, Download, Remove |
