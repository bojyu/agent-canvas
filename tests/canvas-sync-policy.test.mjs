import assert from "node:assert/strict";
import test from "node:test";

import {
  backgroundProjectEventDecision,
  createCanvasDraft,
  mergeCanvasDraft,
  parseCanvasDraft,
  shouldApplyTaskOutcome,
} from "../app/canvas-sync-policy.mjs";

test("background project events never replace the active editor", () => {
  for (const actor of ["automation", "automation-task"]) {
    for (const saveState of ["saved", "unsaved", "error"]) {
      const decision = backgroundProjectEventDecision({
        event: { type: "project", projectId: "active", revision: 4, actor, project: { id: "active" } },
        currentProjectId: "active",
        currentRevision: 3,
        pendingRemoteRevision: 0,
        saveState,
      });
      assert.equal(decision.replaceCanvas, false);
      assert.equal(decision.pendingRemoteRevision, 4);
      assert.equal(decision.updateProjectList, true);
    }
  }
});

test("other-project and stale events do not disturb the active revision", () => {
  const other = backgroundProjectEventDecision({
    event: { type: "project", projectId: "other", revision: 9, actor: "automation", project: { id: "other" } },
    currentProjectId: "active",
    currentRevision: 3,
    pendingRemoteRevision: 5,
  });
  assert.equal(other.affectsCurrent, false);
  assert.equal(other.pendingRemoteRevision, 5);

  const stale = backgroundProjectEventDecision({
    event: { type: "project", projectId: "active", revision: 2, actor: "automation-task" },
    currentProjectId: "active",
    currentRevision: 3,
    pendingRemoteRevision: 5,
  });
  assert.equal(stale.pendingRemoteRevision, 5);
});

test("automation tasks update the task center without double-applying node output", () => {
  assert.equal(shouldApplyTaskOutcome({ origin: "automation", status: "completed" }), false);
  assert.equal(shouldApplyTaskOutcome({ origin: "ui", status: "completed" }), true);
  assert.equal(shouldApplyTaskOutcome({ status: "completed" }), true);
});

test("draft parsing upgrades legacy snapshots and preserves unsaved intent", () => {
  const legacy = parseCanvasDraft(JSON.stringify({ nodes: [{ id: "text", data: { text: "local" } }], edges: [] }));
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.dirty, true);

  const saved = parseCanvasDraft(JSON.stringify(createCanvasDraft({
    projectId: "project",
    projectName: "Canvas",
    baseRevision: 7,
    dirty: false,
    nodes: [],
    edges: [],
    updatedAt: "2026-07-22T00:00:00.000Z",
  })));
  assert.equal(saved.legacy, false);
  assert.equal(saved.dirty, false);
  assert.equal(saved.baseRevision, 7);
});

test("draft recovery keeps saved media while preserving local graph edits", () => {
  const merged = mergeCanvasDraft({
    nodes: [
      { id: "image", position: { x: 0, y: 0 }, data: { imageData: "data:image/png;base64,abc", title: "Saved" } },
      { id: "deleted", data: { title: "Removed locally" } },
    ],
  }, {
    nodes: [
      { id: "image", position: { x: 40, y: 60 }, data: { title: "Local" } },
      { id: "new", position: { x: 80, y: 90 }, data: { text: "draft" } },
    ],
    edges: [{ id: "edge", source: "image", target: "new" }],
  });
  assert.equal(merged.nodes.length, 2);
  assert.equal(merged.nodes[0].data.imageData, "data:image/png;base64,abc");
  assert.equal(merged.nodes[0].data.title, "Local");
  assert.deepEqual(merged.nodes[0].position, { x: 40, y: 60 });
  assert.equal(merged.nodes.some((node) => node.id === "deleted"), false);
  assert.equal(merged.edges.length, 1);
});
