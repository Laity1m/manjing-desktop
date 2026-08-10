export interface Skill {
  id: string;
  name: string;
  description: string;
  targetAgent: string;
  version: string;
  instructions: string;
  examples: string[];
  rules: string[];
  templates: string[];
}

export function extractSkillsFromMd(content: string): Skill[] {
  const blocks = content.split(/^##/gm).map((item) => item.trim()).filter(Boolean);
  const skills: Skill[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const header = lines[0] || "";
    const linesText = lines.slice(1).join("\n");
    const values = parsePairs(linesText);

    if (!header || !linesText) continue;

    skills.push({
      id: slugify(header),
      name: header,
      description: values.description || "",
      targetAgent: values.targetAgent || "writer",
      version: values.version || "1.0.0",
      instructions: values.instructions || "",
      examples: splitList(values.examples),
      rules: splitList(values.rules),
      templates: splitList(values.templates),
    });
  }

  return skills;
}

function parsePairs(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const [key, ...rest] = line.split(":");
    if (!key || rest.length === 0) continue;
    const next = rest.join(":").trim();
    const cleanKey = key.trim().replace(/[\]\[]/g, "").toLowerCase();
    result[cleanKey] = next;
  }

  return result;
}

function splitList(value = "") {
  return value
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(input: string) {
  return input.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").slice(0, 36);
}
