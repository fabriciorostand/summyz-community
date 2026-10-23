import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { createNodeTestConfig } from "../../vitest.node.config.js";

export default defineConfig(
  createNodeTestConfig("bot", fileURLToPath(new URL(".", import.meta.url))),
);
