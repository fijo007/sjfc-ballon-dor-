# SJFC Ballon d’Or website

A responsive, public-facing SJFC trophy archive inspired by premium football-awards editorial design. It uses original SJFC branding and does not copy the official Ballon d’Or site’s protected assets or identity.

## Included
- Public trophy archive with player search and season statistics.
- Admin login and private dashboard.
- Admin can add/remove players, edit winner/runner-up/shield counts, and update season/competition totals.
- Free public voting: anyone can enter a username and cast one vote per entered username.
- Admin can open/close voting, view total votes and reset the vote count.
- Vote submissions are rate-limited and usernames are compared case-insensitively.
- Initial records imported from the supplied `SJFC BALLON D’OR 2025/26` PDF.
- Server-side session authentication, password hashing, CSRF token checks, login rate limiting, HTTP security headers, and HttpOnly/SameSite cookies.

## Run locally
1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set a unique admin username, a strong password, and a random `SESSION_SECRET` of at least 32 characters.
4. Install dependencies and start:

   ```bash
   npm install
   npm start
   ```

5. Open `http://localhost:3000`.

## Deploy
Deploy the whole folder to a Node.js host that supports persistent writable storage. Set the environment variables in the host's secret/environment settings. Set `NODE_ENV=production` and enable HTTPS. Do not expose `.env` or commit it to source control.

## Important production notes
- The included Express session store is the default in-memory store. It is suitable for a local demo, but not a reliable production session store. Before public production launch, configure a persistent session store such as Redis or a managed database-backed store.
- `data.json` must live on persistent storage for edits to survive redeployments. Some serverless hosts use ephemeral filesystems; use a database there.
- Change the sample credentials before starting. Never share the admin password in public.
- Back up `data.json` before making major changes.
- Public voting uses self-entered usernames only. It prevents the same username string from voting twice, but it does not verify a real person's identity; users could choose someone else's username or create multiple usernames. For stronger election integrity, add email/phone verification or an admin-approved voter list.
- The site is a custom SJFC fan-tournament archive, not an official Ballon d’Or website.

## Data note
The supplied PDF lists 19 players alphabetically and says counts only, no ranking or points, based on 44 competitions. The site preserves those counts as provided.
