# Arnold API

Timesheet frontend (React + Vite) with Express + MongoDB backend.

## Local development

1. Create `.env` in the project root:

```
PORT=8787
MONGODB_URI=<your atlas uri>
MONGODB_DB=arnold_system
MONDAY_API_TOKEN=<your monday api token>
MONDAY_BOARD_ID=1062951447
MONDAY_BOARD_URL=https://arnoldcontract.monday.com/boards/1062951447
MONDAY_API_URL=https://api.monday.com/v2
ZENDESK_API_TOKEN=<your zendesk api token>
ZENDESK_EMAIL=<optional: your zendesk email for api-token mode>
ZENDESK_URL=https://your-subdomain.zendesk.com/agent
FIREBASE_PROJECT_ID=<project-id>
VITE_FIREBASE_API_KEY=<firebase web api key>
VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<project-id>
VITE_FIREBASE_STORAGE_BUCKET=<project-id>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<firebase sender id>
```

2. Install root dependencies:

```
npm install
```

3. Run frontend + backend together:

```
npm run dev
```

## Firebase deployment

This repo is configured to deploy:

1. Frontend to Firebase Hosting (`dist`)
2. Backend API to Firebase Functions (`functions/index.mjs`, function name `apiV1`)

### One-time setup

1. Ensure Google Cloud / Firebase Terms of Service are accepted on the target account.
2. Create Firebase project:

```
firebase projects:create <project-id> --display-name "YBK Arnold"
```

3. Set the default project:

```
firebase use <project-id>
```

4. Install Functions dependencies:

```
npm --prefix functions install
```

5. Add function environment variables in `functions/.env`:

```
MONGODB_URI=<your atlas uri>
MONGODB_DB=arnold_system
MONDAY_API_TOKEN=<your monday api token>
MONDAY_BOARD_ID=1062951447
MONDAY_BOARD_URL=https://arnoldcontract.monday.com/boards/1062951447
MONDAY_API_URL=https://api.monday.com/v2
ZENDESK_API_TOKEN=<your zendesk api token>
ZENDESK_EMAIL=<optional: your zendesk email for api-token mode>
ZENDESK_URL=https://your-subdomain.zendesk.com/agent
```

Zendesk auth modes:

- If `ZENDESK_EMAIL` is set, backend uses Basic auth (`email/token` + `ZENDESK_API_TOKEN`) for Zendesk API token mode.
- If `ZENDESK_EMAIL` is not set, backend uses Bearer auth with `ZENDESK_API_TOKEN` (OAuth token mode).

## Website authentication

- Website login uses Firebase Authentication (Google provider).
- Owner account is hardcoded as `kal@ybkarnold.com` and is always treated as Admin.
- New users are created with `pending` approval status and cannot access the app until an Admin approves them.
- Admins can approve users as `standard` or `admin` from the `Admin Users` page in the sidebar.

### Deploy commands

Deploy both hosting + functions:

```
npm run deploy
```

Deploy only hosting:

```
npm run deploy:hosting
```

Deploy only functions:

```
npm run deploy:functions
```
