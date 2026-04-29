import { readdir } from "node:fs/promises";
import type { SkillFrontmatter, Skillneeded } from "../types.js";
import { YAML } from "bun";
import { dirname, join } from 'node:path'
import { VirtualFileSystem } from "./sandbox.js"


export default class SkillsManager {
  private filepath: string;
  availableSkills: Record<string, Skillneeded> = {};

  constructor(path: string) {
    this.filepath = join(path, 'skills');
  }

  async loadSkill(path: string, separator: string = "---") {
    const fullPath = join(this.filepath, path)
    let filecontent: string
    try {
      filecontent = await Bun.file(fullPath).text()
    } catch (err) {
      console.warn(`[loadSkill] Failed to read ${path}: ${err}`)
      return
    }
    const start = filecontent.indexOf(separator)
    const end = filecontent.indexOf(separator, start + separator.length)
    const rawYaml = filecontent.slice(start + separator.length, end)

    let frontmatter: SkillFrontmatter
    try {
      frontmatter = YAML.parse(rawYaml) as SkillFrontmatter
    } catch (firstErr) {
      try {
        const patched = rawYaml.split('\n').map((line: string) => {
          const m = line.match(/^(\s*\w[\w-]*\s*:\s*)(.+)$/s)
          if (!m) return line
          const [, prefix, value] = m
          const trimmed = value.trim()
          if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return line
          if (/https?:\/\//.test(trimmed) || /^\d{4}-\d{2}-\d{2}/.test(trimmed)) return line
          if (!trimmed.includes(':')) return line
          return `${prefix}"${trimmed}"`
        }).join('\n')
        frontmatter = YAML.parse(patched) as SkillFrontmatter
      } catch (secondErr) {
        console.warn(`[loadSkill] Malformed YAML in ${path}, skipping: ${secondErr}`)
        return
      }
    }

    if (!frontmatter.name) {
      console.warn(`[loadSkill] Missing "name" in ${path}, skipping.`)
      return
    }
    if (!frontmatter.description) {
      console.warn(`[loadSkill] Missing "description" in ${path}, skipping.`)
      return
    }

    this.availableSkills[frontmatter.name] = {
      name: frontmatter.name,
      description: frontmatter.description,
      location: join(this.filepath, dirname(path)),
    }
  }

  async LoadSkillsDefs() {
    const files = await readdir(this.filepath, { recursive: true });
    const skillsfm: Promise<void>[] = []
    for (const file of files) {
      if (file.includes("SKILL.md")) {
        skillsfm.push(this.loadSkill(file))
      }
    }
    const results = await Promise.allSettled(skillsfm)
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn(`[LoadSkillsDefs] A skill failed to load: ${r.reason}`)
      }
    }
  }

  async injectSkills(skillname: string[], systemprompt: string, vfs: VirtualFileSystem): Promise<string> {
    const validEntries: { skill: Skillneeded; skillDirVpath: string; skillEntryVpath: string }[] = []
    for (const name of skillname) {
      if (!this.availableSkills[name]) {
        console.warn(`[injectSkills] Unknown skill: "${name}" — skipping.`)
        continue
      }
      const skill = this.availableSkills[name]
      const skillDirVpath = vfs.realToVirtual(skill.location)
      const skillEntryVpath = `${skillDirVpath}/SKILL.md`
      validEntries.push({ skill, skillDirVpath, skillEntryVpath })
    }
    if (validEntries.length === 0) return systemprompt

    let skillsxml = `You have access to specialized skills listed below. These are expert instruction sets for specific tasks.

BEFORE starting any task:
1. Review the available skills below
2. If a task EVEN PARTIALLY matches a skill's description, read the SKILL.md at its <location> using your read_file tool to get the full instructions
3. Follow those instructions precisely

Do not guess how to perform a specialized task if a skill exists for it. Read the skill first. Skills are provided because they contain critical domain knowledge, scripts, templates, and step-by-step procedures that you will not have in your training data.

When uncertain whether a skill applies, read it anyway. The cost of reading an irrelevant skill is minimal. The cost of skipping a relevant one is a degraded result.

When a skill references relative paths (scripts/, references/, templates/), resolve them against the skill's <directory>.

<available_skills>
`
    for (const entry of validEntries) {
      skillsxml += `
<skill>
<name>${entry.skill.name}</name>
<description>${entry.skill.description}</description>
<location>${entry.skillEntryVpath}</location>
<directory>${entry.skillDirVpath}</directory>
</skill>
`
    }
    skillsxml += `</available_skills>`
    return systemprompt + '\n\n' + skillsxml
  }
}
