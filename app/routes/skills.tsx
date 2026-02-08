import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { Header } from "~/components/layout/header";
import { Main } from "~/components/layout/main";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
import { Sparkles } from "lucide-react";
import { listAllSkills, updateSkill } from "~/lib/db/queries";

const categoryLabels: Record<string, string> = {
  finance: "财务",
  photography: "摄影",
  illustration: "插画",
  data: "数据",
  legal: "法律",
  writing: "写作",
  general: "通用",
};

export async function loader() {
  const skills = await listAllSkills();
  return { skills };
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const skillId = formData.get("skillId") as string;
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const prompt = formData.get("prompt") as string;

  if (!skillId) {
    return { error: "Missing skill ID" };
  }

  await updateSkill(skillId, { name, description, prompt });
  return { ok: true };
}

type SkillData = Awaited<ReturnType<typeof listAllSkills>>[number];

export default function Skills() {
  const { skills } = useLoaderData<typeof loader>();
  const [selected, setSelected] = useState<SkillData | null>(null);

  return (
    <>
      <Header title="技能市场" />
      <Main className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">技能列表</h2>
          <p className="text-muted-foreground">
            每个角色都预配了专业技能。技能会自动写入沙盒的 SKILL.md 供 Agent 使用。
          </p>
        </div>
        {skills.length === 0 ? (
          <p className="text-muted-foreground">
            暂无技能。请运行 <code>npx tsx app/lib/db/seed-skills.ts</code> 初始化数据。
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {skills.map((skill) => (
              <Card
                key={skill.id}
                className="cursor-pointer transition-colors hover:border-primary/20"
                onClick={() => setSelected(skill)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-primary" />
                    <CardTitle className="text-sm">{skill.name}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="mb-2 text-xs text-muted-foreground">
                    {skill.description}
                  </p>
                  <Badge variant="outline" className="text-xs">
                    {categoryLabels[skill.category] ?? skill.category}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Main>

      <SkillEditDialog
        skill={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function SkillEditDialog({
  skill,
  onClose,
}: {
  skill: SkillData | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");

  const isSubmitting = fetcher.state !== "idle";

  // Sync form state when skill changes
  const [prevSkillId, setPrevSkillId] = useState<string | null>(null);
  if (skill && skill.id !== prevSkillId) {
    setPrevSkillId(skill.id);
    setName(skill.name);
    setDescription(skill.description);
    setPrompt(skill.prompt);
  }

  // Close dialog after successful save
  if (fetcher.data && (fetcher.data as { ok?: boolean }).ok && isSubmitting === false && skill) {
    onClose();
  }

  return (
    <Dialog open={!!skill} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑技能</DialogTitle>
          <DialogDescription>
            修改技能内容后点击保存，下次对话时将使用更新后的 SKILL.md。
          </DialogDescription>
        </DialogHeader>

        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="skillId" value={skill?.id ?? ""} />

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
              className="min-h-[300px] font-mono text-xs"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
