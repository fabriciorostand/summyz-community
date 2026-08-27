import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { z } from "zod";

import { selectComposeAcceleration } from "../src/local-ai/compose-acceleration.js";
import { detectLocalHardware } from "../src/local-ai/hardware-detection.js";
import type { LocalAiPhase } from "../src/local-ai/local-execution-policy.js";

const startupSchema = z.object({
  LOCAL_AI_DEVICE: z.enum(["auto", "gpu", "cpu"]).default("auto"),
  LOCAL_AI_FALLBACK: z.enum(["none", "cpu"]).default("none"),
});

if (existsSync(".env")) loadEnvFile(".env");

const composeCommand = process.argv.slice(2);
if (composeCommand.length === 0) {
  console.error("A Docker Compose command is required");
  process.exit(1);
}

const parsed = startupSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("The local AI device settings in .env are invalid");
  process.exit(1);
}

const isStopping = composeCommand[0] === "down";
const hardware = await detectLocalHardware();
const detectedVendors = new Set(
  (hardware.accelerators ?? []).map((accelerator) => accelerator.vendor),
);
const phases: LocalAiPhase[] = detectedVendors.has("nvidia")
  ? ["refinement", "summary", "transcription"]
  : detectedVendors.has("amd")
    ? ["refinement", "summary"]
    : [];
let selection: ReturnType<typeof selectComposeAcceleration>;
try {
  selection = isStopping
    ? { environment: {}, overlays: [] }
    : selectComposeAcceleration({
        device: parsed.data.LOCAL_AI_DEVICE,
        fallback: parsed.data.LOCAL_AI_DEVICE === "cpu" ? "none" : parsed.data.LOCAL_AI_FALLBACK,
        hardware,
        phases,
        platform: process.platform,
      });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to select GPU acceleration");
  process.exit(1);
}

const detectedVendorNames = [...detectedVendors];
console.info(
  JSON.stringify({
    event: "local_ai_compose_profile_selected",
    gpuVendors: detectedVendorNames,
    overlays: selection.overlays,
  }),
);
if (
  !isStopping &&
  parsed.data.LOCAL_AI_DEVICE !== "cpu" &&
  detectedVendorNames.length > 0 &&
  selection.overlays.length === 0
) {
  console.warn(
    JSON.stringify({
      event: "local_ai_cpu_fallback_applied",
      reason: "No compatible Compose GPU profile is available on this platform",
    }),
  );
}

const composeFiles = ["docker-compose.yaml", ...selection.overlays].flatMap((file) => ["-f", file]);
const child = spawn("docker", ["compose", ...composeFiles, ...composeCommand], {
  env: { ...process.env, ...selection.environment },
  stdio: "inherit",
  windowsHide: true,
});
child.once("error", (error) => {
  console.error(`Unable to start Docker Compose: ${error.name}`);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
