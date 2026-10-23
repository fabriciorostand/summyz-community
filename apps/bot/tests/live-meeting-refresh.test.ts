import { describe, expect, it } from "vitest";

import { LIVE_STATE_REFRESH_INTERVAL_MS } from "../src/recording/live-meeting-policy.js";

describe("live meeting refresh", () => {
  it("refreshes speaking state within the approved dashboard interval", () => {
    expect(LIVE_STATE_REFRESH_INTERVAL_MS).toBe(2_000);
  });
});
