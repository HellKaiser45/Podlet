import { readdir } from "node:fs/promises";
import { SkillFrontmatter, Skillneeded } from "../types.js";
import { YAML } from "bun";
import { join } from 'node:path'


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
      location: join(this.filepath, path),
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

  async injectSkills(skillname: string[], systemprompt: string): Promise<string> {
    let skillsxml = `<available_skills>\n`
    for (const skill of skillname) {

      skillsxml += `
<skill>
<name>${this.availableSkills[skill].name}</description>
<description>${this.availableSkills[skill].description}</description>
<location>${this.availableSkills[skill].location}</location>
</skill>
`
    }
    skillsxml += `</available_skills>`

    return systemprompt + '\n\n' + skillsxml

  }
}

