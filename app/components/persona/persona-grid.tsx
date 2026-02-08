import { PersonaCard } from "./persona-card";
import { PERSONA_PRESETS } from "~/lib/personas";

export interface PersonaSkillInfo {
  slug: string;
  skills: Array<{
    id: string;
    slug: string;
    name: string;
    category: string;
    icon: string | null;
  }>;
}

interface PersonaGridProps {
  personaSkills?: PersonaSkillInfo[];
}

export function PersonaGrid({ personaSkills }: PersonaGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {PERSONA_PRESETS.map((persona) => {
        const match = personaSkills?.find((p) => p.slug === persona.slug);
        return (
          <PersonaCard
            key={persona.slug}
            persona={persona}
            skills={match?.skills ?? []}
          />
        );
      })}
    </div>
  );
}
