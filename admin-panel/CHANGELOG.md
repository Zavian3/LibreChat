# Admin Panel Changelog

## [1.1.0] - 2026-01-09

### Improved - Better Data Display

**What Changed:**
- Replaced raw JSON display with readable, structured table columns
- Each collection now shows relevant, meaningful fields instead of truncated JSON
- Automatic field formatting for better readability

**Collection-Specific Views:**

1. **Users Collection** - Now shows:
   - ID
   - Name
   - Username
   - Email
   - Role
   - Created Date
   - Token Credits

2. **Conversations Collection** - Now shows:
   - ID
   - Title
   - User ID
   - Endpoint (OpenAI, Google, etc.)
   - Model
   - Created Date
   - Updated Date

3. **Messages Collection** - Now shows:
   - ID
   - Sender
   - Message Text (truncated if long)
   - Conversation ID
   - Created Date
   - Token Count

4. **Balances Collection** - Now shows:
   - ID
   - User ID
   - Token Credits (formatted with commas)
   - Auto Refill Enabled (Yes/No)
   - Last Refill Date

5. **Transactions Collection** - Now shows:
   - ID
   - User ID
   - Conversation ID
   - Token Type
   - Model
   - Amount
   - Created Date

6. **Other Collections** - Similar improvements for:
   - Sessions
   - Roles
   - Access Roles
   - Agent Categories
   - Projects
   - And more...

**Features:**
- Dates are formatted in readable format (e.g., "Jan 9, 2026, 3:45:23 PM")
- Numbers are formatted with thousand separators (e.g., "1,000,000")
- Booleans show as "✓ Yes" or "✗ No"
- Long text is truncated with "..." to keep tables clean
- Arrays show count (e.g., "[5 items]")
- Objects show as "[Object]" in the table (full view available in View/Edit)

**Benefits:**
- Much easier to scan and understand data
- No need to read raw JSON for basic information
- Faster to find specific records
- More professional appearance
- Better for non-technical team members

---

## [1.0.0] - 2026-01-09

### Initial Release

**Features:**
- Full database access to all LibreChat collections
- Dashboard with overview statistics
- CRUD operations (Create, Read, Update, Delete)
- Search functionality
- Pagination support
- Authentication system
- Modern, clean UI
- Docker deployment
- Domain/subdomain support with nginx
- SSL/HTTPS ready

**Collections Supported:**
- users, conversations, messages, sessions
- balances, transactions, roles, accessroles
- agentcategories, projects, agents, promptgroups
- groups, tokens, aclentries

**Security:**
- Session-based authentication
- Configurable credentials
- Security headers
- Support for IP whitelisting
- SSL/TLS ready

---

## Upgrade Instructions

If you already have the admin panel running:

```bash
cd /root/LibreChat/admin-panel
docker-compose down
docker-compose up -d --build
```

No database changes required - this is a frontend-only update!

---

## Future Improvements (Planned)

- Export data to CSV/JSON
- Bulk operations (delete multiple, bulk edit)
- Advanced filters and sorting
- User activity logging
- Multi-user support with different permission levels
- Data visualization and charts
- Backup and restore functionality
- API documentation
- Audit trail for all changes
- Real-time updates with WebSockets

