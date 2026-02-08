import { useRef, useEffect } from "react";
import { ScrollArea } from "~/components/ui/scroll-area";
import { ChatMessage } from "./chat-message";

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface ChatMessagesProps {
  messages: ChatMessageData[];
  personaName?: string;
}

export function ChatMessages({ messages, personaName }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-muted-foreground">
            开始新的对话
          </p>
          <p className="text-sm text-muted-foreground">
            在下方输入消息开始聊天
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="mx-auto max-w-3xl">
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            isStreaming={msg.isStreaming}
            personaName={personaName}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
