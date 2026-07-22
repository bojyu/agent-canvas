import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const bridge = fileURLToPath(new URL("./codex-bridge.mjs", import.meta.url));
const web = fileURLToPath(new URL("./run-vinext.mjs", import.meta.url));
const localEnv = fileURLToPath(new URL("../.env.local", import.meta.url));

const children = [
  // Node watch mode reloads only the bridge and its imported provider modules.
  // Frontend state stays alive when backend code changes during canvas editing.
  spawn(process.execPath, ["--watch", bridge], {
    stdio: "inherit",
    env: { ...process.env, PROMPT_CANVAS_ENV_FILE: localEnv },
  }),
  spawn(process.execPath, [web, "dev"], { stdio: "inherit" }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 100).unref();
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping && code && code !== 0) stop(code);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
