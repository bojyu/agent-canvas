---
name: agent-canvas
description: Build, inspect, edit, connect, and run prompt, image, and video workflows in the user's local Agent Canvas through semantic MCP tools. Use when the user asks Codex to operate Agent Canvas, assemble a visual workflow, add or connect canvas nodes, run a configured generation node, monitor its task, or retrieve canvas outputs.
---

# Agent Canvas

Use the `agent_canvas` MCP tools to operate the local Agent Canvas directly. Do not automate browser clicks and do not edit `.prompt-flow-data` JSON files by hand.

## Safe workflow

1. Call `canvas_health` before other Agent Canvas tools. If it reports that the service is offline, tell the user to start the Agent Canvas project with `npm run dev`; do not guess at stored files.
2. Default to an isolated background canvas. If the user asks to create or generate content without explicitly naming an existing canvas, call `canvas_create` and do all writes and runs there. Never infer that the newest, first, active, or currently visible canvas is safe to edit. Only modify an existing canvas when the user explicitly identifies it or explicitly says to use the current canvas.
3. For an explicitly selected existing canvas, call `canvas_list_projects`, then `canvas_inspect`. Keep its `revision` and use that value as `expectedRevision` for every write or run.
4. Before configuring a model, call `canvas_list_models` with the intended kind and provider. Write the exact returned `model` field into the node configuration; do not confuse it with the catalog item's composite `id` field.
5. Build one atomic `canvas_apply_workflow` request. First call it with `dryRun: true`; if valid, call it again with `dryRun: false`, the same operations, and a new transaction ID. Re-inspect after each committed write because the revision changes.
6. Only call `canvas_run` when the user explicitly asked to produce or regenerate content. Image and video generation can consume paid credits. Run one node at a time, then call `canvas_get_task` with `waitSeconds` up to 55 until it reaches `completed`, `failed`, or `cancelled`.
7. Call `canvas_get_outputs` after completion. Generated files are automatically saved by Agent Canvas and the compact response contains their local `savedPath` values without large inline media.

If a write returns a revision conflict, stop using the stale graph, call `canvas_inspect` again, and rebuild the transaction against the new revision. Never bypass this protection.

## Node vocabulary

Use these semantic `nodeType` values in `add_node` operations:

- `text`: editable text input/output node. Set `text` in the operation or `data.text`/`data.prompt`.
- `image`: image input/output and preview node.
- `video`: video input/output and preview node.
- `prompt`: the “编辑改写” prompt-generation node. Configure `data.provider`, `data.model`, `data.reasoningEffort`, `data.skillId`, and `data.instruction`. Use `skillId: "none"` for a generic prompt task that loads no Skill, `skillId: "nanobanana"` for Nano Banana prompts, and `skillId: "image"` for GPT Image prompts.
- `prompt_editor`: two-part prompt editing node. Configure `data.instruction`; load the original prompt through a text connection or `data.prompt`.
- `image_generator`: configure `data.imageProvider`, `data.imageModel`, `data.resolution`, `data.ratio`, and either `data.instruction` or a connected text prompt.
- `video_generator`: configure `data.videoGenerationProvider`, `data.videoGenerationModel`, `data.videoGenerationMode`, `data.videoGenerationResolution`, `data.duration`, `data.ratio`, and `data.generateAudio`.
- `group`: visual group container. Prefer the `group` operation with `nodeIds` instead of creating one manually.

Supported prompt modes are `none`, `seedance`, `nanobanana`, `image`, and `photoreal`. `none` is an explicit no-Skill mode: Agent Canvas must not read, mount, inject, imitate, or claim to use any Skill for that task. `nanobanana` and `image` are two model-specific adapters over the same installed Image skill: Nano Banana uses natural-language prompt structure, while GPT Image uses its labeled five-slot structure. The generation nodes themselves do not load skills; a prompt node can prepare their upstream text.

## Connections

Use `connect` operations with these handles:

- Text to image/video generator: `targetHandle: "prompt"`.
- Text to prompt editor: `targetHandle: "original-prompt"`.
- Image/video reference to a compatible prompt or generator node: `targetHandle: "media-1"` through `"media-12"`.
- Processor to matching output node: omit `targetHandle`.

The service validates node compatibility, reference limits, dangling edges, duplicate IDs, and occupied input handles before saving the transaction.

## Common transaction patterns

To add a connected image workflow, the easiest path is:

```json
{
  "op": "apply_preset",
  "presetId": "image-generation",
  "position": { "x": 100, "y": 120 }
}
```

The preset creates one reference image, one image generator, one image output, and both connections. Inspect the dry-run preview or committed canvas to obtain the generated IDs, then update the generator with an exact provider model and prompt.

For a custom workflow, assign stable readable IDs yourself:

```json
[
  { "op": "add_node", "id": "brief", "nodeType": "text", "position": { "x": 80, "y": 120 }, "text": "A studio product photograph" },
  { "op": "add_node", "id": "render", "nodeType": "image_generator", "position": { "x": 560, "y": 120 }, "data": { "imageProvider": "comfly", "imageModel": "gpt-image-2", "resolution": "2K", "ratio": "1:1" } },
  { "op": "add_node", "id": "result", "nodeType": "image", "position": { "x": 1180, "y": 120 }, "title": "生成图片" },
  { "op": "connect", "source": "brief", "target": "render", "targetHandle": "prompt" },
  { "op": "connect", "source": "render", "target": "result" }
]
```

Use `canvas_attach_media` with an absolute local file path after creating an `image` or `video` reference node. It intentionally does not return the embedded base64 value.

## Boundaries

- Never request, read, echo, or place API keys in workflow data. Keys remain in Agent Canvas settings.
- Never run a paid node merely to test wiring. A successful dry-run validates the graph without contacting a model provider.
- If the user has not supplied actual prompt content, use an obvious editable placeholder while building the graph and do not run it.
- Never return inline media to the conversation. Use `savedPath` metadata from tasks or outputs.
- Do not silently overwrite unsaved browser edits. Revision conflicts are expected coordination signals.
- Keep background work non-invasive: do not switch the user's visible canvas, request a browser refresh, or reload the Agent Canvas web app. Task progress belongs in the task center and server-side results remain available until the user explicitly loads them.
- Never restart the combined Agent Canvas development service while a generation task or browser editing session may be active. If a code or configuration change requires restart, finish or stop the task and ask the user to save their canvas before restarting. Backend-only maintenance must preserve the web process.
- The first release executes one node at a time. Sequence dependent nodes explicitly instead of pretending the whole graph is an automatic DAG runner.
