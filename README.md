# Skills Chat

> A full-stack AI chat platform that pairs professional personas with composable skills and sandboxed code execution, powered by the Claude Agent SDK running inside E2B cloud sandboxes.

## What is this?

Skills Chat is a reference architecture for building domain-expert AI assistants. Users pick a professional persona (Financial Advisor, Photographer, Legal Advisor, etc.), each pre-loaded with tailored system prompts, composable skill documents, and MCP tool servers. Every conversation runs the Claude Agent SDK inside an isolated E2B sandbox with full Bash, file I/O, and code execution capabilities -- then streams results back to the browser in real time.

## Why?

I noticed that most AI chat products treat every conversation identically -- no domain expertise, no tool access, no structured workflows. Getting expert-level output requires invisible prompt engineering that users cannot package or reuse. I built Skills Chat to separate three concerns (who the AI is, what it can do, what tools it has) into independently composable and editable units.

## How it works

The system has four layers: a React 19 frontend, a React Router v7 SSR server, a Neon PostgreSQL database, and E2B cloud sandboxes.

1. User picks a persona and sends a message
2. The server loads the persona's system prompt and skills from the database
3. An E2B sandbox is created (or reconnected) for the session
4. Skills are written as `SKILL.md` files to `~/.claude/skills/{slug}/` inside the sandbox
5. The Claude Agent SDK's `query()` function runs with the persona's MCP server config
6. The agent runner emits NDJSON to stdout; the server parses it into SSE events
7. The browser renders streaming markdown via `streamdown` with CJK support
8. Messages are persisted with full provenance (token counts, latency, cost)

Sandboxes persist across messages in a session (auto-paused by E2B), so installed packages, generated files, and agent context survive between turns.

## Key Technical Highlights

- **Skills as filesystem artifacts**: Instead of injecting skills into the prompt (burning tokens), skills are written to the sandbox filesystem where the Claude Agent SDK discovers them naturally -- keeping prompts lean while making the full skill library available on demand.
- **Sandbox-per-session architecture**: Each session gets a dedicated E2B sandbox that persists across messages, enabling multi-turn workflows with stateful code execution, file generation, and package installation.
- **MCP server registry**: Each persona has a curated toolchain (financial datasets, image processing, legal search, database access) configured through a central registry and injected into the sandbox at runtime.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Router v7 (SSR) |
| UI | React 19, Tailwind CSS v4, shadcn/ui |
| Markdown | streamdown + @streamdown/cjk |
| Auth | Clerk |
| Database | Neon PostgreSQL (serverless) |
| ORM | Drizzle ORM (neon-http driver) |
| AI | Claude Agent SDK |
| Sandbox | E2B (cloud sandboxes) |
| Tools | Model Context Protocol (MCP) servers |
| Build | Vite 7, TypeScript 5.9 |
| Runtime | Bun |
| Container | Docker (multi-stage, oven/bun base) |

## Quick Start

```bash
git clone https://github.com/shizhigu/skills-chat.git
cd skills-chat
cp .env.example .env  # add Clerk, Neon, Anthropic, E2B keys
bun install
bun run db:push
bun run dev
```

## License

MIT
