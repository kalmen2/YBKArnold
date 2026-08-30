# Arnold read-only MCP server

This is a private, read-only Model Context Protocol (MCP) endpoint for the Arnold website.

Endpoint after deployment:

`https://us-central1-ybkarnold-b7ec0.cloudfunctions.net/mcpReadOnly/mcp`

## Safety boundary

- It is a dedicated Firebase Function (`mcpReadOnly`) with only one MCP route. It is separate from the website API function.
- Only `POST /mcp` performs MCP protocol requests. `GET` and `DELETE` return `405`.
- Every tool is marked with `readOnlyHint: true`.
- The MCP route uses `getReadOnlyCollections()`, which opens MongoDB collections without creating indexes, seeding data, or running migrations.
- It performs only `find`, `findOne`, `countDocuments`, and cursor reads. It has no tool for changes, publishing, emails, payments, or external sync.
- Database credentials, Firebase Admin credentials, and integration credentials stay in Firebase Functions. Nothing is added to the React frontend.
- Token, password, secret, cookie, authorization, and API-key shaped fields are removed from tool output.

## Available tools

- `list_available_record_types` — returns the categories available to the current role.
- `search_arnold_records` — searches unified/CRM orders, quotes, customers, contacts, sales reps, purchasing items/transactions, workers, timesheets, stages, order progress, alerts, order chats, app chats, and dashboard snapshots where the role permits them.
- `get_arnold_record` — gets a record by ID, number, or key.
- `get_arnold_dashboard_summary` — returns stored dashboard data and a few read-only counts.

App-chat threads and messages are limited to the signed-in member unless the user is an admin or manager.

## Authentication and roles

The endpoint accepts a Firebase ID token in the normal HTTP header:

```text
Authorization: Bearer <Firebase-ID-token>
```

The server verifies that token with Firebase Admin, looks up the existing Arnold user, requires approval, and uses their current role. It deliberately does not use the website middleware because that middleware records user activity; this endpoint must not write anything.

The owner, admins, managers, and office workers can access the broad internal record set. Sales reps receive CRM records; shop workers receive production-relevant orders, purchasing items, order chat, workers, and stages. All other roles receive the smaller production set.

For a production ChatGPT connection, configure your OAuth bridge to issue or exchange tokens for the same Firebase user identity, then send the Firebase ID token to `/mcp`. The MCP route has no OAuth client secret and contains no OAuth callback; this keeps the authentication authority separate from the data server.

## Run locally

1. Install both app dependency sets.

   ```bash
   npm install
   npm --prefix functions install
   ```

2. Configure the existing Firebase Functions environment, including MongoDB and Firebase Admin access.

3. Start the Functions emulator.

   ```bash
   npm --prefix functions run serve
   ```

4. Obtain an ID token from an approved user signed into the local app, then connect an MCP client to:

   ```text
   http://127.0.0.1:5001/ybkarnold-b7ec0/us-central1/mcpReadOnly/mcp
   ```

   Send the token only in the `Authorization` header. Never put it in source code or a URL.

## Test in ChatGPT developer mode

1. Deploy the Functions endpoint privately (instructions below).
2. In ChatGPT developer mode, add a remote MCP server using the deployed `/mcp` URL.
3. Connect through your OAuth bridge so ChatGPT receives a Firebase ID token for an approved Arnold user. Do not use a shared admin token.
4. Confirm the server shows only the four tools above and that each is read-only.
5. Run `list_available_record_types`, then a harmless `search_arnold_records` query such as an order number. Confirm results match that user's website permissions.

For early protocol debugging, use the MCP Inspector locally with the same temporary Firebase ID token before connecting ChatGPT.

## Private deployment

Deploy only Functions:

```bash
npm run deploy:functions
```

Keep the Firebase project private, do not expose MongoDB to the public internet, and restrict the OAuth bridge's redirect/client configuration to the approved ChatGPT developer-mode client. Review Firebase Function logs after deployment; tool calls should never log token values or private credentials.
