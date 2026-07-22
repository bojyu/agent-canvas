import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCanvasNode } from "../scripts/canvas-domain.mjs";
import { CanvasProjectStore, CanvasRevisionConflictError } from "../scripts/canvas-project-store.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "agent-canvas-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const events = [];
  const store = new CanvasProjectStore({ directory, onChange: (event) => events.push(event) });
  const project = await store.createProject({
    id: "project-test-001",
    name: "Store test",
    nodes: [createCanvasNode("text", { id: "brief", text: "one" })],
    edges: [],
  });
  return { directory, events, project, store };
}

test("store assigns revisions and rejects stale saves", async (t) => {
  const { project, store } = await fixture(t);
  assert.equal(project.revision, 1);
  const saved = await store.saveProject(project.id, { ...project, name: "Changed" }, { expectedRevision: 1 });
  assert.equal(saved.revision, 2);
  await assert.rejects(
    store.saveProject(project.id, { ...saved, name: "Stale" }, { expectedRevision: 1 }),
    CanvasRevisionConflictError,
  );
  assert.equal((await store.readProject(project.id)).name, "Changed");
});

test("dry-run does not persist and committed transaction is idempotent", async (t) => {
  const { events, project, store } = await fixture(t);
  const request = {
    transactionId: "test:add-image",
    expectedRevision: 1,
    operations: [{ op: "add_node", id: "image", nodeType: "image", position: { x: 400, y: 100 } }],
  };
  const preview = await store.applyTransaction(project.id, { ...request, dryRun: true });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.project.nodes.length, 2);
  assert.equal((await store.readProject(project.id)).nodes.length, 1);
  const applied = await store.applyTransaction(project.id, request);
  assert.equal(applied.project.revision, 2);
  const duplicate = await store.applyTransaction(project.id, { ...request, expectedRevision: 2 });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.project.revision, 2);
  assert.equal(events.filter((event) => event.transactionId === request.transactionId).length, 1);
});

test("per-project lock allows only one writer at the same base revision", async (t) => {
  const { project, store } = await fixture(t);
  const results = await Promise.allSettled([
    store.applyTransaction(project.id, { transactionId: "writer:a", expectedRevision: 1, operations: [{ op: "rename_project", name: "A" }] }),
    store.applyTransaction(project.id, { transactionId: "writer:b", expectedRevision: 1, operations: [{ op: "rename_project", name: "B" }] }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected" && item.reason instanceof CanvasRevisionConflictError).length, 1);
  assert.equal((await store.readProject(project.id)).revision, 2);
});

test("atomic writes leave no temporary files", async (t) => {
  const { directory, project, store } = await fixture(t);
  await store.saveProject(project.id, { ...project, name: "No temp" }, { expectedRevision: 1 });
  const files = await readdir(directory);
  assert.equal(files.some((name) => name.endsWith(".tmp")), false);
});
