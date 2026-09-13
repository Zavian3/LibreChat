# LibreChat Admin Panel

A comprehensive web-based admin dashboard for managing LibreChat's MongoDB database.

## Features

- View all database collections and documents
- Real-time statistics and overview
- Full CRUD operations (Create, Read, Update, Delete)
- Search functionality
- Pagination support
- User-friendly interface
- Authentication system

## Installation & Setup

### Option 1: Docker (Recommended)

1. Make sure LibreChat's MongoDB container is running
2. From the admin-panel directory:

```bash
docker-compose up -d
```

3. Access the panel at `http://localhost:3001`

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

## Default Credentials

- Username: `admin`
- Password: `admin123`

**IMPORTANT**: Change these credentials in production by updating the `.env` file!

## Configuration

Edit the `.env` file to configure:

- `ADMIN_PORT`: Port for the admin panel (default: 3001)
- `MONGO_URI`: MongoDB connection string
- `ADMIN_USERNAME`: Admin username
- `ADMIN_PASSWORD`: Admin password
- `ADMIN_SESSION_SECRET`: Session encryption key

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

### Creating Documents

1. Select a collection
2. Click "Add Document"
3. Enter valid JSON
4. Click "Save"

### Editing Documents

1. Click "Edit" on any document
2. Modify the JSON
3. Click "Save"

### Deleting Documents

1. Click "Delete" on any document
2. Confirm the action

## Security Notes

1. This admin panel has full access to your database
2. Always change default credentials
3. Use strong passwords
4. Consider adding IP restrictions
5. Use HTTPS in production
6. Keep the admin panel behind a firewall or VPN
7. Regularly review access logs

## Troubleshooting

### Cannot connect to MongoDB

- Ensure MongoDB container is running: `docker ps | grep mongodb`
- Check MONGO_URI in .env matches your setup
- For Docker: use service name `chat-mongodb`
- For local: use `localhost:27017`

### Login not working

- Check credentials in .env file
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

- Backend: Edit `server.js`
- Frontend HTML: Edit `public/index.html`
- Frontend CSS: Edit `public/css/styles.css`
- Frontend JS: Edit `public/js/app.js`

## License

MIT

