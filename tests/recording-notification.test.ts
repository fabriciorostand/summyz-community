import { describe, expect, it } from "vitest";

import {
  createRecordingStopNotification,
  getRecordingText,
} from "../src/recording/recording-notification.js";

describe("notificações terminais da gravação", () => {
  it("informa quem encerrou por comando", () => {
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "command", stoppedByUserId: "user-1" },
        "pt-BR",
      ),
    ).toBe("⏹️ Gravação encerrada por <@user-1>. Os segmentos de áudio foram preservados.");
  });

  it("informa o canal quando todos os participantes saem", () => {
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "channel_empty" },
        "pt-BR",
      ),
    ).toBe(
      "⏹️ Todos os participantes saíram de **Lobby**. A gravação foi encerrada automaticamente. " +
        "Os segmentos de áudio foram preservados e serão processados.",
    );
  });

  it("protege a formatação do nome do canal", () => {
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby **teste**" },
        { reason: "channel_empty" },
        "pt-BR",
      ),
    ).toContain("de **Lobby \\*\\*teste\\*\\***");
  });

  it("usa uma mensagem compatível com manifestos antigos sem nome do canal", () => {
    expect(createRecordingStopNotification({}, { reason: "channel_empty" }, "pt-BR")).toBe(
      "⏹️ Todos os participantes saíram do canal de voz. A gravação foi encerrada automaticamente. " +
        "Os segmentos de áudio foram preservados e serão processados.",
    );
  });

  it("mantém o aviso de desligamento", () => {
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "shutdown" },
        "pt-BR",
      ),
    ).toBe(
      "⚠️ O Summyz foi desligado durante a call. O áudio foi preservado e a retomada ocorrerá no próximo início.",
    );
  });

  it("não duplica o aviso após esgotar a reconexão", () => {
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "reconnect_exhausted" },
        "pt-BR",
      ),
    ).toBeUndefined();
  });

  it("gera todas as notificações terminais em inglês", () => {
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "command", stoppedByUserId: "user-1" },
        "en",
      ),
    ).toBe("⏹️ Recording stopped by <@user-1>. The audio segments were preserved.");
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "channel_empty" },
        "en",
      ),
    ).toContain("All participants left **Lobby**");
    expect(
      createRecordingStopNotification({ voiceChannelName: "Lobby" }, { reason: "shutdown" }, "en"),
    ).toContain("Summyz was shut down during the voice call");
  });

  it("expõe em inglês todos os avisos do ciclo de gravação", () => {
    const text = getRecordingText("en");

    expect(text.startFailed).toContain("Unable to start recording");
    expect(text.emptyAfterRestart).toContain("empty after the restart");
    expect(text.resumingAfterRestart).toContain("Trying to resume");
    expect(text.resumed).toContain("resumed automatically");
    expect(text.resumeFailed).toContain("Unable to resume");
    expect(text.connectionInterrupted).toContain("connection problem");
    expect(text.reconnectExhausted).toContain("Unable to resume");
    expect(Object.values(text).join(" ")).not.toMatch(/gravação|áudio|retomada/i);
  });
});
