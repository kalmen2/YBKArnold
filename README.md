# Arnold API

Timesheet frontend (React + Vite) with Express + MongoDB backend.

## Local development

1. Create `.env` in the project root:

```
PORT=8787
MONGODB_URI=<your atlas uri>
MONGODB_DB=arnold_system
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
2. Backend API to Firebase Functions (`functions/index.mjs`, function name `api`)

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
```

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
