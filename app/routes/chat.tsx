import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useSearchParams, useLoaderData } from "react-router";
import type { Route } from "./+types/chat";
import { Header } from "~/components/layout/header";
import { Main } from "~/components/layout/main";
import { ChatMessages, type ChatMessageData } from "~/components/chat/chat-messages";
import { ChatInput } from "~/components/chat/chat-input";
import { Badge } from "~/components/ui/badge";
import { getPersonaPreset } from "~/lib/personas";
import { getSessionMessages, getSession } from "~/lib/db/queries";

export async function loader({ params }: Route.LoaderArgs) {
  const sessionId = params.sessionId;
  if (!sessionId) return { messages: [], personaSlug: null };

  try {
    const session = await getSession(sessionId);
    const dbMessages = await getSessionMessages(sessionId);

    // Convert DB messages to ChatMessageData format
    const messages: ChatMessageData[] = dbMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const textPart = m.parts?.find((p) => p.type === "text");
        return {
          id: m.id,
          role: m.role as "user" | "assistant",
          content: textPart?.content ?? "",
          isStreaming: false,
        };
      });

    return {
      messages,
      personaSlug: session?.persona?.slug ?? null,
    };
  } catch {
    return { messages: [], personaSlug: null };
  }
}

export default function Chat() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const loaderData = useLoaderData<typeof loader>();
  const personaSlug =
    searchParams.get("persona") ??
    loaderData?.personaSlug ??
    "financial-advisor";
  const persona = getPersonaPreset(personaSlug);

  const [messages, setMessages] = useState<ChatMessageData[]>(
    loaderData?.messages ?? []
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reset messages when navigating to a different session
  useEffect(() => {
    setMessages(loaderData?.messages ?? []);
  }, [sessionId]);

  const handleSend = useCallback(
    async (content: string) => {
      const userMsg: ChatMessageData = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };

      const assistantMsg: ChatMessageData = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            message: content,
            personaSlug,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error("Stream failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "text_delta") {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + data.text,
                    };
                  }
                  return updated;
                });
              } else if (data.type === "error") {
                const errMsg = data.message || "Unknown error";
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content || `Error: ${errMsg}`,
                      isStreaming: false,
                    };
                  }
                  return updated;
                });
                break;
              } else if (data.type === "done") {
                break;
              }
            } catch {
              // skip malformed JSON
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // User cancelled
        } else {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant" && !last.content) {
              updated[updated.length - 1] = {
                ...last,
                content: "抱歉，发生了错误。请重试。",
                isStreaming: false,
              };
            }
            return updated;
          });
        }
      } finally {
        setIsStreaming(false);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            updated[updated.length - 1] = { ...last, isStreaming: false };
          }
          return updated;
        });
        abortRef.current = null;
      }
    },
    [sessionId, personaSlug]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const Icon = persona?.icon;

  return (
    <>
      <Header>
        <div className="flex items-center gap-2">
          {Icon && (
            <div className="flex size-6 items-center justify-center rounded bg-primary text-primary-foreground">
              <Icon className="size-3.5" />
            </div>
          )}
          <span className="font-medium">{persona?.name ?? "对话"}</span>
          <Badge variant="outline" className="text-xs">
            {personaSlug}
          </Badge>
        </div>
      </Header>
      <Main fixed className="flex flex-col">
        <ChatMessages
          messages={messages}
          personaName={persona?.name}
        />
        <ChatInput
          onSend={handleSend}
          isStreaming={isStreaming}
          onStop={handleStop}
          placeholder={`向${persona?.name ?? "AI"}发送消息...`}
        />
      </Main>
    </>
  );
}
