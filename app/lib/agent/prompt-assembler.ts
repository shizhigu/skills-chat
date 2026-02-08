import type { PersonaPreset } from "~/lib/personas";

export function assembleSystemPrompt(
  persona: PersonaPreset,
  activeSkills?: Array<{ name: string; prompt: string }>
): string {
  const sections: string[] = [];

  // 1. Base persona prompt
  sections.push(`# 角色定义\n\n你是一位专业的${persona.name}。${persona.description}`);

  // 2. Active skill prompts
  if (activeSkills && activeSkills.length > 0) {
    for (const skill of activeSkills) {
      sections.push(`# Skill: ${skill.name}\n\n${skill.prompt}`);
    }
  }

  // 3. Output guidelines
  sections.push(`# 输出规范\n
- 使用用户的语言回复
- 结构化输出使用 Markdown
- 代码块标注语言类型
- 涉及计算时展示完整过程
- 回答要专业、具体、有深度`);

  return sections.join("\n\n---\n\n");
}
