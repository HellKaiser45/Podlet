import { readdir } from "node:fs/promises";
import type { SkillFrontmatter, Skillneeded } from "../types.js";
import { YAML } from "bun";
import { dirname, join } from 'node:path'
import { VirtualFileSystem } from "./sandbox.js";


export default class SkillsManager {
  private filepath: string;
  availableSkills: Record<string, Skillneeded> = {};

  constructor(path: string) {
    this.filepath = join(path, 'skills');
  }

  async loadSkill(path: string, separator: string = "---") {
    const filecontent = await Bun.file(join(this.filepath, path)).text()
    const start = filecontent.indexOf(separator)
    const end = filecontent.indexOf(separator, start + separator.length)
    const frontmatter = YAML.parse(filecontent.slice(start + separator.length, end)) as SkillFrontmatter
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
    await Promise.all(skillsfm)
  }

  async injectSkills(skillname: string[], systemprompt: string, vfs: VirtualFileSystem): Promise<string> {
    let skillsxml = `<available_skills>\n`
    for (const skill of skillname) {
      if (!this.availableSkills[skill]) {
        console.warn(`[injectSkills] Unknown skill: "${skill}" — skipping.`)
        continue
      }
      const skillDirVpath = vfs.realToVirtual(this.availableSkills[skill].location)
      const skillEntryVpath = `${skillDirVpath}/SKILL.md`
      skillsxml += `
<skill>
<name>${this.availableSkills[skill].name}</name>
<description>${this.availableSkills[skill].description}</description>
<location>${skillEntryVpath}</location>
</skill>
`
    }
    skillsxml += `</available_skills>`
    return systemprompt + '\n\n' + skillsxml
  }
}

