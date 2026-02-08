import { Link, useRouteLoaderData } from "react-router";
import { Header } from "~/components/layout/header";
import { Main } from "~/components/layout/main";
import { MessageSquare } from "lucide-react";
import { getPersonaPreset } from "~/lib/personas";
import { getUserSessions } from "~/lib/db/queries";

export default function Sessions() {
  const parentData = useRouteLoaderData("routes/app-layout") as {
    dbUserId: string;
    sessions: Array<{
      id: string;
      title: string | null;
      persona: { name: string; slug: string };
      messageCount?: number;
      lastMessageAt?: string | null;
    }>;
  };
  const sessions = parentData?.sessions ?? [];

  return (
    <>
      <Header title="对话列表" />
      <Main className="p-6">
        {sessions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-4 size-12 text-muted-foreground" />
              <h2 className="text-lg font-medium">暂无对话</h2>
              <p className="text-sm text-muted-foreground">
                选择一个角色开始你的第一次对话
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-2">
            <h2 className="mb-4 text-lg font-semibold">最近对话</h2>
            {sessions.map((session) => {
              const preset = session.persona
                ? getPersonaPreset(session.persona.slug)
                : null;
              const Icon = preset?.icon;

              return (
                <Link
                  key={session.id}
                  to={`/chat/${session.id}?persona=${session.persona?.slug ?? ""}`}
                  className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  {Icon ? (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground">
                      <Icon className="size-4" />
                    </div>
                  ) : (
                    <MessageSquare className="size-8 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {session.title || session.persona?.name || "对话"}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Main>
    </>
  );
}
