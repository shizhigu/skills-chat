<div align="center">

# Skills Chat

**Domain-expert AI chat where each persona brings its own skills and a live sandbox to work in.**

![React Router v7](https://img.shields.io/badge/React_Router-v7-blue)
![React 19](https://img.shields.io/badge/React-19-149eca)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)
![Claude Agent SDK](https://img.shields.io/badge/Claude_Agent_SDK-agent-orange)
![E2B](https://img.shields.io/badge/E2B-sandbox-000)

</div>

---

## What it is

Most chat apps treat every conversation the same: one text box, one system prompt, one API call. Skills Chat splits that into pieces you can compose and edit on their own:

- **Persona**: who the assistant is (system prompt, greeting, model). Six ship as presets: financial advisor, photographer, illustrator, data analyst, legal advisor, writer.
- **Skills**: what it knows how to do. Each skill is a Markdown `SKILL.md` (a trigger, a workflow, output rules) stored in Postgres and mapped to personas many-to-many. Twelve are seeded, two per persona.
- **MCP servers**: the external tools a persona could reach (financial datasets, image processing, a database hub, court-case search). These are defined per persona in a registry but are not yet wired into the chat path (see Status).

When you send a message, the server assembles the persona and its skills and runs a real agent inside a cloud sandbox, then streams the result back as it is generated. The UI is in Chinese, which is why the Markdown renderer is one built for streaming with CJK support.

## Agent design

This is a genuine agent, not a single model call behind a chat box. The autonomous loop is the Claude Agent SDK's; this repo is the orchestration harness around it.

Each session gets its own E2B sandbox. On the first message the server creates the sandbox, installs `@anthropic-ai/claude-agent-sdk` inside it, writes the persona's skills to `~/.claude/skills/{slug}/SKILL.md`, and drops in a runner script. The runner (`sandbox/agent-runner.mjs`) calls the SDK's `query()`:

```js
const options = {
  model,
  systemPrompt,
  maxTurns: 30,
  maxBudgetUsd: 5.0,
  permissionMode: "bypassPermissions",
  includePartialMessages: true,
  settingSources: skills.length > 0 ? ["user"] : [],
  allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"],
};
```

From there the SDK runs the loop: the model decides its own steps, running shell commands, reading and writing files, installing packages, and invoking skills until the task is done or it hits the turn or budget cap. (`settingSources` and the `Skill` tool are only enabled when the persona has skills.)

Design choices:

- Skills live on the filesystem, not in the prompt. The SDK discovers `SKILL.md` files on disk and loads them on demand, so the system prompt stays small while the full library stays available.
- Sandbox per session, not per request. Sandboxes auto-pause between messages and reconnect on the next one, so installed packages, generated files, and working state survive across turns. The SDK install runs once per session.
- Session resume for continuity. The runner passes the SDK's `session_id` back on the next turn via `options.resume`, so follow-ups continue the same agent context.
- NDJSON over stdout. The runner emits one JSON object per line; the server parses those lines live and re-emits them as SSE, which avoids any custom networking between sandbox and host.

## How a message flows

1. Browser POSTs `{ sessionId, message, personaSlug }` to `/api/chat/stream`.
2. Server authenticates with Clerk, loads the persona and its skills from Postgres, and resolves the persona's env vars.
3. `runAgentInSandbox()` reconnects to the session's sandbox or creates one.
4. The runner executes the agent SDK; its stdout NDJSON becomes SSE.
5. Browser renders streaming Markdown; the finished message is persisted with token usage and latency.

If the Anthropic or E2B keys are missing, the endpoint falls back to a scripted demo response so the app still runs.

## Quick start

Requires [Bun](https://bun.sh), plus a Neon Postgres URL, Clerk keys, an Anthropic key, and an E2B key.

```bash
git clone https://github.com/shizhigu/skills-chat.git
cd skills-chat
bun install

# create .env with at least:
#   DATABASE_URL=            # Neon Postgres
#   CLERK_SECRET_KEY=        # + Clerk publishable key
#   ANTHROPIC_API_KEY=       # or ANTHROPIC_AUTH_TOKEN
#   E2B_API_KEY=
# optional per persona: FINANCIAL_DATASETS_API_KEY, COURTLISTENER_API_KEY

bun run db:push                    # push the Drizzle schema to Neon
npx tsx app/lib/db/seed-skills.ts  # seed the six personas and twelve skills
bun run dev
```

Other scripts: `bun run build`, `bun run start`, `bun run db:studio`, `bun run typecheck`.

## Status

Functional prototype. The core loop works end to end: sign in, pick a persona, chat with streaming responses, persist messages, resume a conversation. Skills are editable from the UI.

Rough edges, straight from the code:

- MCP servers are defined per persona in `app/lib/agent/mcp-registry.ts`, and the sandbox runner accepts them, but the chat endpoint does not pass them yet, so the agent currently runs with only its built-in tools.
- Sandbox and agent-session IDs live in an in-memory `Map`. A server restart loses those associations, and multiple server instances would not share them.
- File attachments, per-message token display, user-provided API keys, the dark mode toggle, and a skill install/uninstall flow are scaffolded but not wired up.
- No automated tests and no CI.

## Notes

The schema uses a message-parts pattern: each message is modeled as typed, ordered rows (text, tool_call, tool_result, and so on) rather than one blob, which is built for streaming updates and multi-tool transcripts. Sessions also snapshot the system prompt at creation time, so editing a persona later does not change past conversations. See `docs/DATABASE_DESIGN.md` and `PROJECT_BRIEF.md` for the longer write-ups.

## License

No license file is included yet. Add one before reusing this code.
