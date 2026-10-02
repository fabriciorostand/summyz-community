import "./runtime-platform.js";
import { spawn } from "node:child_process";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

import { superviseBot } from "./bot-supervisor.js";

const extension = extname(fileURLToPath(import.meta.url));
if (extension !== ".ts" && extension !== ".js") {
  throw new Error("Unsupported bot supervisor entry point");
}
const botEntryPoint = fileURLToPath(new URL(`./bot-main${extension}`, import.meta.url));
process.exitCode = await superviseBot({
  startChild: () =>
    spawn(process.execPath, [...process.execArgv, botEntryPoint], {
      env: process.env,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      windowsHide: true,
    }),
});
