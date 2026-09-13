# LibreChat Admin Panel

A comprehensive web-based admin dashboard for managing LibreChat's MongoDB database.

## Features

- Transaction-ledger usage and cost reporting (including full prompt context and title calls)
- User, balance, conversation, message, file, and transaction views
- Date ranges, search, user filters, sortable columns, and newest-first pagination
- In-browser previews for images, PDFs, and text files
- Balance top-ups and auto-refill settings
- Cascading user deletion and backed-up orphan cleanup
- Overview KPIs, daily usage chart, responsive layout, and dark mode
- Rate-limited authentication with hashed credentials and server-side sessions

## Installation & Setup

### Option 1: Docker (Recommended)

1. Make sure LibreChat's MongoDB container is running
2. Create the environment file and set secure credentials:

```bash
cp .env.example .env
# Generate ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET as described in .env.example
```

3. From the admin-panel directory:

```bash
docker compose up -d --build
```

4. Access the panel at `http://localhost:3001`

### Option 2: Standalone

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env
# Edit .env with your settings
```

3. Start the server:

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

4. Access the panel at `http://localhost:3001`

## Configuration

Edit the `.env` file to configure:

- `ADMIN_PORT`: Port for the admin panel (default: 3001)
- `MONGO_URI`: MongoDB connection string
- `ADMIN_USERNAME`: Admin username
- `ADMIN_PASSWORD_HASH`: bcrypt hash of the admin password (plaintext is never configured)
- `ADMIN_SESSION_SECRET`: Session encryption key
- `COOKIE_SECURE`: Use secure cookies; keep `true` behind HTTPS
- `ADMIN_IMAGES_ROOT` / `ADMIN_UPLOADS_ROOT`: Read-only preview mounts
- `ADMIN_DELETE_IMAGES_ROOT` / `ADMIN_DELETE_UPLOADS_ROOT`: cleanup mounts
- `ADMIN_BACKUP_ROOT`: EJSON backup location for maintenance cleanup

## Database Collections

The admin panel provides access to all LibreChat collections:

- **users**: User accounts and profiles
- **conversations**: Chat conversations
- **messages**: Individual chat messages
- **sessions**: User sessions
- **balances**: Token balances
- **transactions**: Token transactions
- **roles**: User roles and permissions
- **accessroles**: Resource access controls
- **agentcategories**: AI agent categories
- **projects**: Project configurations
- **tokens**: Authentication tokens
- **promptgroups**: Prompt groups
- **groups**: User groups
- **aclentries**: ACL entries
- **agents**: AI agents

## Usage

### Viewing Data

1. Login with your credentials
2. Click on any collection in the sidebar
3. Browse through documents with pagination
4. Use the search bar to filter results

### Orphan cleanup

The Maintenance page reports records whose user no longer exists. Cleanup always writes
an EJSON backup before deleting records and stored files.

The same workflow is available from the command line:

```bash
npm run cleanup:orphans                     # dry run
npm run cleanup:orphans -- --apply           # backup and clean
npm run cleanup:orphans -- --apply --keep-transactions
```

## Security Notes

1. This admin panel has privileged access to your database and stored files
2. Use a unique password and rotate the session secret periodically
3. Keep `COOKIE_SECURE=true` and terminate HTTPS at the reverse proxy
4. Restrict access by IP, VPN, or identity-aware proxy
5. Back up the database and the `admin-panel/backups` directory
6. Review structured `admin_mutation` logs

## Troubleshooting

### Cannot connect to MongoDB

- Ensure MongoDB container is running: `docker ps | grep mongodb`
- Check MONGO_URI in .env matches your setup
- For Docker: use service name `chat-mongodb`
- For local: use `localhost:27017`

### Login not working

- Check `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` in `.env`
- Clear browser cookies/cache
- Check server logs

### Port already in use

- Change ADMIN_PORT in .env to a different port
- Kill process using port 3001: `lsof -ti:3001 | xargs kill`

## Development

The admin panel is built with:

- Backend: Node.js + Express + Mongoose
- Frontend: Vanilla JavaScript + Modern CSS
- No build step required

To modify:

- Backend: Edit `server-v2.js`
- Frontend HTML: Edit `public/index.html`
- Frontend CSS: Edit `public/css/dashboard.css`
- Frontend JS: Edit `public/js/dashboard.js`

## License

MIT

