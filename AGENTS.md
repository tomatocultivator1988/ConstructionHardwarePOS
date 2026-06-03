# BuildPro POS — Serverless Migration Plan (Approach B)

## Architecture Change

| Layer | Before (Desktop EXE) | After (Vercel Serverless) |
|-------|---------------------|---------------------------|
| **Database** | `sql.js` (file-based, in-process) | **Turso** (distributed SQLite, HTTP) |
| **Backend** | Express 5 long-running server | **Vercel Functions** (Express via `@vercel/node`) |
| **Frontend** | Vite SPA served by Express | **Vite static build** (Vercel auto-detects) |
| **Auth** | JWT + bcryptjs (same) | JWT + bcryptjs (no change needed) |
| **DB file** | `data/construction_pos.db` | Turso URL + auth token (env vars) |
| **Distribution** | pkg EXE (79 MB) | URL (zero install) |

## Why This Works
- Turso speaks the **exact same SQLite dialect** — all 50+ SQL queries stay identical
- `@libsql/client` API mimics the current sql.js `prepare/run/get/all` pattern
- `jsonwebtoken` + `bcryptjs` both work on Vercel's Node runtime
- Vercel's `@vercel/node` adapter runs Express apps as serverless functions
- Frontend is already a static Vite build — deploys with zero changes

---

## Dependencies to Change

### Add
```
@libsql/client     — Turso SQLite client (HTTP-based, no native deps)
@vercel/node       — Express → Vercel function adapter
```

### Remove
```
sql.js             — no longer needed (file-based SQLite)
pkg                — no longer needed (EXE packaging)
```

### Keep (all compatible with Vercel)
```
express, cors, helmet, morgan, uuid, dotenv
express-rate-limit, jsonwebtoken, bcryptjs, jspdf
```

---

## Database Layer Rewrite

### `backend/src/db/database.ts` — Complete Rewrite

```typescript
// BEFORE: initSqlJs() + fs.readFile/writeFile + custom Database class
// AFTER:  @libsql/client with same prepare/run/get/all/txn API

import { createClient, Client } from '@libsql/client';

const TURSO_URL = process.env.TURSO_URL!;
const TURSO_TOKEN = process.env.TURSO_TOKEN!;

let client: Client;

export async function initDatabase(): Promise<void> {
  client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
}

export class Database {
  prepare(sql: string) {
    const stmt = { sql, params: [] as any[] };
    return {
      bind(...params: any[]) { stmt.params = params; return this; },
      run: async (...params: any[]) => {
        await client.execute({ sql: stmt.sql, args: params.length ? params : stmt.params });
        return { changes: 1, lastInsertRowid: 0 };
      },
      get: async (...params: any[]) => {
        const r = await client.execute({ sql: stmt.sql, args: params.length ? params : stmt.params });
        return r.rows[0] || null;
      },
      all: async (...params: any[]) => {
        const r = await client.execute({ sql: stmt.sql, args: params.length ? params : stmt.params });
        return r.rows;
      }
    };
  }
  async exec(sql: string) {
    await client.executeMultiple(sql);
  }
  transaction(fn: () => void) {
    // Turso supports native SQLite transactions via client.transaction()
    return async () => {
      const txn = await client.transaction();
      try {
        await fn();
        await txn.commit();
      } catch (e) {
        await txn.rollback();
        throw e;
      }
    };
  }
}
```

**Key differences from current API:**
- All queries become `async` (Turso is HTTP-based)
- Route handlers need `await` before every DB call
- `transaction()` becomes async

### `backend/src/db/setup.ts` — Minor Changes

```typescript
// BEFORE: const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'construction_pos.db');
// AFTER:  No file path needed. Turso URL from env.

export async function initDb(): Promise<void> {
  if (db) return;
  await initDatabase();
  db = new Database();
  await initTables();
  await migrateSchema();
}
```

### `backend/src/sql.js.d.ts` — DELETE this file
No longer needed.

---

## All Routes Need `async/await`

Every route file must have `await` prepended to all DB calls. Pattern change:

```typescript
// BEFORE (sql.js — synchronous)
const materials = db.prepare('SELECT * FROM materials').all();

// AFTER (Turso — async)
const materials = await db.prepare('SELECT * FROM materials').all();
```

**Files affected** (all `backend/src/routes/*.ts`):
- `customers.ts`
- `materials.ts`
- `invoices.ts` (complex — transaction logic needs rewrite)
- `payments.ts`
- `analytics.ts`
- `expenses.ts`
- `suppliers.ts`
- `purchase-orders.ts`
- `reports.ts`
- `stock-movements.ts`
- `settings.ts`
- `auth.ts`
- `audit.ts`
- `users.ts`

**Plus**: `backend/src/lib/audit.ts`

---

## Vercel Configuration

### `vercel.json` (at project root)

```json
{
  "buildCommand": "cd frontend && npm run build",
  "outputDirectory": "frontend/dist",
  "installCommand": "cd backend && npm install && cd ../frontend && npm install",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" }
  ],
  "functions": {
    "api/index.js": {
      "memory": 512,
      "maxDuration": 10
    }
  }
}
```

### `api/index.ts` (Vercel function entry point)

```typescript
import app from '../backend/src/index';
export default app;
```

This requires `@vercel/node` which auto-wraps Express apps.

---

## Environment Variables

Create these in Vercel dashboard or `.env`:

```
TURSO_URL=libsql://buildpro-XXXX.turso.io
TURSO_TOKEN=eyJhbGciOiJFZE...
JWT_SECRET=random-string-here
```

For local dev, add to `backend/.env`:
```
TURSO_URL=libsql://buildpro-XXXX.turso.io
TURSO_TOKEN=eyJ...
JWT_SECRET=dev-secret
CORS_ORIGIN=http://localhost:5173
```

---

## Implementation Order

### Step 1: Turso Setup (5 min)
1. Create free account at turso.tech
2. Create database: `turso db create buildpro`
3. Get URL + token: `turso db show buildpro` / `turso db tokens create buildpro`
4. Set env vars

### Step 2: Database Layer (30 min)
1. `npm install @libsql/client` (and remove `sql.js`)
2. Rewrite `backend/src/db/database.ts`
3. Update `backend/src/db/setup.ts`
4. Delete `backend/src/sql.js.d.ts`
5. Update `backend/src/lib/audit.ts` to be async

### Step 3: Route Async Conversion (60 min)
Run through all 14 route files and:
1. Add `await` before every `db.prepare(...).run()` / `.get()` / `.all()`
2. Wrap transactions with `await`
3. Test each route

### Step 4: Vercel Config (10 min)
1. Create `vercel.json` at root
2. Create `api/index.ts`
3. Install `@vercel/node` in backend
4. Update `package.json` with vercel dev script

### Step 5: Frontend Update (5 min)
1. Update `vite.config.ts` to remove proxy (Vercel handles it)
2. Or keep for local dev — proxy only active in `mode: 'development'`

### Step 6: Deploy (5 min)
1. `vercel` CLI or connect GitHub repo
2. Set env vars in Vercel dashboard
3. Deploy

---

## Files NOT Changed

- All frontend views — **zero changes**
- All frontend types, helpers, router — **zero changes**
- Chart.js, CSS — **zero changes**
- `index.html` — **zero changes**
- SQL queries inside routes — **zero changes** (same SQLite dialect)

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Turso cold start latency | 50-200ms typical; POS volume is low |
| Schema migrations run on each cold start | `CREATE TABLE IF NOT EXISTS` is idempotent, safe |
| Transactions differ slightly | Turso `@libsql/client` supports `transaction()` natively |
| jspdf works on Vercel | jspdf is pure JS, no native deps — works |
| bcrypt works on Vercel | bcryptjs is pure JS — works |

---

## Local Development (After Migration)

```bash
# Terminal 1 — Backend (connects to Turso)
cd backend && npm run dev

# Terminal 2 — Frontend (Vite dev server)
cd frontend && npm run dev

# Open http://localhost:5173
```

The desktop EXE version is preserved in `D:\Construction POS-backup.zip`.

---

## Checklist

- [ ] Create Turso account + database
- [ ] Install @libsql/client, remove sql.js
- [ ] Rewrite database.ts (Turso client wrapper)
- [ ] Make setup.ts async
- [ ] Delete sql.js.d.ts
- [ ] Make audit.ts async
- [ ] Convert all route files to async/await + fix transactions
- [ ] Install @vercel/node
- [ ] Create vercel.json
- [ ] Create api/index.ts
- [ ] Set env vars
- [ ] Test all endpoints locally
- [ ] Build frontend, verify
- [ ] Deploy to Vercel
- [ ] Verify deployed app
