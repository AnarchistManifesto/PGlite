// ============================================================================
// PGlite HTTP Server for Railway
// PostgreSQL in WebAssembly with HTTP API
// ============================================================================

console.log('DEBUG: Starting PGlite application script execution...'); // Immediate log
console.log('DEBUG: Node version:', process.version);
console.log('DEBUG: Platform:', process.platform);

import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Use a subdirectory inside the volume mount to avoid ext4 lost+found conflict
const volumeMount = process.env.DATA_DIR || '/app/data';
const dataDir = path.join(volumeMount, 'pglite_db');
let db: PGlite;

// Ensure the subdirectory exists
if (!fs.existsSync(dataDir)) {
  console.log(`📁 Creating data subdirectory: ${dataDir}`);
  fs.mkdirSync(dataDir, { recursive: true });
}

const initDB = async () => {
  console.log('🚀 Initializing PGlite...');
  // Filesystem check
  try {
    const testFile = path.join(dataDir, '.write_test');
    fs.writeFileSync(testFile, 'ok');
    fs.rmSync(testFile);
    console.log('✅ FileSystem check passed: write/delete successful.');
  } catch (fsErr) {
    console.error('❌ FileSystem check FAILED:', fsErr);
    // Continue anyway to see if PGlite can handle it, or fail hard?
    // Let's fail hard if we can't write, as PGlite will definitely fail.
    throw fsErr;
  }

  console.log('DEBUG: Creating PGlite instance with verbose logging...');
  try {
    db = new PGlite(dataDir, {
      relaxedDurability: true,
      debug: 5, // Maximally verbose logging
    });
    console.log('DEBUG: PGlite instance created.');
  } catch (err) {
    console.error('FATAL: Failed to create PGlite instance:', err);
    throw err;
  }

  // Create example table
  console.log('DEBUG: Ensuring schema exists...');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('DEBUG: Schema ready.');

  console.log('✅ PGlite initialized at:', dataDir);
};

// Validation schemas
const querySchema = z.object({
  query: z.string().min(1),
  params: z.array(z.any()).optional(),
});

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    database: 'connected',
    dataDir,
    timestamp: new Date().toISOString()
  });
});

// Execute SQL query
app.post('/query', async (req, res) => {
  try {
    const { query, params = [] } = querySchema.parse(req.body);

    const result = await db.query(query, params);

    res.json({
      success: true,
      rows: result.rows,
      rowCount: result.rows.length,
      fields: result.fields?.map(f => ({
        name: f.name,
        dataTypeID: f.dataTypeID
      }))
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});

// Execute multiple queries in a transaction
app.post('/transaction', async (req, res) => {
  try {
    const { queries } = z.object({
      queries: z.array(z.object({
        query: z.string(),
        params: z.array(z.any()).optional()
      }))
    }).parse(req.body);

    await db.exec('BEGIN');

    const results = [];
    for (const { query, params = [] } of queries) {
      const result = await db.query(query, params);
      results.push({
        rows: result.rows,
        rowCount: result.rows.length
      });
    }

    await db.exec('COMMIT');

    res.json({
      success: true,
      results
    });
  } catch (error: any) {
    await db.exec('ROLLBACK').catch(() => { });
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// List all tables
app.get('/tables', async (req, res) => {
  try {
    const result = await db.query<{ tablename: string }>(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    res.json({
      success: true,
      tables: result.rows.map(r => r.tablename)
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get table schema
app.get('/tables/:tableName/schema', async (req, res) => {
  try {
    const { tableName } = req.params;

    const result = await db.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = $1
      ORDER BY ordinal_position;
    `, [tableName]);

    res.json({
      success: true,
      tableName,
      columns: result.rows
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Export database as SQL dump
app.get('/export', async (req, res) => {
  try {
    // Get all tables
    const tables = await db.query<{ tablename: string }>(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `);

    let dump = '-- PGlite Database Export\n';
    dump += `-- Generated: ${new Date().toISOString()}\n\n`;

    for (const { tablename } of tables.rows) {
      // Get CREATE TABLE statement
      const createResult = await db.query<{ create_stmt: string }>(`
        SELECT 
          'CREATE TABLE ' || $1 || ' (' ||
          string_agg(
            column_name || ' ' || data_type || 
            CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
            ', '
          ) || ');' as create_stmt
        FROM information_schema.columns
        WHERE table_name = $1
        GROUP BY table_name;
      `, [tablename]);

      dump += createResult.rows[0]?.create_stmt + '\n\n';

      // Get data
      const data = await db.query<any>(`SELECT * FROM ${tablename}`);
      if (data.rows.length > 0) {
        for (const row of data.rows) {
          const values = Object.values(row).map(v =>
            typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v
          );
          dump += `INSERT INTO ${tablename} VALUES (${values.join(', ')});\n`;
        }
        dump += '\n';
      }
    }

    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', 'attachment; filename="pglite-dump.sql"');
    res.send(dump);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Import SQL file
app.post('/import', async (req, res) => {
  try {
    const { sql } = z.object({
      sql: z.string().min(1)
    }).parse(req.body);

    await db.exec(sql);

    res.json({
      success: true,
      message: 'SQL imported successfully'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Database statistics
app.get('/stats', async (req, res) => {
  try {
    const tablesResult = await db.query(`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
      FROM pg_tables
      WHERE schemaname = 'public'
    `);

    const dbSize = await db.query<{ size: string }>(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);

    res.json({
      success: true,
      database_size: dbSize.rows[0]?.size,
      tables: tablesResult.rows
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// EXAMPLE CRUD ENDPOINTS (for the users table)
// ============================================================================

app.get('/users', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users ORDER BY id');
    res.json({ success: true, users: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/users', async (req, res) => {
  try {
    const { name, email } = z.object({
      name: z.string().min(1),
      email: z.string().email()
    }).parse(req.body);

    const result = await db.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
      [name, email]
    );

    res.status(201).json({ success: true, user: result.rows[0] });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, email } = z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional()
    }).parse(req.body);

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (email) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(id);
    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, message: 'User deleted', user: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

const startServer = async () => {
  try {
    console.log('Starting PGlite server application...');
    console.log(`Environment: PORT=${PORT}, DATA_DIR=${dataDir}`);

    // Clean up stale lock file if it exists
    const lockFile = path.join(dataDir, 'postmaster.pid');
    if (fs.existsSync(lockFile)) {
      console.log('⚠️ Found stale postmaster.pid lock file. Removing it to allow startup...');
      try {
        fs.rmSync(lockFile);
        console.log('✅ Stale lock file removed.');
      } catch (err) {
        console.error('❌ Failed to remove lock file:', err);
      }
    }

    try {
      await initDB();
    } catch (dbError) {
      console.error('FATAL: Database initialization failed:', dbError);
      process.exit(1);
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🚀 PGlite HTTP Server is running!                   ║
║                                                        ║
║   📍 URL: http://localhost:${PORT}                      ║
║   💾 Data: ${dataDir.padEnd(40)}║
║                                                        ║
║   Endpoints:                                          ║
║   • GET  /health          - Health check              ║
║   • POST /query           - Execute SQL query         ║
║   • POST /transaction     - Execute transaction       ║
║   • GET  /tables          - List all tables           ║
║   • GET  /tables/:name/schema - Get table schema      ║
║   • GET  /export          - Export database           ║
║   • POST /import          - Import SQL                ║
║   • GET  /stats           - Database statistics       ║
║                                                        ║
║   Example CRUD (users table):                         ║
║   • GET    /users         - List all users            ║
║   • POST   /users         - Create user               ║
║   • GET    /users/:id     - Get user                  ║
║   • PUT    /users/:id     - Update user               ║
║   • DELETE /users/:id     - Delete user               ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

console.log('DEBUG: Calling startServer()...');
startServer();