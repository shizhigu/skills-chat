import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Bot } from "lucide-react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";

const plugins = { code, cjk };

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  personaName?: string;
}

export function ChatMessage({
  role,
  content,
  isStreaming = false,
  personaName,
}: ChatMessageProps) {
  const isAssistant = role === "assistant";

  if (!isAssistant) {
    // User message: right-aligned bubble
    return (
      <div className="flex justify-end px-4 py-3">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-primary-foreground">
          <p className="text-sm">{content}</p>
        </div>
      </div>
    );
  }

  // Assistant message: left-aligned with avatar
  return (
    <div className="flex gap-3 px-4 py-3">
      <Avatar className="mt-0.5 size-7 shrink-0">
        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
          <Bot className="size-3.5" />
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 space-y-1 overflow-hidden">
        <p className="text-xs font-medium text-muted-foreground">
          {personaName ?? "助手"}
        </p>
        <div className="max-w-none break-words text-sm">
          <Streamdown plugins={plugins} isAnimating={isStreaming}>
            {content}
          </Streamdown>
        </div>
      </div>
    </div>
  );
}
