import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveModel } from '../apps/gateway/src/system/providers';
import { applyEnvFile } from '../apps/gateway/src/system/env';

/**
 * Upgrade `models.json` to the current schema, then show what still needs a
 * human. Dry-run by default; `--write` is the only thing that touches a file.
 *
 * Model-level fields that no longer exist:
 *   - reasoning_effort: thinking moved to the agent (`agent.thinking`)
 *   - protocol: derived from `provider` (see system/providers.ts)
 * A stored value for either makes the entry unusable, which is why this script
 * exists. Agent files are never modified: `agent.thinking` is a user decision.
 */
const REMOVED_FIELDS = ['reasoning_effort', 'protocol'] as const;

const write = process.argv.includes('--write');

// Same config-dir rule the other scripts in this folder use (`~/.podlet`),
// overridable with PODLET_DIR so the script can be pointed at a checkout copy.
const podletDir = process.env.PODLET_DIR
  ? path.resolve(process.env.PODLET_DIR)
  : path.join(os.homedir(), '.podlet');
const modelsPath = path.join(podletDir, 'models.json');
const agentsDir = path.join(podletDir, 'agents');

type Entry = Record<string, unknown>;
type LegacyField = { field: string; value: unknown };

/** Timestamped, and never already existing: a second run cannot clobber the first backup. */
function backupPath(file: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  let candidate = `${file}.${stamp}.bak`;
  let n = 1;
  while (existsSync(candidate)) candidate = `${file}.${stamp}-${n++}.bak`;
  return candidate;
}

function isPlainObject(value: unknown): value is Entry {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function main(): Promise<number> {
  // Keys may live only in `.env`: classification below reads process.env.
  const { warnings } = await applyEnvFile(podletDir);
  for (const warning of warnings) console.error(`[env] ${warning}`);

  console.log('');
  console.log(`  models.json: ${modelsPath}`);
  console.log(`  mode:        ${write ? 'write' : 'dry-run (pass --write to apply)'}`);

  if (!existsSync(modelsPath)) {
    console.log('  no models.json found — nothing to upgrade.');
    return 0;
  }

  const raw = readFileSync(modelsPath, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`  [!] models.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  if (!isPlainObject(parsed)) {
    console.error('  [!] models.json: expected a JSON object mapping model names to configs');
    return 1;
  }
  const models = parsed as Record<string, unknown>;

  // --- Plan: which entries still carry a removed model-level field, and what.
  const legacyByModel = new Map<string, LegacyField[]>();
  for (const [name, entry] of Object.entries(models)) {
    if (!isPlainObject(entry)) continue;
    const found: LegacyField[] = [];
    for (const field of REMOVED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(entry, field)) {
        found.push({ field, value: entry[field] });
      }
    }
    if (found.length > 0) legacyByModel.set(name, found);
  }

  console.log('');
  if (legacyByModel.size === 0) {
    console.log('  no removed model-level fields found.');
  } else {
    console.log(`  ${write ? 'removing' : 'would remove'} removed model-level fields:`);
    for (const [name, fields] of legacyByModel) {
      for (const { field, value } of fields) {
        console.log(
          `    - model '${name}': ${write ? 'delete' : 'would delete'} "${field}" (currently ${JSON.stringify(value)})`,
        );
      }
    }
  }

  // --- Rewrite, preserving entry order, 2-space indent and the trailing newline.
  let effective: Record<string, unknown> = models;
  if (write && legacyByModel.size > 0) {
    const next: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(models)) {
      const legacy = legacyByModel.get(name);
      if (legacy && isPlainObject(entry)) {
        const copy: Entry = { ...entry };
        for (const { field } of legacy) delete copy[field];
        next[name] = copy;
      } else {
        next[name] = entry;
      }
    }

    const backup = backupPath(modelsPath);
    writeFileSync(backup, raw, 'utf8');
    console.log('');
    console.log(`  backup:  ${backup}`);

    writeFileSync(modelsPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    console.log(`  written: ${modelsPath}`);
    effective = next;
  }

  // --- Health, resolved exactly the way the gateway resolves it.
  // In dry-run the legacy keys are still present, so their reason is what the
  // gateway would report today; in write mode this is the post-upgrade state.
  console.log('');
  console.log('  health:');
  let unusable = 0;
  for (const [name, entry] of Object.entries(effective)) {
    const { health } = resolveModel(name, entry, process.env);
    if (health.status === 'ok') {
      console.log(`    [ok]      ${name}`);
    } else {
      if (health.status === 'unusable') unusable++;
      console.log(`    [${health.status}] ${name}: ${health.reason}`);
    }
  }
  if (Object.keys(effective).length === 0) {
    console.log('    (no models)');
  }

  // --- Suggestions only: agent.thinking is the user's decision, so agent files
  // are read and nothing more.
  if (legacyByModel.size > 0 && existsSync(agentsDir)) {
    const suggestions: string[] = [];
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.json'))) {
      let agent: unknown;
      try {
        agent = JSON.parse(readFileSync(path.join(agentsDir, file), 'utf8'));
      } catch {
        continue;
      }
      if (!isPlainObject(agent) || typeof agent.model !== 'string') continue;
      const legacy = legacyByModel.get(agent.model)?.find((f) => f.field === 'reasoning_effort');
      if (!legacy) continue;

      const was = String(legacy.value);
      const mapped = was === 'low' || was === 'medium' || was === 'high' ? was : undefined;
      suggestions.push(
        mapped
          ? `    - ${file}: model '${agent.model}' had reasoning_effort '${was}' -> set "thinking": "${mapped}" by hand`
          : `    - ${file}: model '${agent.model}' had reasoning_effort '${was}' -> pick a "thinking" value by hand`,
      );
    }
    if (suggestions.length > 0) {
      console.log('');
      console.log('  agent files to update by hand (left untouched):');
      for (const line of suggestions) console.log(line);
    }
  }

  return unusable > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`  models:upgrade failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });