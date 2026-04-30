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

    let skillsxml = `MANDATORY SKILL USAGE PROTOCOL

You have access to specialized skills listed below. These are expert instruction sets for specific tasks that you do NOT have in your training data.

RULES:
1. Before starting any task, review the available skills below
2. If a task EVEN PARTIALLY matches a skill description, you MUST read the SKILL.md at its <location> using your read_file tool BEFORE taking any action
3. Call read_file({ paths: ["<location_value>"] }) to load the skill instructions
4. Follow those instructions precisely - they contain procedures, scripts, templates, and reference material you need

EXAMPLES:

User asks: "Create a PowerPoint presentation"
Skill match: pptx-generator with <location>skills://pptx/SKILL.md</location>
Your FIRST action: read_file({ paths: ["skills://pptx/SKILL.md"] })
Then follow the instructions returned.

User asks: "Review my code for security issues"
Skill match: code-reviewer with <location>skills://code-reviewer/SKILL.md</location>
Your FIRST action: read_file({ paths: ["skills://code-reviewer/SKILL.md"] })
Then follow the instructions returned.

NEVER skip reading a relevant skill. The cost of reading an irrelevant skill is minimal. The cost of skipping a relevant one is a degraded result. NO EXCEPTIONS.

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
