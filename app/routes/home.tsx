import { useLoaderData, useFetcher } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { Header } from "~/components/layout/header";
import { Main } from "~/components/layout/main";
import { PersonaGrid } from "~/components/persona/persona-grid";
import { listPublicPersonas, updateSkill } from "~/lib/db/queries";
import { PERSONA_PRESETS } from "~/lib/personas";

export async function loader() {
  const dbPersonas = await listPublicPersonas();

  // Merge DB skills with preset data (icons/colors live in presets)
  const personas = PERSONA_PRESETS.map((preset) => {
    const dbMatch = dbPersonas.find((p) => p.slug === preset.slug);
    const skills = (dbMatch?.personaSkills ?? []).map((ps) => ({
      id: ps.skill.id,
      slug: ps.skill.slug,
      name: ps.skill.name,
      category: ps.skill.category,
      icon: ps.skill.icon,
    }));
    return { slug: preset.slug, skills };
  });

  return { personas };
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "getSkillPrompt") {
    // Lazy-load full prompt for a single skill
    const { db } = await import("~/lib/db/index");
    const { skills } = await import("~/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const skillId = formData.get("skillId") as string;
    const result = await db.query.skills.findFirst({
      where: eq(skills.id, skillId),
      columns: { id: true, name: true, description: true, prompt: true },
    });
    return result ?? null;
  }

  if (intent === "updateSkill") {
    const skillId = formData.get("skillId") as string;
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const prompt = formData.get("prompt") as string;
    await updateSkill(skillId, { name, description, prompt });
    return { ok: true };
  }

  return null;
}

export default function Home() {
  const { personas } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title="选择 AI 角色" />
      <Main className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">AI Agent 角色</h2>
          <p className="text-muted-foreground">
            选择一个专业角色，开始你的 AI 对话体验。每个角色都预配了专业的 prompt、技能和工具。
          </p>
        </div>
        <PersonaGrid personaSkills={personas} />
      </Main>
    </>
  );
}
