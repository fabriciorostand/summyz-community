import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { createNodeTestConfig } from "../../scripts/test/node-project.js";

export default defineConfig(
  createNodeTestConfig("shared", fileURLToPath(new URL(".", import.meta.url))),
);
