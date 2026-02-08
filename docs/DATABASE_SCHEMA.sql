-- ============================================================================
-- Skills Chat - Complete Database Schema for Neon (Serverless PostgreSQL)
-- ============================================================================
-- Version: 1.0.0
-- Database: Neon Serverless PostgreSQL (v16+)
-- ORM: Drizzle ORM (recommended, see rationale below)
-- Generated: 2026-02-08
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- For gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- For trigram-based text search

-- ============================================================================
-- CUSTOM TYPES (Enums)
-- ============================================================================

CREATE TYPE user_role AS ENUM ('user', 'admin', 'superadmin');
CREATE TYPE auth_provider AS ENUM ('email', 'google', 'github', 'apple');
CREATE TYPE session_status AS ENUM ('active', 'archived', 'deleted');
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system', 'tool');
CREATE TYPE message_status AS ENUM ('pending', 'streaming', 'complete', 'error', 'cancelled');
CREATE TYPE part_type AS ENUM (
  'text',
  'reasoning',
  'tool_call',
  'tool_result',
  'file',
  'image',
  'error'
);
CREATE TYPE sandbox_status AS ENUM ('creating', 'running', 'paused', 'stopped', 'error', 'destroyed');
CREATE TYPE sandbox_provider AS ENUM ('e2b', 'docker', 'webcontainer');
CREATE TYPE file_source AS ENUM ('upload', 'generated', 'sandbox');
CREATE TYPE persona_visibility AS ENUM ('public', 'private', 'unlisted');
CREATE TYPE skill_category AS ENUM (
  'product', 'engineering', 'design', 'management',
  'sales', 'marketing', 'strategy', 'general'
);
CREATE TYPE persona_skill_type AS ENUM ('default', 'optional');
CREATE TYPE mcp_transport AS ENUM ('stdio', 'sse', 'streamable_http');


-- ============================================================================
-- 1. USERS
-- ============================================================================

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Authentication
  email           VARCHAR(255) NOT NULL,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash   VARCHAR(255),            -- NULL for OAuth-only users
  auth_provider   auth_provider NOT NULL DEFAULT 'email',
  auth_provider_id VARCHAR(255),           -- External provider user ID

  -- Profile
  name            VARCHAR(100) NOT NULL,
  avatar_url      VARCHAR(500),
  bio             TEXT,
  role            user_role NOT NULL DEFAULT 'user',

  -- Preferences (JSONB for flexible, evolving schema)
  preferences     JSONB NOT NULL DEFAULT '{
    "theme": "system",
    "language": "zh-CN",
    "defaultModel": "claude-sonnet-4-20250514",
    "sendOnEnter": true,
    "showTokenUsage": false,
    "notificationsEnabled": true
  }'::jsonb,

  -- Soft delete & timestamps
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique email constraint only for non-deleted users
CREATE UNIQUE INDEX idx_users_email_active
  ON users (email) WHERE deleted_at IS NULL;

-- Auth provider lookup
CREATE INDEX idx_users_auth_provider
  ON users (auth_provider, auth_provider_id) WHERE deleted_at IS NULL;

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- 2. PERSONAS
-- ============================================================================

CREATE TABLE personas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            VARCHAR(100) NOT NULL,    -- URL-friendly identifier
  name            VARCHAR(100) NOT NULL,
  description     TEXT NOT NULL,
  avatar_url      VARCHAR(500),
  category        skill_category NOT NULL DEFAULT 'general',

  -- Core prompt configuration
  system_prompt   TEXT NOT NULL,
  greeting_message TEXT,                    -- First message shown to user

  -- Model configuration
  default_model   VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  model_config    JSONB NOT NULL DEFAULT '{
    "maxTokens": 8192,
    "temperature": 0.7,
    "topP": 0.9
  }'::jsonb,

  -- Sandbox configuration
  sandbox_config  JSONB NOT NULL DEFAULT '{
    "enabled": false,
    "provider": "e2b",
    "template": "base",
    "timeoutMs": 300000,
    "maxMemoryMb": 512,
    "maxCpuCores": 1,
    "allowNetworkAccess": true
  }'::jsonb,

  -- Tool permissions - which tools this persona can use
  tool_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Example: ["Bash", "Read", "Write", "WebSearch", "WebFetch"]

  -- Visibility and ownership
  visibility      persona_visibility NOT NULL DEFAULT 'public',
  is_builtin      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Ordering
  sort_order      INTEGER NOT NULL DEFAULT 0,

  -- Soft delete & timestamps
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_personas_slug_active
  ON personas (slug) WHERE deleted_at IS NULL;

CREATE INDEX idx_personas_visibility
  ON personas (visibility, category, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_personas_created_by
  ON personas (created_by) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_personas_updated_at
  BEFORE UPDATE ON personas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- 3. SKILLS
-- ============================================================================

CREATE TABLE skills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            VARCHAR(100) NOT NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT NOT NULL,
  category        skill_category NOT NULL DEFAULT 'general',

  -- Skill prompt (injected into system message when active)
  prompt          TEXT NOT NULL,

  -- Output format guidance
  output_format   TEXT,

  -- Tool requirements for this skill
  required_tools  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Example: ["WebSearch", "Read", "Write"]

  -- Dependencies on other skills
  dependencies    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Example: ["skill-slug-1", "skill-slug-2"]

  -- Metadata
  icon            VARCHAR(100),
  is_builtin      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Usage stats (denormalized for display performance)
  usage_count     BIGINT NOT NULL DEFAULT 0,

  -- Soft delete & timestamps
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_skills_slug_active
  ON skills (slug) WHERE deleted_at IS NULL;

CREATE INDEX idx_skills_category
  ON skills (category) WHERE deleted_at IS NULL;

CREATE INDEX idx_skills_builtin
  ON skills (is_builtin, category) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_skills_updated_at
  BEFORE UPDATE ON skills
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- 4. PERSONA-SKILL MAPPINGS
-- ============================================================================

CREATE TABLE persona_skills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id      UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  skill_id        UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  skill_type      persona_skill_type NOT NULL DEFAULT 'optional',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_persona_skills_unique
  ON persona_skills (persona_id, skill_id);

CREATE INDEX idx_persona_skills_persona
  ON persona_skills (persona_id, skill_type, sort_order);


-- ============================================================================
-- 5. SESSIONS (Conversations)
-- ============================================================================

CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona_id      UUID NOT NULL REFERENCES personas(id) ON DELETE RESTRICT,

  -- Session metadata
  title           VARCHAR(255),             -- Auto-generated or user-edited
  title_generated BOOLEAN NOT NULL DEFAULT FALSE,
  status          session_status NOT NULL DEFAULT 'active',

  -- Model used in this session (may differ from persona default)
  model           VARCHAR(100) NOT NULL,

  -- System prompt snapshot (frozen at session creation for consistency)
  system_prompt_snapshot TEXT NOT NULL,

  -- Active skills in this session (mutable during session)
  -- Stored as JSONB array of skill IDs for fast reads
  active_skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Sandbox reference (if sandbox is active for this session)
  sandbox_id      UUID,                     -- FK added after sandbox table creation

  -- Aggregate stats (denormalized, updated on message insert)
  message_count   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  last_message_at TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User's sessions ordered by recency (the primary query pattern)
CREATE INDEX idx_sessions_user_recent
  ON sessions (user_id, last_message_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- Sessions by status for user
CREATE INDEX idx_sessions_user_status
  ON sessions (user_id, status)
  WHERE deleted_at IS NULL;

-- Sessions by persona (for analytics)
CREATE INDEX idx_sessions_persona
  ON sessions (persona_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- 6. MESSAGES
-- ============================================================================
-- Design decision: Messages use a "parts" pattern (inspired by Vercel AI SDK).
-- Each message has one or more parts (text, tool_call, tool_result, file, etc.)
-- stored in a separate table. This avoids JSONB bloat in the messages table
-- while keeping the schema flexible for new part types.
-- ============================================================================

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role            message_role NOT NULL,
  status          message_status NOT NULL DEFAULT 'complete',

  -- Ordering: monotonically increasing within a session
  -- Using an integer rather than relying on timestamp for deterministic ordering
  ordinal         INTEGER NOT NULL,

  -- Model metadata (for assistant messages)
  model           VARCHAR(100),

  -- Token usage
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  total_tokens    INTEGER,

  -- Latency tracking (ms from request to first token, and to completion)
  time_to_first_token_ms INTEGER,
  total_duration_ms INTEGER,

  -- For edited/regenerated messages: link to the original
  parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ                         -- When streaming finished
);

-- Primary access pattern: get all messages for a session in order
CREATE INDEX idx_messages_session_ordinal
  ON messages (session_id, ordinal ASC);

-- For streaming: find in-progress messages
CREATE INDEX idx_messages_streaming
  ON messages (session_id, status)
  WHERE status IN ('pending', 'streaming');

-- Unique ordinal within session
CREATE UNIQUE INDEX idx_messages_session_ordinal_unique
  ON messages (session_id, ordinal);


-- ============================================================================
-- 7. MESSAGE PARTS
-- ============================================================================
-- Each message is composed of one or more parts. This is the core flexibility
-- mechanism: a single assistant message might contain text + tool_call + text.
-- ============================================================================

CREATE TABLE message_parts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  type            part_type NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,   -- Order within the message

  -- === TEXT / REASONING ===
  content         TEXT,                          -- Text content or reasoning text

  -- === TOOL CALL ===
  tool_call_id    VARCHAR(255),                  -- Unique ID for matching call<->result
  tool_name       VARCHAR(255),                  -- Tool function name
  tool_arguments  JSONB,                         -- Arguments passed to the tool
  tool_state      VARCHAR(50),                   -- 'pending' | 'running' | 'complete' | 'error'

  -- === TOOL RESULT ===
  tool_result     JSONB,                         -- Structured result from tool execution
  tool_error      TEXT,                          -- Error message if tool failed
  tool_duration_ms INTEGER,                      -- How long the tool execution took

  -- === FILE / IMAGE ===
  file_url        VARCHAR(500),
  file_name       VARCHAR(255),
  file_media_type VARCHAR(100),                  -- MIME type
  file_size_bytes BIGINT,

  -- === PROVIDER METADATA ===
  -- Catch-all for model-specific metadata (stop reason, safety ratings, etc.)
  provider_metadata JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Get all parts for a message in order
CREATE INDEX idx_parts_message_order
  ON message_parts (message_id, sort_order ASC);

-- Find tool results by tool_call_id (for matching call <-> result)
CREATE INDEX idx_parts_tool_call_id
  ON message_parts (tool_call_id)
  WHERE tool_call_id IS NOT NULL;

-- Find parts by type within a session (via message join)
CREATE INDEX idx_parts_type
  ON message_parts (type);


-- ============================================================================
-- 8. SESSION SKILLS (Active skills per session, with activation history)
-- ============================================================================

CREATE TABLE session_skills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  skill_id        UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_session_skills_unique
  ON session_skills (session_id, skill_id);

CREATE INDEX idx_session_skills_session
  ON session_skills (session_id, is_active);


-- ============================================================================
-- 9. SANDBOXES
-- ============================================================================

CREATE TABLE sandboxes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- Sandbox identity
  provider        sandbox_provider NOT NULL DEFAULT 'e2b',
  external_id     VARCHAR(255),              -- ID from E2B/Docker/etc.
  status          sandbox_status NOT NULL DEFAULT 'creating',

  -- Configuration snapshot
  template        VARCHAR(100) NOT NULL DEFAULT 'base',
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Resource usage
  cpu_cores       NUMERIC(4,2),
  memory_mb       INTEGER,
  disk_mb         INTEGER,

  -- Lifecycle
  started_at      TIMESTAMPTZ,
  last_active_at  TIMESTAMPTZ,
  stopped_at      TIMESTAMPTZ,
  timeout_at      TIMESTAMPTZ,               -- When sandbox will auto-destroy
  error_message   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active sandbox per session
CREATE UNIQUE INDEX idx_sandboxes_session_active
  ON sandboxes (session_id)
  WHERE status IN ('creating', 'running', 'paused');

CREATE INDEX idx_sandboxes_status
  ON sandboxes (status, timeout_at);

-- Now add the FK from sessions to sandboxes
ALTER TABLE sessions
  ADD CONSTRAINT fk_sessions_sandbox
  FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE SET NULL;

CREATE TRIGGER trg_sandboxes_updated_at
  BEFORE UPDATE ON sandboxes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- 10. FILES / ARTIFACTS
-- ============================================================================

CREATE TABLE files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,
  sandbox_id      UUID REFERENCES sandboxes(id) ON DELETE SET NULL,

  -- File metadata
  name            VARCHAR(255) NOT NULL,
  path            VARCHAR(1000),                -- Path within sandbox
  media_type      VARCHAR(100) NOT NULL,
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  source          file_source NOT NULL DEFAULT 'generated',

  -- Storage
  storage_key     VARCHAR(500) NOT NULL,        -- S3/R2 object key
  storage_bucket  VARCHAR(100) NOT NULL DEFAULT 'skills-chat-files',
  download_url    VARCHAR(1000),                -- Pre-signed URL (cached, refreshed)
  url_expires_at  TIMESTAMPTZ,

  -- Version tracking (for files that get updated during session)
  version         INTEGER NOT NULL DEFAULT 1,
  parent_file_id  UUID REFERENCES files(id) ON DELETE SET NULL,

  -- Soft delete & timestamps
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_files_session
  ON files (session_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX idx_files_message
  ON files (message_id) WHERE message_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_files_sandbox
  ON files (sandbox_id) WHERE sandbox_id IS NOT NULL AND deleted_at IS NULL;


-- ============================================================================
-- 11. MCP SERVER CONFIGURATIONS
-- ============================================================================

CREATE TABLE mcp_server_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id      UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,

  -- Server identity
  name            VARCHAR(100) NOT NULL,
  description     TEXT,

  -- Connection config
  transport       mcp_transport NOT NULL DEFAULT 'stdio',
  command         VARCHAR(500),                  -- For stdio: command to run
  args            JSONB DEFAULT '[]'::jsonb,     -- For stdio: command arguments
  url             VARCHAR(500),                  -- For sse/http: endpoint URL
  headers         JSONB DEFAULT '{}'::jsonb,     -- For sse/http: custom headers

  -- Environment variables (encrypted at app level before storage)
  env_vars        JSONB DEFAULT '{}'::jsonb,

  -- Tool filtering: which tools from this server to expose
  allowed_tools   JSONB,                         -- NULL = all tools allowed
  -- Example: ["tool1", "tool2"]

  -- Enable/disable
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mcp_configs_persona
  ON mcp_server_configs (persona_id, is_enabled)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_mcp_configs_updated_at
  BEFORE UPDATE ON mcp_server_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================================
-- 12. USAGE / BILLING
-- ============================================================================

-- Per-message usage is stored directly on the messages table (prompt_tokens,
-- completion_tokens, total_tokens). This table provides daily roll-ups for
-- billing and analytics dashboards.

CREATE TABLE usage_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  model           VARCHAR(100) NOT NULL,

  -- Token counts
  prompt_tokens   BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens    BIGINT NOT NULL DEFAULT 0,

  -- Session/message counts
  session_count   INTEGER NOT NULL DEFAULT 0,
  message_count   INTEGER NOT NULL DEFAULT 0,

  -- Cost tracking (in microdollars: $1 = 1_000_000)
  cost_microdollars BIGINT NOT NULL DEFAULT 0,

  -- Sandbox usage
  sandbox_seconds INTEGER NOT NULL DEFAULT 0,
  sandbox_cost_microdollars BIGINT NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per user/date/model
CREATE UNIQUE INDEX idx_usage_daily_unique
  ON usage_daily (user_id, date, model);

-- For billing queries: sum usage over a date range
CREATE INDEX idx_usage_daily_user_date
  ON usage_daily (user_id, date DESC);

-- For admin dashboards
CREATE INDEX idx_usage_daily_date
  ON usage_daily (date DESC, model);

CREATE TRIGGER trg_usage_daily_updated_at
  BEFORE UPDATE ON usage_daily
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- Individual usage events for fine-grained tracking
CREATE TABLE usage_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id      UUID REFERENCES sessions(id) ON DELETE SET NULL,
  message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,

  -- Event details
  event_type      VARCHAR(50) NOT NULL,       -- 'chat', 'sandbox', 'file_upload', etc.
  model           VARCHAR(100),
  prompt_tokens   INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens    INTEGER DEFAULT 0,
  cost_microdollars BIGINT DEFAULT 0,

  -- Additional context
  metadata        JSONB DEFAULT '{}'::jsonb,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partition usage_events by month for efficient querying and cleanup
-- (In production, use declarative partitioning)
CREATE INDEX idx_usage_events_user
  ON usage_events (user_id, created_at DESC);

CREATE INDEX idx_usage_events_session
  ON usage_events (session_id) WHERE session_id IS NOT NULL;

CREATE INDEX idx_usage_events_type_date
  ON usage_events (event_type, created_at DESC);


-- ============================================================================
-- 13. USER API KEYS (for future multi-model support)
-- ============================================================================

CREATE TABLE user_api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        VARCHAR(50) NOT NULL,          -- 'anthropic', 'openai', etc.
  key_hash        VARCHAR(255) NOT NULL,         -- Hashed API key
  key_prefix      VARCHAR(10) NOT NULL,          -- First few chars for display
  label           VARCHAR(100),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user
  ON user_api_keys (user_id, provider) WHERE is_active = TRUE;


-- ============================================================================
-- 14. HELPER FUNCTIONS
-- ============================================================================

-- Function to get the next message ordinal for a session
CREATE OR REPLACE FUNCTION next_message_ordinal(p_session_id UUID)
RETURNS INTEGER AS $$
  SELECT COALESCE(MAX(ordinal), 0) + 1
  FROM messages
  WHERE session_id = p_session_id;
$$ LANGUAGE sql;

-- Function to update session aggregate stats after message insert
CREATE OR REPLACE FUNCTION update_session_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE sessions SET
    message_count = message_count + 1,
    total_tokens = total_tokens + COALESCE(NEW.total_tokens, 0),
    last_message_at = NEW.created_at,
    updated_at = NOW()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_update_session_stats
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_session_stats();

-- Function to auto-generate session title from first user message
CREATE OR REPLACE FUNCTION maybe_set_session_title()
RETURNS TRIGGER AS $$
DECLARE
  v_first_text TEXT;
  v_session sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = NEW.session_id;

  -- Only auto-title if title is not yet set
  IF v_session.title IS NULL AND NEW.role = 'user' THEN
    -- Get the first text part of this message
    SELECT content INTO v_first_text
    FROM message_parts
    WHERE message_id = NEW.id AND type = 'text'
    ORDER BY sort_order LIMIT 1;

    IF v_first_text IS NOT NULL THEN
      UPDATE sessions
      SET title = LEFT(v_first_text, 100),
          title_generated = TRUE
      WHERE id = NEW.session_id AND title IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: Title generation is better handled at the application layer
-- (using LLM to summarize the conversation). This trigger serves as a
-- fallback to set a basic title from the first message.


-- ============================================================================
-- KEY QUERIES
-- ============================================================================

-- ── Q1: List user's recent sessions (sidebar) ──
-- This is the most frequent query. The covering index on
-- (user_id, last_message_at DESC) makes this very fast.

-- SELECT
--   s.id, s.title, s.status, s.last_message_at, s.message_count,
--   p.name AS persona_name, p.avatar_url AS persona_avatar
-- FROM sessions s
-- JOIN personas p ON p.id = s.persona_id
-- WHERE s.user_id = :userId
--   AND s.deleted_at IS NULL
--   AND s.status = 'active'
-- ORDER BY s.last_message_at DESC NULLS LAST
-- LIMIT 50;


-- ── Q2: Get all messages for a session (loading a chat) ──
-- Uses the (session_id, ordinal) index. Parts are eagerly loaded
-- to avoid N+1 queries.

-- SELECT
--   m.id, m.role, m.status, m.ordinal, m.model,
--   m.prompt_tokens, m.completion_tokens, m.total_tokens,
--   m.time_to_first_token_ms, m.total_duration_ms,
--   m.created_at, m.completed_at,
--   json_agg(
--     json_build_object(
--       'id', mp.id,
--       'type', mp.type,
--       'sort_order', mp.sort_order,
--       'content', mp.content,
--       'tool_call_id', mp.tool_call_id,
--       'tool_name', mp.tool_name,
--       'tool_arguments', mp.tool_arguments,
--       'tool_state', mp.tool_state,
--       'tool_result', mp.tool_result,
--       'tool_error', mp.tool_error,
--       'tool_duration_ms', mp.tool_duration_ms,
--       'file_url', mp.file_url,
--       'file_name', mp.file_name,
--       'file_media_type', mp.file_media_type,
--       'file_size_bytes', mp.file_size_bytes,
--       'provider_metadata', mp.provider_metadata
--     ) ORDER BY mp.sort_order
--   ) AS parts
-- FROM messages m
-- LEFT JOIN message_parts mp ON mp.message_id = m.id
-- WHERE m.session_id = :sessionId
-- GROUP BY m.id
-- ORDER BY m.ordinal ASC;


-- ── Q3: Get persona with its skills ──

-- SELECT
--   p.*,
--   json_agg(
--     json_build_object(
--       'id', s.id,
--       'slug', s.slug,
--       'name', s.name,
--       'description', s.description,
--       'category', s.category,
--       'icon', s.icon,
--       'type', ps.skill_type
--     ) ORDER BY ps.skill_type, ps.sort_order
--   ) AS skills
-- FROM personas p
-- LEFT JOIN persona_skills ps ON ps.persona_id = p.id
-- LEFT JOIN skills s ON s.id = ps.skill_id AND s.deleted_at IS NULL
-- WHERE p.id = :personaId
--   AND p.deleted_at IS NULL
-- GROUP BY p.id;


-- ── Q4: Create a new session ──

-- INSERT INTO sessions (user_id, persona_id, model, system_prompt_snapshot, active_skill_ids)
-- VALUES (
--   :userId,
--   :personaId,
--   :model,
--   :assembledSystemPrompt,
--   :activeSkillIdsJsonb
-- )
-- RETURNING *;


-- ── Q5: Insert a message with parts (using CTE) ──

-- WITH new_message AS (
--   INSERT INTO messages (session_id, role, status, ordinal, model)
--   VALUES (:sessionId, 'assistant', 'streaming', next_message_ordinal(:sessionId), :model)
--   RETURNING id
-- )
-- INSERT INTO message_parts (message_id, type, sort_order, content)
-- SELECT id, 'text', 0, ''
-- FROM new_message
-- RETURNING *;


-- ── Q6: Update streaming message to complete ──

-- UPDATE messages SET
--   status = 'complete',
--   prompt_tokens = :promptTokens,
--   completion_tokens = :completionTokens,
--   total_tokens = :totalTokens,
--   time_to_first_token_ms = :ttft,
--   total_duration_ms = :duration,
--   completed_at = NOW()
-- WHERE id = :messageId;


-- ── Q7: Append text to a streaming message part ──
-- During streaming, text is appended to the existing part content.

-- UPDATE message_parts
-- SET content = content || :chunk
-- WHERE id = :partId AND type = 'text';


-- ── Q8: Get user's daily usage for billing ──

-- SELECT
--   date, model,
--   prompt_tokens, completion_tokens, total_tokens,
--   cost_microdollars,
--   sandbox_seconds, sandbox_cost_microdollars,
--   session_count, message_count
-- FROM usage_daily
-- WHERE user_id = :userId
--   AND date BETWEEN :startDate AND :endDate
-- ORDER BY date DESC;


-- ── Q9: Search sessions by title ──

-- SELECT id, title, last_message_at, message_count
-- FROM sessions
-- WHERE user_id = :userId
--   AND deleted_at IS NULL
--   AND title ILIKE '%' || :query || '%'
-- ORDER BY last_message_at DESC
-- LIMIT 20;


-- ── Q10: Get files for a session ──

-- SELECT
--   f.id, f.name, f.path, f.media_type, f.size_bytes,
--   f.source, f.version, f.download_url, f.url_expires_at,
--   f.created_at
-- FROM files f
-- WHERE f.session_id = :sessionId
--   AND f.deleted_at IS NULL
-- ORDER BY f.created_at DESC;


-- ============================================================================
-- SEED DATA: Built-in Personas and Skills
-- ============================================================================

-- Insert built-in skills
INSERT INTO skills (slug, name, description, category, prompt, is_builtin) VALUES
  ('writing-prds', '撰写PRD', '帮助撰写产品需求文档', 'product',
   'You are an expert at writing Product Requirements Documents. Structure the PRD with: Background, Goals, User Stories, Technical Requirements, Success Metrics, and Timeline.', TRUE),
  ('competitive-analysis', '竞品分析', '分析竞争对手产品', 'product',
   'You are an expert at competitive analysis. Analyze competitors across: Features, Pricing, Target Market, Strengths/Weaknesses, and Market Position.', TRUE),
  ('feature-dev', '功能开发', '帮助进行功能开发', 'engineering',
   'You are an expert software engineer. Help with feature development including: Architecture design, Code implementation, Testing strategy, and Code review.', TRUE),
  ('vibe-coding', 'AI辅助编码', 'AI pair programming assistant', 'engineering',
   'You are an expert AI coding assistant. Write clean, well-documented code. Follow best practices and explain your decisions.', TRUE),
  ('design-systems', '设计系统', '帮助建立和维护设计系统', 'design',
   'You are an expert in design systems. Help create and maintain consistent, scalable design systems with tokens, components, and patterns.', TRUE),
  ('running-effective-1-1s', '1:1会议', '帮助准备和进行有效的一对一会议', 'management',
   'You are an expert manager skilled at running 1:1 meetings. Help prepare agendas, talking points, and follow-up actions.', TRUE),
  ('founder-sales', '创始人销售', '帮助创始人进行早期销售', 'sales',
   'You are an expert at founder-led sales. Help with: Prospecting, Pitch preparation, Objection handling, and Follow-up strategy.', TRUE),
  ('fundraising', '融资', '帮助准备融资材料和策略', 'strategy',
   'You are an expert at startup fundraising. Help with: Pitch deck, Financial projections, Investor targeting, and Due diligence preparation.', TRUE);

-- Insert built-in personas
INSERT INTO personas (slug, name, description, category, system_prompt, is_builtin, sort_order, tool_permissions, sandbox_config) VALUES
  ('product-manager', '产品经理', '专业的产品经理助手，擅长PRD撰写、竞品分析、用户访谈', 'product',
   '你是一位资深产品经理。你拥有10年以上的产品管理经验，擅长从用户需求出发，制定产品策略。你的回答应该结构化、数据驱动，并考虑到商业目标和用户体验的平衡。',
   TRUE, 1,
   '["Read", "Write", "WebSearch", "WebFetch", "Glob"]'::jsonb,
   '{"enabled": true, "provider": "e2b", "template": "base", "timeoutMs": 300000}'::jsonb),

  ('fullstack-engineer', '全栈工程师', '专业的全栈工程师助手，擅长代码开发、架构设计、技术选型', 'engineering',
   '你是一位资深全栈工程师。你精通多种编程语言和框架，有丰富的系统设计经验。你写出的代码要求高质量、可维护、有良好的测试覆盖。',
   TRUE, 2,
   '["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "NotebookEdit"]'::jsonb,
   '{"enabled": true, "provider": "e2b", "template": "base", "timeoutMs": 300000, "maxMemoryMb": 1024}'::jsonb),

  ('founder', '创始人', '创业导师助手，擅长融资、商业模式、市场分析', 'strategy',
   '你是一位经验丰富的创业导师和前创始人。你有多次创业经验，了解从0到1的全过程。你的建议实用、直接、基于真实经验。',
   TRUE, 3,
   '["Read", "Write", "WebSearch", "WebFetch"]'::jsonb,
   '{"enabled": true, "provider": "e2b", "template": "base", "timeoutMs": 300000}'::jsonb),

  ('designer', '设计师', '专业的产品设计师助手，擅长设计系统、用户体验、设计评审', 'design',
   '你是一位资深产品设计师。你精通用户体验设计、视觉设计、设计系统构建。你注重设计的逻辑性和用户视角。',
   TRUE, 4,
   '["Read", "Write", "WebSearch", "WebFetch"]'::jsonb,
   '{"enabled": false}'::jsonb),

  ('manager', '管理者', '管理教练助手，擅长团队管理、绩效评估、领导力发展', 'management',
   '你是一位经验丰富的管理教练。你精通团队管理、人才发展、组织建设。你的建议基于成熟的管理方法论。',
   TRUE, 5,
   '["Read", "Write", "WebSearch", "WebFetch"]'::jsonb,
   '{"enabled": false}'::jsonb),

  ('general-assistant', '通用助手', '不预设角色的通用AI助手，适合自由对话', 'general',
   '你是一位智能助手。你能够帮助用户完成各种任务，从写作到分析到编码。你的回答应该准确、有帮助、适当地详细。',
   TRUE, 6,
   '["Read", "Write", "WebSearch", "WebFetch"]'::jsonb,
   '{"enabled": false}'::jsonb);

-- Link personas to skills (persona_skills)
-- Product Manager
INSERT INTO persona_skills (persona_id, skill_id, skill_type, sort_order)
SELECT p.id, s.id, 'default', 1
FROM personas p, skills s
WHERE p.slug = 'product-manager' AND s.slug = 'writing-prds';

INSERT INTO persona_skills (persona_id, skill_id, skill_type, sort_order)
SELECT p.id, s.id, 'default', 2
FROM personas p, skills s
WHERE p.slug = 'product-manager' AND s.slug = 'competitive-analysis';

-- Engineer
INSERT INTO persona_skills (persona_id, skill_id, skill_type, sort_order)
SELECT p.id, s.id, 'default', 1
FROM personas p, skills s
WHERE p.slug = 'fullstack-engineer' AND s.slug = 'feature-dev';

INSERT INTO persona_skills (persona_id, skill_id, skill_type, sort_order)
SELECT p.id, s.id, 'default', 2
FROM personas p, skills s
WHERE p.slug = 'fullstack-engineer' AND s.slug = 'vibe-coding';

-- Founder
INSERT INTO persona_skills (persona_id, skill_id, skill_type, sort_order)
SELECT p.id, s.id, 'default', 1
FROM personas p, skills s
WHERE p.slug = 'founder' AND s.slug = 'founder-sales';

INSERT INTO persona_skills (persona_id, skill_id, skill_type, sort_order)
SELECT p.id, s.id, 'default', 2
FROM personas p, skills s
WHERE p.slug = 'founder' AND s.slug = 'fundraising';

-- Designer
INSERT INTO persona_skills (persona_id, skill_id, skill_type, sort_order)
SELECT p.id, s.id, 'default', 1
FROM personas p, skills s
WHERE p.slug = 'designer' AND s.slug = 'design-systems';

-- Manager
INSERT INTO persona_skills (persona_id, skill_id, skill_type, sort_order)
SELECT p.id, s.id, 'default', 1
FROM personas p, skills s
WHERE p.slug = 'manager' AND s.slug = 'running-effective-1-1s';
