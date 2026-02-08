import { eq, and, desc, isNull, sql as sqlTag, asc } from "drizzle-orm";
import { db } from "./index";
import * as schema from "./schema";
import type { PersonaPreset } from "~/lib/personas";

// ── User sync (Clerk → DB) ─────────────────────────────────────────────────

export async function ensureUser(
  clerkUserId: string,
  data: { email: string; name: string; avatarUrl?: string | null }
): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: and(
      eq(schema.users.authProviderId, clerkUserId),
      isNull(schema.users.deletedAt)
    ),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const [user] = await db
    .insert(schema.users)
    .values({
      email: data.email,
      name: data.name,
      avatarUrl: data.avatarUrl ?? undefined,
      authProvider: "email",
      authProviderId: clerkUserId,
      emailVerified: true,
    })
    .returning({ id: schema.users.id });

  return user.id;
}

// ── Persona ensure (create from preset if missing) ─────────────────────────

export async function ensurePersonaBySlug(
  preset: PersonaPreset
): Promise<string> {
  const existing = await db.query.personas.findFirst({
    where: and(
      eq(schema.personas.slug, preset.slug),
      isNull(schema.personas.deletedAt)
    ),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const [persona] = await db
    .insert(schema.personas)
    .values({
      slug: preset.slug,
      name: preset.name,
      description: preset.description,
      category: preset.category as "finance" | "photography" | "illustration" | "data" | "legal" | "writing" | "general",
      systemPrompt: preset.description,
      greetingMessage: preset.greetingMessage,
      isBuiltin: true,
      visibility: "public",
    })
    .returning({ id: schema.personas.id });

  return persona.id;
}

// ── Session ensure ─────────────────────────────────────────────────────────

export async function ensureSession(data: {
  sessionId: string;
  userId: string;
  personaId: string;
  model: string;
  systemPromptSnapshot: string;
}): Promise<void> {
  const existing = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, data.sessionId),
    columns: { id: true },
  });
  if (existing) return;

  await db.insert(schema.sessions).values({
    id: data.sessionId,
    userId: data.userId,
    personaId: data.personaId,
    model: data.model,
    systemPromptSnapshot: data.systemPromptSnapshot,
    activeSkillIds: [],
  });
}

// ── Session update after message ───────────────────────────────────────────

export async function updateSessionAfterMessage(
  sessionId: string,
  agentSessionId?: string
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({
      lastMessageAt: new Date(),
      messageCount: sqlTag`${schema.sessions.messageCount} + 1`,
      ...(agentSessionId ? { agentSessionId } : {}),
    })
    .where(eq(schema.sessions.id, sessionId));
}

export async function getUserSessions(userId: string, limit = 50) {
  return db.query.sessions.findMany({
    where: and(
      eq(schema.sessions.userId, userId),
      isNull(schema.sessions.deletedAt),
      eq(schema.sessions.status, "active")
    ),
    orderBy: [desc(schema.sessions.lastMessageAt)],
    limit,
    with: {
      persona: {
        columns: {
          name: true,
          avatarUrl: true,
          slug: true,
        },
      },
    },
  });
}

export async function getSessionMessages(sessionId: string) {
  return db.query.messages.findMany({
    where: eq(schema.messages.sessionId, sessionId),
    orderBy: [asc(schema.messages.ordinal)],
    with: {
      parts: {
        orderBy: [asc(schema.messageParts.sortOrder)],
      },
    },
  });
}

export async function getPersonaBySlug(slug: string) {
  return db.query.personas.findFirst({
    where: and(
      eq(schema.personas.slug, slug),
      isNull(schema.personas.deletedAt)
    ),
    with: {
      personaSkills: {
        with: {
          skill: true,
        },
        orderBy: [asc(schema.personaSkills.sortOrder)],
      },
      mcpConfigs: {
        where: and(
          eq(schema.mcpServerConfigs.isEnabled, true),
          isNull(schema.mcpServerConfigs.deletedAt)
        ),
      },
    },
  });
}

export async function listPublicPersonas() {
  return db.query.personas.findMany({
    where: and(
      eq(schema.personas.visibility, "public"),
      isNull(schema.personas.deletedAt)
    ),
    orderBy: [asc(schema.personas.sortOrder)],
    with: {
      personaSkills: {
        with: {
          skill: {
            columns: {
              id: true,
              slug: true,
              name: true,
              icon: true,
              category: true,
            },
          },
        },
      },
    },
  });
}

export async function createSession(data: {
  userId: string;
  personaId: string;
  model: string;
  systemPromptSnapshot: string;
  activeSkillIds: string[];
}) {
  const [session] = await db
    .insert(schema.sessions)
    .values({
      userId: data.userId,
      personaId: data.personaId,
      model: data.model,
      systemPromptSnapshot: data.systemPromptSnapshot,
      activeSkillIds: data.activeSkillIds,
    })
    .returning();

  return session;
}

export async function getSession(sessionId: string) {
  return db.query.sessions.findFirst({
    where: and(
      eq(schema.sessions.id, sessionId),
      isNull(schema.sessions.deletedAt)
    ),
    with: {
      persona: true,
    },
  });
}

export async function insertMessageWithParts(data: {
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  status?: "pending" | "streaming" | "complete";
  model?: string;
  parts: Array<{
    type: "text" | "reasoning" | "tool_call" | "tool_result" | "file" | "image" | "error";
    content?: string;
    toolCallId?: string;
    toolName?: string;
    toolArguments?: unknown;
    toolState?: string;
    toolResult?: unknown;
    toolError?: string;
    fileUrl?: string;
    fileName?: string;
    fileMediaType?: string;
    fileSizeBytes?: number;
  }>;
}) {
  const result = await db.execute<{ nextOrdinal: number }>(
    sqlTag`SELECT COALESCE(MAX(ordinal), 0) + 1 as "nextOrdinal" FROM messages WHERE session_id = ${data.sessionId}`
  );
  const nextOrdinal = result.rows[0].nextOrdinal;

  const [message] = await db
    .insert(schema.messages)
    .values({
      sessionId: data.sessionId,
      role: data.role,
      status: data.status ?? "complete",
      ordinal: nextOrdinal,
      model: data.model,
    })
    .returning();

  if (data.parts.length > 0) {
    const parts = await db
      .insert(schema.messageParts)
      .values(
        data.parts.map((part, index) => ({
          messageId: message.id,
          type: part.type,
          sortOrder: index,
          content: part.content,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          toolArguments: part.toolArguments,
          toolState: part.toolState,
          toolResult: part.toolResult,
          toolError: part.toolError,
          fileUrl: part.fileUrl,
          fileName: part.fileName,
          fileMediaType: part.fileMediaType,
          fileSizeBytes: part.fileSizeBytes,
        }))
      )
      .returning();

    return { ...message, parts };
  }

  return { ...message, parts: [] };
}

export async function completeMessage(
  messageId: string,
  data: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    timeToFirstTokenMs?: number;
    totalDurationMs?: number;
  }
) {
  const [updated] = await db
    .update(schema.messages)
    .set({
      status: "complete",
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      totalTokens: data.totalTokens,
      timeToFirstTokenMs: data.timeToFirstTokenMs,
      totalDurationMs: data.totalDurationMs,
      completedAt: new Date(),
    })
    .where(eq(schema.messages.id, messageId))
    .returning();

  return updated;
}

export async function listAllSkills() {
  return db.query.skills.findMany({
    where: isNull(schema.skills.deletedAt),
    orderBy: [asc(schema.skills.category), asc(schema.skills.name)],
  });
}

export async function updateSkill(
  skillId: string,
  data: { name?: string; description?: string; prompt?: string }
) {
  const [updated] = await db
    .update(schema.skills)
    .set(data)
    .where(eq(schema.skills.id, skillId))
    .returning();
  return updated;
}

export async function deleteSession(sessionId: string, userId: string) {
  const [updated] = await db
    .update(schema.sessions)
    .set({
      deletedAt: new Date(),
      status: "deleted",
    })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        eq(schema.sessions.userId, userId)
      )
    )
    .returning();

  return updated;
}
