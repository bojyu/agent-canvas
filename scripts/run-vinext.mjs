import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = process.argv[2] || "dev";
const vinextCli = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const args = [vinextCli, command];

if (command === "dev") {
  args.push("--host", "127.0.0.1", "--port", "4173", "--strictPort");
}

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
  },
});

child.on("exit", (code) => process.exit(code ?? 1));
