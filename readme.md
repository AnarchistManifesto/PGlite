# 🐘 PGlite HTTP Server for Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/new/template/pglite)

> PostgreSQL in WebAssembly with a full HTTP API. Run a complete Postgres database in your Railway app without needing a separate database service!

## ⚡ What is PGlite?

PGlite is PostgreSQL compiled to WebAssembly - a real Postgres database that runs anywhere JavaScript runs. This template wraps it with a REST API so you can use it like any other database service.

## 🎯 Why Use This?

- **Zero Configuration**: No connection strings, no external database setup
- **100% PostgreSQL Compatible**: Full SQL support, transactions, indexes
- **Persistent Storage**: Data survives restarts using Railway volumes
- **Cost Effective**: No separate database charges
- **Perfect For**: Prototypes, side projects, demos, development

## 🚀 Quick Start

### Deploy to Railway

1. Click the "Deploy on Railway" button above
2. Wait for deployment to complete
3. Your PGlite database is ready!

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port (Railway sets this) |
| `DATA_DIR` | `/app/data` | Database storage location |

### Railway Volume Setup (IMPORTANT!)

To persist your database:

1. Go to your Railway project
2. Click on your service → **Settings** → **Volumes**
3. Click **Add Volume**
4. Mount path: `/app/data`
5. Redeploy your service

Without a volume, your database will be reset on each deployment!

## 📚 API Reference

### Health Check

```bash
GET /health
```

Response:
```json
{
  "status": "healthy",
  "database": "connected",
  "dataDir": "/app/data",
  "timestamp": "2025-01-15T10:00:00.000Z"
}
```

### Execute SQL Query

```bash
POST /query
Content-Type: application/json

{
  "query": "SELECT * FROM users WHERE id = $1",
  "params": [1]
}
```

Response:
```json
{
  "success": true,
  "rows": [
    { "id": 1, "name": "John", "email": "john@example.com" }
  ],
  "rowCount": 1,
  "fields": [
    { "name": "id", "dataTypeID": 23 },
    { "name": "name", "dataTypeID": 25 }
  ]
}
```

### Execute Transaction

```bash
POST /transaction
Content-Type: application/json

{
  "queries": [
    {
      "query": "INSERT INTO users (name, email) VALUES ($1, $2)",
      "params": ["Alice", "alice@example.com"]
    },
    {
      "query": "UPDATE users SET name = $1 WHERE email = $2",
      "params": ["Bob", "bob@example.com"]
    }
  ]
}
```

### List All Tables

```bash
GET /tables
```

Response:
```json
{
  "success": true,
  "tables": ["users", "posts", "comments"]
}
```

### Get Table Schema

```bash
GET /tables/users/schema
```

Response:
```json
{
  "success": true,
  "tableName": "users",
  "columns": [
    {
      "column_name": "id",
      "data_type": "integer",
      "is_nullable": "NO",
      "column_default": "nextval('users_id_seq'::regclass)"
    }
  ]
}
```

### Export Database

```bash
GET /export
```

Downloads SQL dump file of entire database.

### Import SQL

```bash
POST /import
Content-Type: application/json

{
  "sql": "CREATE TABLE products (id SERIAL, name TEXT);"
}
```

### Database Statistics

```bash
GET /stats
```

Response:
```json
{
  "success": true,
  "database_size": "8192 bytes",
  "tables": [
    {
      "schemaname": "public",
      "tablename": "users",
      "size": "16 kB"
    }
  ]
}
```

## 🎨 Example CRUD Endpoints

The template includes ready-to-use CRUD endpoints for a `users` table:

### Create User
```bash
POST /users
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com"
}
```

### List Users
```bash
GET /users
```

### Get User
```bash
GET /users/1
```

### Update User
```bash
PUT /users/1
Content-Type: application/json

{
  "name": "Jane Doe"
}
```

### Delete User
```bash
DELETE /users/1
```

## 💻 Local Development

```bash
# Clone the repository
git clone <your-repo>
cd pglite-railway-server

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## 🔧 Usage Examples

### JavaScript/TypeScript

```typescript
const API_URL = 'https://your-app.railway.app';

// Execute query
const response = await fetch(`${API_URL}/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'SELECT * FROM users WHERE email = $1',
    params: ['john@example.com']
  })
});

const data = await response.json();
console.log(data.rows);
```

### Python

```python
import requests

API_URL = 'https://your-app.railway.app'

# Execute query
response = requests.post(f'{API_URL}/query', json={
    'query': 'SELECT * FROM users',
    'params': []
})

data = response.json()
print(data['rows'])
```

### cURL

```bash
# Create a table
curl -X POST https://your-app.railway.app/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "CREATE TABLE products (id SERIAL PRIMARY KEY, name TEXT, price DECIMAL)"
  }'

# Insert data
curl -X POST https://your-app.railway.app/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "INSERT INTO products (name, price) VALUES ($1, $2)",
    "params": ["Laptop", 999.99]
  }'
```

## 🛡️ Security Considerations

⚠️ **IMPORTANT**: This template has NO authentication by default. Anyone with your URL can access your database!

### Recommended Security Measures:

1. **Add API Key Authentication**:
```typescript
app.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

2. **Use Railway's Private Networking**
3. **Implement Rate Limiting**
4. **Whitelist SQL commands** (block DROP, DELETE, etc. if needed)

## 📊 Limitations

- **Single Instance Only**: PGlite doesn't support horizontal scaling
- **Memory Constraints**: Keep database size under Railway's memory limits
- **Not for Production**: Use for development, prototypes, or small apps
- **No Replication**: No built-in backup/restore (use export endpoint)

## 🔄 Backup & Restore

### Backup
```bash
curl https://your-app.railway.app/export > backup.sql
```

### Restore
```bash
curl -X POST https://your-app.railway.app/import \
  -H "Content-Type: application/json" \
  -d "{\"sql\": \"$(cat backup.sql)\"}"
```

## 🎯 Use Cases

Perfect for:
- ✅ Side projects and MVPs
- ✅ Development/staging environments
- ✅ Prototypes and demos
- ✅ Learning PostgreSQL
- ✅ Apps with < 100MB data
- ✅ Single-tenant applications

Not recommended for:
- ❌ High-traffic production apps
- ❌ Multi-gigabyte databases
- ❌ Apps requiring high availability
- ❌ Complex replication setups

## 🤝 Contributing

Found a bug or have a feature request? Open an issue!

## 🔗 Links

- [PGlite Documentation](https://github.com/electric-sql/pglite)
- [Railway Documentation](https://docs.railway.app)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

---

Made with ❤️ for the Railway community
