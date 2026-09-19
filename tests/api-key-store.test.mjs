import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  API_KEY_NAMES,
  apiKeyStatus,
  normalizeApiKeyChanges,
  saveApiKeyChanges,
  updateEnvText,
} from "../scripts/api-key-store.mjs";

test("API key status exposes booleans but never secret values", () => {
  const status = apiKeyStatus({ OPENROUTER_API_KEY: "secret-openrouter", COMFLY_API_KEY: "" });
  assert.equal(status.OPENROUTER_API_KEY, true);
  assert.equal(status.COMFLY_API_KEY, false);
  assert.equal(Object.keys(status).length, API_KEY_NAMES.length);
  assert.doesNotMatch(JSON.stringify(status), /secret-openrouter/);
});

test("environment updates preserve unrelated settings and support replace and clear", () => {
  const source = [
    "# local settings",
    "OPENROUTER_API_KEY=old-key",
    "COMFLY_API_KEY=general-key",
    "CUSTOM_SETTING=keep-me",
    "OPENROUTER_API_KEY=duplicate",
    "",
  ].join("\n");
  const updated = updateEnvText(source, {
    OPENROUTER_API_KEY: "new#key",
    COMFLY_API_KEY: null,
    GEMINI_API_KEY: "google-key",
  });

  assert.match(updated, /^# local settings/m);
  assert.match(updated, /^CUSTOM_SETTING=keep-me$/m);
  assert.match(updated, /^OPENROUTER_API_KEY="new#key"$/m);
  assert.match(updated, /^GEMINI_API_KEY="google-key"$/m);
  assert.doesNotMatch(updated, /^COMFLY_API_KEY=/m);
  assert.equal((updated.match(/^OPENROUTER_API_KEY=/gm) || []).length, 1);
});

test("API key updates reject unknown names, blank values and line breaks", () => {
  assert.throws(() => normalizeApiKeyChanges({ UNKNOWN_API_KEY: "secret" }), /不支持/);
  assert.throws(() => normalizeApiKeyChanges({ OPENROUTER_API_KEY: "  " }), /不能为空/);
  assert.throws(() => normalizeApiKeyChanges({ OPENROUTER_API_KEY: "line\nbreak" }), /换行/);
});

test("saving API keys updates the local env file and current process environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-canvas-api-keys-"));
  const envPath = join(root, ".env.local");
  const env = { COMFLY_API_KEY: "old" };
  try {
    await writeFile(envPath, "COMFLY_API_KEY=old\nOTHER=value\n", "utf8");
    const result = await saveApiKeyChanges(envPath, {
      COMFLY_API_KEY: null,
      COMFLY_LLM_API_KEY: "text-key",
    }, env);
    const saved = await readFile(envPath, "utf8");
    assert.doesNotMatch(saved, /^COMFLY_API_KEY=/m);
    assert.match(saved, /^COMFLY_LLM_API_KEY="text-key"$/m);
    assert.match(saved, /^OTHER=value$/m);
    assert.equal(env.COMFLY_API_KEY, undefined);
    assert.equal(env.COMFLY_LLM_API_KEY, "text-key");
    assert.equal(result.configured.COMFLY_LLM_API_KEY, true);
    assert.equal(result.envFile, ".env.local");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("concurrent API key saves preserve both changes and restrict file permissions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agent-canvas-keys-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const envPath = join(root, ".env.local");
  await writeFile(envPath, "OTHER=value\n", { mode: 0o644 });
  const env = {};
  await Promise.all([
    saveApiKeyChanges(envPath, { OPENROUTER_API_KEY: "router-key" }, env),
    saveApiKeyChanges(envPath, { GEMINI_API_KEY: "gemini-key" }, env),
  ]);
  const saved = await readFile(envPath, "utf8");
  assert.match(saved, /^OTHER=value$/m);
  assert.match(saved, /^OPENROUTER_API_KEY="router-key"$/m);
  assert.match(saved, /^GEMINI_API_KEY="gemini-key"$/m);
  assert.equal(env.OPENROUTER_API_KEY, "router-key");
  assert.equal(env.GEMINI_API_KEY, "gemini-key");
  if (process.platform !== "win32") assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(root), [".env.local"]);
});
