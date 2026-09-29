import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadTextFile, meetingFileName } from "./download";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadTextFile", () => {
  it("hands the browser a named object URL and releases it", () => {
    const createObjectURL = vi.fn(() => "blob:summyz");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    downloadTextFile("reuniao.txt", "conteúdo");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:summyz");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("keeps the requested file name on the anchor", () => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: {
      download: string;
    }) {
      downloadName = this.download;
    });

    downloadTextFile("launch-week-sync.txt", "texto");

    expect(downloadName).toBe("launch-week-sync.txt");
  });
});

describe("meetingFileName", () => {
  it("slugifies the channel name", () => {
    expect(meetingFileName("#launch-week", "mtg_1", "reuniao")).toBe("launch-week.txt");
  });

  it("strips accents and collapses separators", () => {
    expect(meetingFileName("Arte — revisão de HUD", "mtg_1", "reuniao")).toBe(
      "arte-revisao-de-hud.txt",
    );
  });

  it("falls back to the meeting id when the channel name is unknown", () => {
    expect(meetingFileName(null, "mtg_01J7XQ", "reuniao")).toBe("mtg-01j7xq.txt");
  });

  it("falls back to the generic name of the dashboard language when nothing survives", () => {
    expect(meetingFileName("###", "mtg_1", "reuniao")).toBe("reuniao.txt");
    expect(meetingFileName("###", "mtg_1", "meeting")).toBe("meeting.txt");
  });
});
