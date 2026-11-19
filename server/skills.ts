// Loads Agent Skills from .agents/skills/<name>/SKILL.md (agentskills.io format),
// the same folder Antigravity reads. Progressive disclosure: `skillMenu()` gives
// only names + descriptions; `loadSkills()` returns full instructions on demand.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../.agents/skills/', import.meta.url));

export interface Skill {
  name: string;
  description: string;
  body: string;
}

const cache = new Map<string, Skill>();

function parse(name: string): Skill {
  const raw = readFileSync(join(root, name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`Skill ${name} has no YAML frontmatter`);
  const meta = Object.fromEntries(
    m[1].split('\n').map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  if (meta.name !== name) throw new Error(`Skill folder ${name} does not match name: ${meta.name}`);
  return { name, description: meta.description ?? '', body: m[2].trim() };
}

export function getSkill(name: string): Skill {
  let s = cache.get(name);
  if (!s) {
    s = parse(name);
    cache.set(name, s);
  }
  return s;
}

/** Lightweight menu: names and descriptions only. */
export function skillMenu(): Pick<Skill, 'name' | 'description'>[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'SKILL.md')))
    .map((d) => {
      const { name, description } = getSkill(d.name);
      return { name, description };
    });
}

/** Full instructions for the given skills, joined into one system instruction. */
export function loadSkills(...names: string[]): string {
  return names.map((n) => `# Skill: ${n}\n\n${getSkill(n).body}`).join('\n\n---\n\n');
}
