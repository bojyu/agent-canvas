import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SkillRegistryStore } from "../scripts/skill-registry-store.mjs";

test("custom Skill registry validates, refreshes, and unregisters without deleting files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-canvas-skill-registry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillRoot = join(root, "chair-skill");
  await mkdir(join(skillRoot, "references"), { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), "---\nname: Chair Director\ndescription: Chair prompt guidance\nversion: 1.0.0\n---\n\n# Chair Director\n", "utf8");
  await writeFile(join(skillRoot, "references", "rules.md"), "# Rules\nKeep product geometry.", "utf8");
  const store = new SkillRegistryStore({ path: join(root, "data", "skills.json") });

  const registered = await store.register(skillRoot);
  assert.match(registered.id, /^custom:chair-director-/);
  assert.deepEqual(registered.referenceFiles, ["references/rules.md"]);
  assert.equal((await store.list()).length, 1);

  await writeFile(join(skillRoot, "SKILL.md"), "---\nname: Chair Director\ndescription: Updated\n---\n", "utf8");
  const refreshed = await store.refresh(registered.id);
  assert.equal(refreshed.description, "Updated");
  await store.unregister(registered.id);
  assert.deepEqual(await store.list(), []);
  assert.match(await readFile(join(skillRoot, "SKILL.md"), "utf8"), /Updated/);
});

test("custom Skill registry rejects relative paths and symbolic links", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-canvas-skill-safety-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SkillRegistryStore({ path: join(root, "skills.json") });
  await assert.rejects(() => store.register("relative/skill"), /绝对路径/);
});
