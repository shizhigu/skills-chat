import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { MessageSquare, Sparkles, ChevronRight } from "lucide-react";
import type { PersonaPreset } from "~/lib/personas";

const colorMap: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-950 dark:text-slate-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const iconBgMap: Record<string, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  blue: "bg-blue-500",
  slate: "bg-slate-500",
  rose: "bg-rose-500",
};

interface SkillInfo {
  id: string;
  slug: string;
  name: string;
  category: string;
  icon: string | null;
}

interface PersonaCardProps {
  persona: PersonaPreset;
  skills: SkillInfo[];
}

export function PersonaCard({ persona, skills }: PersonaCardProps) {
  const Icon = persona.icon;
  const [showSkills, setShowSkills] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillInfo | null>(null);

  return (
    <>
      <Card className="group relative overflow-hidden transition-all hover:shadow-md hover:border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div
              className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-white ${iconBgMap[persona.color] ?? "bg-primary"}`}
            >
              <Icon className="size-5" />
            </div>
            <div className="flex-1 space-y-1">
              <h3 className="font-semibold leading-none">{persona.name}</h3>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {persona.description}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center justify-between">
            <Badge
              variant="secondary"
              className={`cursor-pointer ${colorMap[persona.color]}`}
              onClick={() => setShowSkills(true)}
            >
              {skills.length} 个技能
            </Badge>
            <Button size="sm" asChild>
              <Link to={`/chat/new?persona=${persona.slug}`}>
                <MessageSquare className="mr-1 size-3.5" />
                开始对话
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Skills list dialog */}
      <Dialog open={showSkills && !editingSkill} onOpenChange={(open) => !open && setShowSkills(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className={`flex size-8 items-center justify-center rounded-lg text-white ${iconBgMap[persona.color] ?? "bg-primary"}`}>
                <Icon className="size-4" />
              </div>
              <div>
                <DialogTitle>{persona.name}</DialogTitle>
                <DialogDescription>该角色配备的专业技能</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-2">
            {skills.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">暂无技能</p>
            ) : (
              skills.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => setEditingSkill(skill)}
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                >
                  <Sparkles className="size-4 shrink-0 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{skill.name}</p>
                    <p className="text-xs text-muted-foreground">{skill.slug}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Skill edit dialog */}
      {editingSkill && (
        <SkillEditDialog
          skillId={editingSkill.id}
          onClose={() => setEditingSkill(null)}
        />
      )}
    </>
  );
}

function SkillEditDialog({
  skillId,
  onClose,
}: {
  skillId: string;
  onClose: () => void;
}) {
  const loadFetcher = useFetcher();
  const saveFetcher = useFetcher();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Load full skill data on mount
  if (!loaded && loadFetcher.state === "idle" && !loadFetcher.data) {
    loadFetcher.submit(
      { intent: "getSkillPrompt", skillId },
      { method: "post" }
    );
  }

  // Populate form when data arrives
  const data = loadFetcher.data as { id: string; name: string; description: string; prompt: string } | null;
  if (data && !loaded) {
    setName(data.name);
    setDescription(data.description);
    setPrompt(data.prompt);
    setLoaded(true);
  }

  const isSaving = saveFetcher.state !== "idle";

  // Close on successful save
  if (saveFetcher.data && (saveFetcher.data as { ok?: boolean }).ok && !isSaving) {
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑技能</DialogTitle>
          <DialogDescription>
            修改后保存，下次对话将使用更新后的 SKILL.md
          </DialogDescription>
        </DialogHeader>

        {!loaded ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
        ) : (
          <saveFetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="updateSkill" />
            <input type="hidden" name="skillId" value={skillId} />

            <div className="space-y-2">
              <Label htmlFor="skill-name">名称</Label>
              <Input
                id="skill-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="skill-description">描述</Label>
              <Input
                id="skill-description"
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="skill-prompt">SKILL.md 内容</Label>
              <Textarea
                id="skill-prompt"
                name="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="h-[40vh] resize-none overflow-y-auto font-mono text-xs"
                style={{ fieldSizing: "fixed" }}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </saveFetcher.Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
