import type { ActionFunctionArgs } from "react-router";
import { getAuth } from "@clerk/react-router/server";
import { getPersonaPreset } from "~/lib/personas";
import {
  runAgentInSandbox,
  type SandboxEvent,
} from "~/lib/sandbox/sandbox-manager";
import {
  resolveSandboxEnvVars,
  getDefaultModel,
} from "~/lib/sandbox/env-resolver";
import {
  ensureUser,
  ensurePersonaBySlug,
  ensureSession,
  insertMessageWithParts,
  completeMessage,
  updateSessionAfterMessage,
  getPersonaBySlug,
} from "~/lib/db/queries";
import { db } from "~/lib/db/index";
import { messageParts } from "~/lib/db/schema";

export async function action(args: ActionFunctionArgs) {
  const { userId: clerkUserId } = await getAuth(args);
  if (!clerkUserId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const { request } = args;
  const { sessionId, message, personaSlug } = await request.json();

  const persona = getPersonaPreset(personaSlug);
  if (!persona) {
    return new Response(JSON.stringify({ error: "Persona not found" }), {
      status: 404,
    });
  }

  // Load skills from DB for this persona
  const dbPersona = await getPersonaBySlug(personaSlug);
  const skills = (dbPersona?.personaSkills ?? []).map((ps) => ({
    slug: ps.skill.slug,
    content: ps.skill.prompt,
  }));

  // Check required env vars — support both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY
  const hasAnthropicAuth =
    process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  if (!hasAnthropicAuth) {
    return demoMode(persona);
  }

  if (!process.env.E2B_API_KEY) {
    return demoMode(persona, "请配置 E2B_API_KEY 以启用沙盒环境。");
  }

  const systemPrompt = dbPersona?.systemPrompt ?? persona.description;
  const envVars = resolveSandboxEnvVars(personaSlug);
  const model = getDefaultModel();

  // ── Ensure DB records exist ──────────────────────────────────────────────
  let dbReady = false;
  let assistantMessageId: string | undefined;

  try {
    const userId = await ensureUser(clerkUserId, {
      email: "",
      name: "User",
    });
    const personaId = await ensurePersonaBySlug(persona);
    await ensureSession({
      sessionId,
      userId,
      personaId,
      model,
      systemPromptSnapshot: systemPrompt,
    });

    // Save user message
    await insertMessageWithParts({
      sessionId,
      role: "user",
      status: "complete",
      parts: [{ type: "text", content: message }],
    });

    // Create streaming assistant message placeholder
    const assistantMsg = await insertMessageWithParts({
      sessionId,
      role: "assistant",
      status: "streaming",
      model,
      parts: [],
    });
    assistantMessageId = assistantMsg.id;
    dbReady = true;
  } catch (err) {
    console.error("[api.chat.stream] DB setup error (non-fatal):", err);
    // Continue without DB — streaming still works, just not persisted
  }

  // ── Stream ───────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  let accumulatedText = "";
  let agentSessionId: string | undefined;
  let usage: Record<string, unknown> | undefined;
  const startTime = Date.now();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      const onEvent = (event: SandboxEvent) => {
        // Accumulate text for DB persistence
        if (event.type === "text_delta" && typeof event.text === "string") {
          accumulatedText += event.text;
        }

        // Capture agent session ID
        if (event.type === "init" && event.agentSessionId) {
          agentSessionId = event.agentSessionId as string;
        }

        // Capture usage stats from done event
        if (event.type === "done") {
          if (event.sessionId) {
            agentSessionId = event.sessionId as string;
          }
          usage = (event.usage as Record<string, unknown>) ?? undefined;
        }

        // Forward all events as SSE
        send(event);
      };

      runAgentInSandbox({
        sessionId,
        message,
        systemPrompt,
        personaSlug,
        model,
        envVars,
        skills,
        onEvent,
      })
        .catch((err) => {
          send({
            type: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        })
        .finally(async () => {
          // ── Persist assistant message to DB ─────────────────────────────
          if (dbReady && assistantMessageId && accumulatedText) {
            try {
              // Add the text part to the assistant message
              await db.insert(messageParts).values({
                messageId: assistantMessageId,
                type: "text",
                sortOrder: 0,
                content: accumulatedText,
              });

              // Complete the assistant message with usage stats
              const durationMs = Date.now() - startTime;
              await completeMessage(assistantMessageId, {
                promptTokens: (usage?.input_tokens as number) ?? undefined,
                completionTokens: (usage?.output_tokens as number) ?? undefined,
                totalTokens:
                  usage
                    ? ((usage.input_tokens as number) ?? 0) +
                      ((usage.output_tokens as number) ?? 0)
                    : undefined,
                totalDurationMs: durationMs,
              });

              // Update session metadata
              await updateSessionAfterMessage(sessionId, agentSessionId);
            } catch (err) {
              console.error(
                "[api.chat.stream] Failed to persist assistant message:",
                err
              );
            }
          }

          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── Demo mode fallback ──────────────────────────────────────────────────────

function demoMode(
  persona: { name: string; greetingMessage: string },
  extraNote?: string
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      const note =
        extraNote ||
        "当前为演示模式，请配置 ANTHROPIC_API_KEY 以启用真实 AI 对话。";
      const demoResponse = `你好！我是${persona.name}。${persona.greetingMessage}\n\n> 注意：${note}`;

      for (const char of demoResponse) {
        send({ type: "text_delta", text: char });
        await new Promise((r) => setTimeout(r, 20));
      }
      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
