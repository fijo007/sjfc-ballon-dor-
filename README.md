# SJFC Ballon d’Or 2025/26

A public trophy archive with free voting and an admin dashboard.

## Features
- Public player trophy statistics and search
- Free voting, one vote per normalized username (case-insensitive)
- Admin-only player and season editing
- PostgreSQL-backed records and admin sessions
- Rate-limited login and voting endpoints; CSRF protection for admin changes

## Deploying on Render
1. Create a PostgreSQL database with a provider such as Neon or another managed PostgreSQL host.
2. Copy its connection string (DATABASE_URL). Keep it private.
3. Create a Render Web Service connected to this GitHub repository.
4. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
5. Add these environment variables in Render:
   - `NODE_ENV` = `production`
   - `ADMIN_USERNAME` = your chosen admin username
   - `ADMIN_PASSWORD` = a strong, unique password
   - `SESSION_SECRET` = a random secret of at least 32 characters
   - `DATABASE_URL` = your PostgreSQL connection string
6. Deploy. On first start, the app creates its tables and imports `data.json` only if the database has no existing app data.

## Important voting limitation
“One vote per username” prevents reuse of the same username (case-insensitive), but usernames are self-entered and not verified. A person can use multiple usernames or impersonate someone else. For stronger fairness, add email/phone verification or an approved voter list before treating results as official.

## Security
- Never commit `.env` or publish database credentials.
- Never share admin password, session secret, or DATABASE_URL in chat or screenshots.
- Use a managed PostgreSQL provider with SSL and backups.
- Restrict access to the Render service and database dashboard.

## Local development
1. Install Node.js 20+.
2. Create a PostgreSQL database.
3. Copy `.env.example` to `.env` and fill in the real values.
4. Run `npm install` then `npm start`.
