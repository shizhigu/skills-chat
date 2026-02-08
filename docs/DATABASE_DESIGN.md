# Skills Chat - Database Design Document

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Schema Design Decisions](#schema-design-decisions)
3. [ORM Recommendation: Drizzle ORM](#orm-recommendation-drizzle-orm)
4. [Neon-Specific Configuration](#neon-specific-configuration)
5. [Table Reference](#table-reference)
6. [Indexing Strategy](#indexing-strategy)
7. [Key Query Patterns](#key-query-patterns)
8. [Streaming Message Handling](#streaming-message-handling)
9. [Soft Delete Pattern](#soft-delete-pattern)
10. [Usage & Billing Design](#usage--billing-design)
11. [Files Delivered](#files-delivered)

---

## Architecture Overview

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   React Router   │────>│  Drizzle ORM     │────>│  Neon PostgreSQL │
│   (Remix)        │     │  (neon-http)      │     │  (Serverless)    │
│                  │     │                  │     │                  │
│  - Route Loaders │     │  - Type-safe     │     │  - Auto-suspend  │
│  - Route Actions │     │  - SQL-like API  │     │  - Branching     │
│  - SSE Streaming │     │  - Relations     │     │  - Pooling       │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### Entity Relationship Diagram

```
users ──1:N──> sessions ──1:N──> messages ──1:N──> message_parts
  │                │                                     │
  │                ├── persona (M:1)                      ├── tool_call data
  │                ├── session_skills (M:N with skills)   ├── tool_result data
  │                ├── sandboxes (1:N)                    ├── file references
  │                └── files (1:N)                        └── text/reasoning
  │
  ├──1:N──> usage_daily
  ├──1:N──> usage_events
  └──1:N──> user_api_keys

personas ──M:N──> skills        (via persona_skills)
personas ──1:N──> mcp_server_configs
```

---

## Schema Design Decisions

### 1. Message Parts Pattern (vs. JSONB blob)

**Decision**: Use a dedicated `message_parts` table with typed columns rather than storing everything in a JSONB column on `messages`.

**Rationale**:
- PostgreSQL lacks statistics on JSONB internals, causing the query planner to produce suboptimal plans (up to 2000x slower in benchmarks)
- JSONB storage is ~2x larger than normalized equivalents
- The "parts" pattern (pioneered by Vercel AI SDK) keeps schema flexibility while maintaining queryability
- Each message can have multiple parts in order: text -> tool_call -> tool_result -> text
- Individual parts can be updated during streaming without rewriting the entire JSONB

**Trade-off**: JSONB is kept for genuinely semi-structured data that varies per instance: `tool_arguments`, `tool_result`, `provider_metadata`, `preferences`, `model_config`, `sandbox_config`. These fields have no fixed schema and are not queried by individual keys.

### 2. Session-Scoped System Prompt Snapshots

**Decision**: Store `system_prompt_snapshot` on each session rather than always joining to the persona.

**Rationale**:
- Personas can be edited after sessions are created
- Historical sessions must retain the exact system prompt used at conversation time
- This is critical for debugging and reproducibility
- Small storage cost (~2-5KB per session) is negligible vs. correctness

### 3. Integer Ordinals for Message Ordering

**Decision**: Use a monotonically increasing `ordinal` integer column instead of relying on `created_at` timestamps.

**Rationale**:
- Timestamps can collide (especially with bulk inserts or clock skew)
- Integer ordering is deterministic and gap-free
- Supports message insertion between existing messages (for edits/regenerations)
- Much faster for ORDER BY than timestamps

### 4. Denormalized Session Stats

**Decision**: Store `message_count`, `total_tokens`, `last_message_at` directly on the `sessions` table, updated via trigger.

**Rationale**:
- The session list sidebar is the most-queried view
- Eliminates COUNT/SUM aggregation queries on every page load
- Trigger-based updates ensure consistency without application complexity
- Acceptable trade-off: slight write overhead for dramatically faster reads

### 5. Dual Usage Tables (Daily + Events)

**Decision**: Two tables: `usage_daily` for billing roll-ups, `usage_events` for granular tracking.

**Rationale**:
- Billing queries always need date-range aggregations (fast on pre-aggregated daily rows)
- Debugging/analytics need individual event granularity
- `usage_events` can be partitioned by month and pruned after retention period
- `usage_daily` stays small and fast indefinitely

---

## ORM Recommendation: Drizzle ORM

### Verdict: Use Drizzle ORM over Prisma

| Factor | Drizzle | Prisma | Winner |
|--------|---------|--------|--------|
| **Bundle Size** | ~7.4KB min+gzip, 0 deps | ~2MB engine binary | Drizzle |
| **Cold Start** | Near-zero | 2-4s (engine init) | Drizzle |
| **Neon Integration** | Native `neon-http` driver | Requires adapter | Drizzle |
| **SQL Control** | SQL-like API, full control | Abstracted, less control | Drizzle |
| **Edge/Serverless** | First-class support | Requires Accelerate proxy | Drizzle |
| **Type Safety** | Query results typed | Full schema + query typed | Prisma |
| **DX/Learning Curve** | Steeper (SQL knowledge needed) | Gentler (abstracted) | Prisma |
| **Migrations** | `drizzle-kit` (declarative) | `prisma migrate` (mature) | Tie |
| **Relational Queries** | Via `relations()` declarations | Built-in `include` | Tie |
| **React Router/Remix** | Excellent (same patterns) | Good | Drizzle |

### Why Drizzle Wins for This Project

1. **Serverless-First Architecture**: Drizzle has zero cold-start overhead. With Neon's auto-suspend feature, every request after idle is essentially a cold start. Prisma's ~2-4s engine initialization penalty is unacceptable.

2. **Native Neon Driver**: Drizzle's `drizzle-orm/neon-http` driver uses Neon's HTTP protocol for single-query operations (most chat API calls). No WebSocket or TCP connection needed. Prisma requires the `@prisma/adapter-neon` adapter, adding complexity.

3. **Edge Compatibility**: React Router v7 supports edge runtimes. Drizzle works natively on Cloudflare Workers and Vercel Edge. Prisma requires their paid Accelerate proxy for edge deployment.

4. **SQL Transparency**: For a chat application with complex queries (message parts aggregation, streaming updates, usage roll-ups), Drizzle's SQL-like API gives direct control over the generated SQL without fighting an abstraction layer.

5. **Bundle Size**: At 7.4KB vs Prisma's ~2MB engine, Drizzle is critical for serverless where every KB matters for cold starts and Lambda/Worker size limits.

6. **Community Momentum**: Drizzle has become the de facto choice for new serverless TypeScript projects in 2025-2026. Vercel's own AI SDK persistence example uses Drizzle.

### Setup

```bash
# Install
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit

# Generate migrations from schema
npx drizzle-kit generate

# Push schema to Neon (dev) or run migrations (prod)
npx drizzle-kit push   # Development
npx drizzle-kit migrate # Production
```

---

## Neon-Specific Configuration

### 1. Connection String

```env
# Pooled connection (for application queries via PgBouncer)
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/skillschat?sslmode=require

# Direct connection (for migrations only)
DATABASE_URL_DIRECT=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech:5432/skillschat?sslmode=require
```

**Key points**:
- Use the **pooled** connection string (port 5432 omitted or `-pooler` suffix) for all application queries
- Use the **direct** connection string only for `drizzle-kit migrate` (DDL operations)
- Neon's PgBouncer supports up to 10,000 concurrent connections

### 2. Autoscaling Configuration

```
Recommended settings for Skills Chat:
- Min compute: 0.25 CU (auto-suspend to zero when idle)
- Max compute: 4 CU (scales up under load)
- Auto-suspend delay: 300 seconds (5 minutes)
- 1 CU = ~4GB RAM

For production:
- Min compute: 0.5 CU (faster wake-up, keep working set in memory)
- Max compute: 8 CU
- Auto-suspend delay: 600 seconds (10 minutes)
```

### 3. Database Branching Strategy

```
main (production)
  ├── dev (development - long-lived branch)
  │     ├── feature/persona-v2  (short-lived, reset from dev)
  │     └── feature/billing     (short-lived, reset from dev)
  ├── staging (pre-production - reset from main weekly)
  └── preview-pr-123 (ephemeral, auto-created per PR)
```

**Best practices**:
- Use Neon branching for preview deployments (each PR gets its own database branch)
- Branch from `main` for staging; branch from `dev` for feature work
- Branches share storage via copy-on-write, so branching is instant and costs nothing until data diverges

### 4. drizzle.config.ts for Neon

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Use DIRECT connection for migrations (DDL bypasses PgBouncer)
    url: process.env.DATABASE_URL_DIRECT!,
  },
  verbose: true,
  strict: true,
});
```

### 5. HTTP vs WebSocket Driver

| Use Case | Driver | Why |
|----------|--------|-----|
| API route handlers | `neon-http` | Single query per request, lowest latency |
| Streaming chat responses | `neon-serverless` (WebSocket) | Multiple queries during stream, need transactions |
| Background jobs | `neon-serverless` (Pool) | Long-lived connections for batch work |
| Edge functions | `neon-http` | HTTP works everywhere, no WebSocket needed |

```typescript
// For most routes: HTTP driver
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });

// For streaming/transactions: WebSocket driver
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const dbPool = drizzle(pool, { schema });
```

---

## Table Reference

| Table | Purpose | Row Growth | Key Indexes |
|-------|---------|------------|-------------|
| `users` | User accounts & preferences | Slow (user signups) | email (unique, partial) |
| `personas` | AI role definitions | Static (admin-managed) | slug (unique, partial) |
| `skills` | Skill definitions | Slow (admin-managed) | slug, category |
| `persona_skills` | Persona-to-skill mapping | Static | (persona_id, skill_id) unique |
| `sessions` | Chat conversations | Medium (user activity) | (user_id, last_message_at) |
| `messages` | Individual messages | Fast (chat volume) | (session_id, ordinal) |
| `message_parts` | Message content parts | Fast (multiple per msg) | (message_id, sort_order) |
| `session_skills` | Skills active per session | Medium | (session_id, skill_id) unique |
| `sandboxes` | Sandbox lifecycle tracking | Medium | session_id (partial unique) |
| `files` | Generated artifacts | Medium | session_id, message_id |
| `mcp_server_configs` | MCP server definitions | Static | persona_id |
| `usage_daily` | Daily usage roll-ups | Slow (1 row/user/day/model) | (user_id, date, model) unique |
| `usage_events` | Granular usage events | Fast (every API call) | (user_id, created_at) |
| `user_api_keys` | External API keys | Slow | (user_id, provider) |

---

## Indexing Strategy

### Partial Indexes (Soft Delete Optimization)

Every table with `deleted_at` uses partial indexes that exclude soft-deleted rows:

```sql
CREATE UNIQUE INDEX idx_users_email_active
  ON users (email) WHERE deleted_at IS NULL;
```

This means:
- Queries filtering `WHERE deleted_at IS NULL` use the smaller, faster index
- Soft-deleted rows do not bloat active indexes
- Unique constraints only apply to active records (re-registering a deleted email works)

### Covering Indexes for Hot Paths

The session sidebar query is the most frequent operation. The index on `(user_id, last_message_at DESC)` is a covering index that satisfies the entire WHERE + ORDER BY without a table scan.

### Composite Indexes for Message Retrieval

```sql
-- Messages are always fetched by session in ordinal order
CREATE INDEX idx_messages_session_ordinal ON messages (session_id, ordinal ASC);

-- Parts are always fetched by message in sort order
CREATE INDEX idx_parts_message_order ON message_parts (message_id, sort_order ASC);
```

These two indexes make "load a conversation" (the second most frequent query) a fast index-only scan followed by a simple join.

### Streaming State Index

```sql
CREATE INDEX idx_messages_streaming
  ON messages (session_id, status)
  WHERE status IN ('pending', 'streaming');
```

A partial index only covering in-progress messages. At any given time, very few messages are streaming, so this index stays tiny. Used to detect and recover from interrupted streams.

---

## Key Query Patterns

### Load Session Messages (Most Critical Query)

```typescript
// Drizzle relational query - generates optimal SQL with single JOIN
const messages = await db.query.messages.findMany({
  where: eq(schema.messages.sessionId, sessionId),
  orderBy: [asc(schema.messages.ordinal)],
  with: {
    parts: {
      orderBy: [asc(schema.messageParts.sortOrder)],
    },
  },
});
```

Expected performance: <10ms for sessions with <1000 messages.

### List User Sessions (Sidebar)

```typescript
const sessions = await db.query.sessions.findMany({
  where: and(
    eq(schema.sessions.userId, userId),
    isNull(schema.sessions.deletedAt),
    eq(schema.sessions.status, "active")
  ),
  orderBy: [desc(schema.sessions.lastMessageAt)],
  limit: 50,
  with: {
    persona: {
      columns: { name: true, avatarUrl: true },
    },
  },
});
```

Expected performance: <5ms (index-only scan on `idx_sessions_user_recent`).

### Insert Streaming Message

```typescript
// 1. Create message with 'streaming' status
const [message] = await db.insert(schema.messages).values({
  sessionId, role: "assistant", status: "streaming",
  ordinal: nextOrdinal, model: "claude-sonnet-4-20250514",
}).returning();

// 2. Create initial empty text part
const [part] = await db.insert(schema.messageParts).values({
  messageId: message.id, type: "text", sortOrder: 0, content: "",
}).returning();

// 3. During streaming: append text chunks
await db.update(schema.messageParts)
  .set({ content: sql`content || ${chunk}` })
  .where(eq(schema.messageParts.id, part.id));

// 4. On completion: finalize message
await db.update(schema.messages).set({
  status: "complete",
  promptTokens, completionTokens, totalTokens,
  timeToFirstTokenMs, totalDurationMs,
  completedAt: new Date(),
}).where(eq(schema.messages.id, message.id));
```

---

## Streaming Message Handling

### State Machine

```
                ┌─────────┐
                │ pending │  (message created, waiting for model)
                └────┬────┘
                     │
                     ▼
               ┌───────────┐
               │ streaming │  (tokens arriving, content being appended)
               └─────┬─────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
    ┌──────────┐ ┌───────┐ ┌───────────┐
    │ complete │ │ error │ │ cancelled │
    └──────────┘ └───────┘ └───────────┘
```

### Recovery from Interrupted Streams

On page reload, check for orphaned streaming messages:

```typescript
const orphaned = await db.query.messages.findMany({
  where: and(
    eq(schema.messages.sessionId, sessionId),
    eq(schema.messages.status, "streaming")
  ),
});

for (const msg of orphaned) {
  // Mark as error if streaming for too long (>5 min)
  if (Date.now() - msg.createdAt.getTime() > 300_000) {
    await db.update(schema.messages)
      .set({ status: "error" })
      .where(eq(schema.messages.id, msg.id));
  }
  // Otherwise, the client can attempt to resume
}
```

### Text Append Strategy

During streaming, text is appended to the `content` column using PostgreSQL's string concatenation:

```sql
UPDATE message_parts SET content = content || $1 WHERE id = $2
```

This is more efficient than reading the full text, concatenating in application code, and writing it back. For very long responses (>50KB), consider batching appends every 500ms instead of per-token.

---

## Soft Delete Pattern

### Implementation

All user-facing tables use a `deleted_at TIMESTAMPTZ` column:
- `NULL` = active record
- Timestamp = soft-deleted at that time

### Rules

1. **Partial indexes** exclude deleted rows: `WHERE deleted_at IS NULL`
2. **Unique constraints** only apply to active rows (allows re-use of slugs/emails after deletion)
3. **All application queries** must include `AND deleted_at IS NULL` (enforced at the Drizzle query layer)
4. **Cascading deletes** use hard deletes via `ON DELETE CASCADE` for child records (e.g., deleting a session hard-deletes its messages)
5. **Periodic cleanup**: A cron job should hard-delete records where `deleted_at < NOW() - INTERVAL '90 days'`

### Which Tables Use Soft Delete

| Table | Soft Delete | Rationale |
|-------|-------------|-----------|
| users | Yes | Account recovery, legal compliance |
| personas | Yes | Referenced by existing sessions |
| skills | Yes | Referenced by existing persona_skills |
| sessions | Yes | User may want to recover |
| messages | No | Cascade-deleted with session |
| message_parts | No | Cascade-deleted with message |
| files | Yes | May need recovery, storage cleanup |
| mcp_server_configs | Yes | Audit trail |
| sandboxes | No | Lifecycle tracked via status enum |

---

## Usage & Billing Design

### Cost Calculation

Costs are stored in **microdollars** (1 USD = 1,000,000 microdollars) to avoid floating-point precision issues:

```typescript
function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing: Record<string, { input: number; output: number }> = {
    "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },    // per 1M tokens
    "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
    "claude-haiku-3-20240307": { input: 0.25, output: 1.25 },
  };

  const p = pricing[model] ?? pricing["claude-sonnet-4-20250514"];
  const inputCost = (promptTokens / 1_000_000) * p.input;
  const outputCost = (completionTokens / 1_000_000) * p.output;
  // Convert to microdollars
  return Math.round((inputCost + outputCost) * 1_000_000);
}
```

### Roll-up Strategy

After each assistant message completes:

1. Insert into `usage_events` (granular event)
2. Upsert into `usage_daily` (daily roll-up):

```sql
INSERT INTO usage_daily (user_id, date, model, prompt_tokens, completion_tokens,
                         total_tokens, message_count, cost_microdollars)
VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, 1, $6)
ON CONFLICT (user_id, date, model)
DO UPDATE SET
  prompt_tokens = usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
  completion_tokens = usage_daily.completion_tokens + EXCLUDED.completion_tokens,
  total_tokens = usage_daily.total_tokens + EXCLUDED.total_tokens,
  message_count = usage_daily.message_count + 1,
  cost_microdollars = usage_daily.cost_microdollars + EXCLUDED.cost_microdollars,
  updated_at = NOW();
```

---

## Files Delivered

| File | Description |
|------|-------------|
| `DATABASE_SCHEMA.sql` | Complete SQL schema with CREATE TABLE, indexes, triggers, seed data |
| `drizzle-schema.ts` | Drizzle ORM TypeScript schema (place at `src/db/schema.ts`) |
| `db-client.ts` | Database client setup + example query functions (place at `src/db/index.ts`) |
| `DATABASE_DESIGN.md` | This design document |

---

## Research Sources

- [Vercel AI SDK Persistence DB](https://github.com/vercel-labs/ai-sdk-persistence-db) - Message parts pattern reference
- [Vercel AI SDK: Chatbot Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) - Streaming state handling
- [Drizzle ORM + Neon Setup](https://orm.drizzle.team/docs/get-started/neon-new) - Official Drizzle/Neon integration
- [Neon Connection Pooling Docs](https://neon.com/docs/connect/connection-pooling) - PgBouncer configuration
- [Neon Serverless Driver](https://neon.com/docs/serverless/serverless-driver) - HTTP vs WebSocket drivers
- [When to Avoid JSONB in PostgreSQL](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema) - JSONB performance analysis
- [JSONB vs Join Query Performance](https://medium.com/@sruthiganesh/part-2-comparing-normalised-query-performance-in-postgresql-jsonb-vs-join-queries-ed63ef2da7cd) - Benchmark data
- [Soft Delete Pattern in Postgres](http://rockwood.me/2018/soft-delete-pattern-in-postgres/) - Partial index strategy
- [Soft Deletion with PostgreSQL (Evil Martians)](https://evilmartians.com/chronicles/soft-deletion-with-postgresql-but-with-logic-on-the-database) - Database-level enforcement
- [Drizzle vs Prisma (Bytebase)](https://www.bytebase.com/blog/drizzle-vs-prisma/) - Comprehensive ORM comparison
- [Drizzle vs Prisma (Better Stack)](https://betterstack.com/community/guides/scaling-nodejs/drizzle-vs-prisma/) - Performance benchmarks
- [Neon 2025 Deep Dive](https://dev.to/dataformathub/neon-postgres-deep-dive-why-the-2025-updates-change-serverless-sql-5o0) - Autoscaling and branching
- [Mastering Neon Serverless PostgreSQL](https://dev.to/hexshift/mastering-neon-a-pros-guide-to-using-serverless-postgresql-ei5) - Best practices guide
