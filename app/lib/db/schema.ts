import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// ENUMS
// ============================================================================

export const userRoleEnum = pgEnum("user_role", ["user", "admin", "superadmin"]);
export const authProviderEnum = pgEnum("auth_provider", [
  "email",
  "google",
  "github",
  "apple",
]);
export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "archived",
  "deleted",
]);
export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
  "tool",
]);
export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "streaming",
  "complete",
  "error",
  "cancelled",
]);
export const partTypeEnum = pgEnum("part_type", [
  "text",
  "reasoning",
  "tool_call",
  "tool_result",
  "file",
  "image",
  "error",
]);
export const sandboxStatusEnum = pgEnum("sandbox_status", [
  "creating",
  "running",
  "paused",
  "stopped",
  "error",
  "destroyed",
]);
export const sandboxProviderEnum = pgEnum("sandbox_provider", [
  "e2b",
  "docker",
  "webcontainer",
]);
export const fileSourceEnum = pgEnum("file_source", [
  "upload",
  "generated",
  "sandbox",
]);
export const personaVisibilityEnum = pgEnum("persona_visibility", [
  "public",
  "private",
  "unlisted",
]);
export const skillCategoryEnum = pgEnum("skill_category", [
  "finance",
  "photography",
  "illustration",
  "data",
  "legal",
  "writing",
  "general",
]);
export const personaSkillTypeEnum = pgEnum("persona_skill_type", [
  "default",
  "optional",
]);
export const mcpTransportEnum = pgEnum("mcp_transport", [
  "stdio",
  "sse",
  "streamable_http",
]);

// ============================================================================
// 1. USERS
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    passwordHash: varchar("password_hash", { length: 255 }),
    authProvider: authProviderEnum("auth_provider").notNull().default("email"),
    authProviderId: varchar("auth_provider_id", { length: 255 }),
    name: varchar("name", { length: 100 }).notNull(),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    role: userRoleEnum("role").notNull().default("user"),
    preferences: jsonb("preferences")
      .notNull()
      .default(
        sql`'{"theme":"system","language":"zh-CN","defaultModel":"claude-sonnet-4-20250514","sendOnEnter":true}'::jsonb`
      ),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_users_email_active")
      .on(table.email)
      .where(sql`deleted_at IS NULL`),
  ]
);

// ============================================================================
// 2. PERSONAS
// ============================================================================

export const personas = pgTable(
  "personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 100 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description").notNull(),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    category: skillCategoryEnum("category").notNull().default("general"),
    systemPrompt: text("system_prompt").notNull(),
    greetingMessage: text("greeting_message"),
    defaultModel: varchar("default_model", { length: 100 })
      .notNull()
      .default("claude-sonnet-4-20250514"),
    modelConfig: jsonb("model_config")
      .notNull()
      .default(
        sql`'{"maxTokens":8192,"temperature":0.7}'::jsonb`
      ),
    sandboxConfig: jsonb("sandbox_config")
      .notNull()
      .default(
        sql`'{"enabled":false,"provider":"e2b","template":"base","timeoutMs":300000}'::jsonb`
      ),
    toolPermissions: jsonb("tool_permissions")
      .notNull()
      .default(sql`'[]'::jsonb`),
    visibility: personaVisibilityEnum("visibility")
      .notNull()
      .default("public"),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_personas_slug_active")
      .on(table.slug)
      .where(sql`deleted_at IS NULL`),
    index("idx_personas_visibility").on(
      table.visibility,
      table.category,
      table.sortOrder
    ),
  ]
);

// ============================================================================
// 3. SKILLS
// ============================================================================

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 100 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description").notNull(),
    category: skillCategoryEnum("category").notNull().default("general"),
    prompt: text("prompt").notNull(),
    requiredTools: jsonb("required_tools")
      .notNull()
      .default(sql`'[]'::jsonb`),
    icon: varchar("icon", { length: 100 }),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_skills_slug_active")
      .on(table.slug)
      .where(sql`deleted_at IS NULL`),
    index("idx_skills_category")
      .on(table.category)
      .where(sql`deleted_at IS NULL`),
  ]
);

// ============================================================================
// 4. PERSONA-SKILL MAPPINGS
// ============================================================================

export const personaSkills = pgTable(
  "persona_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    skillType: personaSkillTypeEnum("skill_type")
      .notNull()
      .default("optional"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_persona_skills_unique").on(
      table.personaId,
      table.skillId
    ),
    index("idx_persona_skills_persona").on(
      table.personaId,
      table.skillType,
      table.sortOrder
    ),
  ]
);

// ============================================================================
// 5. SESSIONS
// ============================================================================

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 255 }),
    status: sessionStatusEnum("status").notNull().default("active"),
    model: varchar("model", { length: 100 }).notNull(),
    systemPromptSnapshot: text("system_prompt_snapshot").notNull(),
    activeSkillIds: jsonb("active_skill_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    agentSessionId: varchar("agent_session_id", { length: 255 }),
    messageCount: integer("message_count").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_sessions_user_recent")
      .on(table.userId, table.lastMessageAt)
      .where(sql`deleted_at IS NULL`),
    index("idx_sessions_persona")
      .on(table.personaId, table.createdAt)
      .where(sql`deleted_at IS NULL`),
  ]
);

// ============================================================================
// 6. MESSAGES
// ============================================================================

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    status: messageStatusEnum("status").notNull().default("complete"),
    ordinal: integer("ordinal").notNull(),
    model: varchar("model", { length: 100 }),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    timeToFirstTokenMs: integer("time_to_first_token_ms"),
    totalDurationMs: integer("total_duration_ms"),
    parentMessageId: uuid("parent_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_messages_session_ordinal_unique").on(
      table.sessionId,
      table.ordinal
    ),
    index("idx_messages_streaming")
      .on(table.sessionId, table.status)
      .where(sql`status IN ('pending', 'streaming')`),
  ]
);

// ============================================================================
// 7. MESSAGE PARTS
// ============================================================================

export const messageParts = pgTable(
  "message_parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    type: partTypeEnum("type").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    content: text("content"),
    toolCallId: varchar("tool_call_id", { length: 255 }),
    toolName: varchar("tool_name", { length: 255 }),
    toolArguments: jsonb("tool_arguments"),
    toolState: varchar("tool_state", { length: 50 }),
    toolResult: jsonb("tool_result"),
    toolError: text("tool_error"),
    toolDurationMs: integer("tool_duration_ms"),
    fileUrl: varchar("file_url", { length: 500 }),
    fileName: varchar("file_name", { length: 255 }),
    fileMediaType: varchar("file_media_type", { length: 100 }),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_parts_message_order").on(table.messageId, table.sortOrder),
    index("idx_parts_tool_call_id")
      .on(table.toolCallId)
      .where(sql`tool_call_id IS NOT NULL`),
  ]
);

// ============================================================================
// 8. SESSION SKILLS
// ============================================================================

export const sessionSkills = pgTable(
  "session_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").notNull().default(true),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_session_skills_unique").on(
      table.sessionId,
      table.skillId
    ),
    index("idx_session_skills_session").on(table.sessionId, table.isActive),
  ]
);

// ============================================================================
// 9. SANDBOXES
// ============================================================================

export const sandboxes = pgTable(
  "sandboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    provider: sandboxProviderEnum("provider").notNull().default("e2b"),
    externalId: varchar("external_id", { length: 255 }),
    status: sandboxStatusEnum("status").notNull().default("creating"),
    template: varchar("template", { length: 100 }).notNull().default("base"),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    memoryMb: integer("memory_mb"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    timeoutAt: timestamp("timeout_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_sandboxes_session_active")
      .on(table.sessionId)
      .where(sql`status IN ('creating', 'running', 'paused')`),
    index("idx_sandboxes_status").on(table.status, table.timeoutAt),
  ]
);

// ============================================================================
// 10. FILES
// ============================================================================

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    sandboxId: uuid("sandbox_id").references(() => sandboxes.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    path: varchar("path", { length: 1000 }),
    mediaType: varchar("media_type", { length: 100 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    source: fileSourceEnum("source").notNull().default("generated"),
    storageKey: varchar("storage_key", { length: 500 }).notNull(),
    downloadUrl: varchar("download_url", { length: 1000 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_files_session")
      .on(table.sessionId, table.createdAt)
      .where(sql`deleted_at IS NULL`),
  ]
);

// ============================================================================
// 11. MCP SERVER CONFIGS
// ============================================================================

export const mcpServerConfigs = pgTable(
  "mcp_server_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    transport: mcpTransportEnum("transport").notNull().default("stdio"),
    command: varchar("command", { length: 500 }),
    args: jsonb("args").default(sql`'[]'::jsonb`),
    url: varchar("url", { length: 500 }),
    headers: jsonb("headers").default(sql`'{}'::jsonb`),
    envVars: jsonb("env_vars").default(sql`'{}'::jsonb`),
    isEnabled: boolean("is_enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_mcp_configs_persona")
      .on(table.personaId, table.isEnabled)
      .where(sql`deleted_at IS NULL`),
  ]
);

// ============================================================================
// 12. USAGE
// ============================================================================

export const usageDaily = pgTable(
  "usage_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    promptTokens: bigint("prompt_tokens", { mode: "number" })
      .notNull()
      .default(0),
    completionTokens: bigint("completion_tokens", { mode: "number" })
      .notNull()
      .default(0),
    totalTokens: bigint("total_tokens", { mode: "number" })
      .notNull()
      .default(0),
    sessionCount: integer("session_count").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    costMicrodollars: bigint("cost_microdollars", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_usage_daily_unique").on(
      table.userId,
      table.date,
      table.model
    ),
  ]
);

// ============================================================================
// RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const personasRelations = relations(personas, ({ many }) => ({
  personaSkills: many(personaSkills),
  sessions: many(sessions),
  mcpConfigs: many(mcpServerConfigs),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
  personaSkills: many(personaSkills),
  sessionSkills: many(sessionSkills),
}));

export const personaSkillsRelations = relations(personaSkills, ({ one }) => ({
  persona: one(personas, {
    fields: [personaSkills.personaId],
    references: [personas.id],
  }),
  skill: one(skills, {
    fields: [personaSkills.skillId],
    references: [skills.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
  persona: one(personas, {
    fields: [sessions.personaId],
    references: [personas.id],
  }),
  messages: many(messages),
  sessionSkills: many(sessionSkills),
  sandboxes: many(sandboxes),
  files: many(files),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  session: one(sessions, {
    fields: [messages.sessionId],
    references: [sessions.id],
  }),
  parts: many(messageParts),
}));

export const messagePartsRelations = relations(messageParts, ({ one }) => ({
  message: one(messages, {
    fields: [messageParts.messageId],
    references: [messages.id],
  }),
}));

export const sessionSkillsRelations = relations(sessionSkills, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionSkills.sessionId],
    references: [sessions.id],
  }),
  skill: one(skills, {
    fields: [sessionSkills.skillId],
    references: [skills.id],
  }),
}));

export const sandboxesRelations = relations(sandboxes, ({ one, many }) => ({
  session: one(sessions, {
    fields: [sandboxes.sessionId],
    references: [sessions.id],
  }),
  files: many(files),
}));

export const filesRelations = relations(files, ({ one }) => ({
  session: one(sessions, {
    fields: [files.sessionId],
    references: [sessions.id],
  }),
  message: one(messages, {
    fields: [files.messageId],
    references: [messages.id],
  }),
  sandbox: one(sandboxes, {
    fields: [files.sandboxId],
    references: [sandboxes.id],
  }),
}));

export const mcpServerConfigsRelations = relations(
  mcpServerConfigs,
  ({ one }) => ({
    persona: one(personas, {
      fields: [mcpServerConfigs.personaId],
      references: [personas.id],
    }),
  })
);

export const usageDailyRelations = relations(usageDaily, ({ one }) => ({
  user: one(users, {
    fields: [usageDaily.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Persona = typeof personas.$inferSelect;
export type NewPersona = typeof personas.$inferInsert;
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessagePart = typeof messageParts.$inferSelect;
export type NewMessagePart = typeof messageParts.$inferInsert;
export type SessionSkill = typeof sessionSkills.$inferSelect;
export type Sandbox = typeof sandboxes.$inferSelect;
export type FileRecord = typeof files.$inferSelect;
export type McpServerConfig = typeof mcpServerConfigs.$inferSelect;
export type UsageDaily = typeof usageDaily.$inferSelect;
