import { describe, expect, it } from "vitest";

import { evaluateCoverageDomains } from "../scripts/ci/coverage-domains.js";

describe("CI domain coverage", () => {
  it("aggregates files in each domain and rejects a domain below 85%", () => {
    const result = evaluateCoverageDomains(
      {
        "/repo/src/recording/manifest.ts": { covered: 9, total: 10 },
        "/repo/src/recording/recovery.ts": { covered: 8, total: 10 },
      },
      [{ name: "recording", patterns: ["/src/recording/"] }],
      85,
    );

    expect(result).toEqual([
      { covered: 17, name: "recording", percentage: 85, passed: true, total: 20 },
    ]);
  });

  it("fails closed when a configured domain has no measured files", () => {
    expect(
      evaluateCoverageDomains(
        { "/repo/src/api/server.ts": { covered: 10, total: 10 } },
        [{ name: "missing", patterns: ["/src/recording/"] }],
        85,
      ),
    ).toEqual([{ covered: 0, name: "missing", percentage: 0, passed: false, total: 0 }]);
  });
});
