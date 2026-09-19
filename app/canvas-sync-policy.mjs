function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveRevision(value, fallback = 0) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : fallback;
}

/**
 * Background automation is never allowed to replace the active editor graph.
 * It may update project-list metadata and advertise a newer disk revision.
 */
export function backgroundProjectEventDecision({
  event,
  currentProjectId,
  currentRevision = 0,
  pendingRemoteRevision = 0,
}) {
  const revision = positiveRevision(event?.revision);
  const affectsCurrent = Boolean(currentProjectId)
    && event?.projectId === currentProjectId
    && event?.actor !== "ui";
  const newerThanEditor = affectsCurrent && revision > positiveRevision(currentRevision);
  return {
    updateProjectList: Boolean(event?.project),
    affectsCurrent,
    replaceCanvas: false,
    pendingRemoteRevision: newerThanEditor
      ? Math.max(positiveRevision(pendingRemoteRevision), revision)
      : positiveRevision(pendingRemoteRevision),
  };
}

/** Automation tasks are persisted server-side; applying them again in the live
 * editor causes a double write and can race with unsaved local edits. */
export function shouldApplyTaskOutcome(task) {
  return task?.origin !== "automation";
}

export function parseCanvasDraft(raw) {
  if (!raw) return null;
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
  const version = Number(value.version) === 1 ? 1 : 0;
  return {
    version,
    projectId: typeof value.projectId === "string" ? value.projectId : "",
    projectName: typeof value.projectName === "string" ? value.projectName : "",
    baseRevision: positiveRevision(value.baseRevision),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    // Legacy snapshots had no metadata. Favor recovery once instead of risking
    // data loss; the next write upgrades them to the v1 shape.
    dirty: value.dirty !== false,
    nodes: value.nodes,
    edges: value.edges,
    legacy: version === 0,
  };
}

export function createCanvasDraft({ projectId, projectName, baseRevision, dirty, nodes, edges, updatedAt = new Date().toISOString() }) {
  return {
    version: 1,
    projectId: String(projectId || ""),
    projectName: String(projectName || ""),
    baseRevision: positiveRevision(baseRevision),
    updatedAt: updatedAt || new Date().toISOString(),
    dirty: Boolean(dirty),
    nodes,
    edges,
  };
}

/** Restore lightweight draft structure while retaining media payloads already
 * present in the saved project for nodes that still exist in the draft. */
export function mergeCanvasDraft(savedProject, draft) {
  const savedNodes = new Map((savedProject?.nodes || []).map((node) => [node.id, node]));
  const nodes = (draft?.nodes || []).map((draftNode) => {
    const savedNode = savedNodes.get(draftNode.id);
    if (!savedNode) return draftNode;
    return {
      ...savedNode,
      ...draftNode,
      data: { ...(savedNode.data || {}), ...(draftNode.data || {}) },
    };
  });
  return { nodes, edges: draft?.edges || [] };
}
