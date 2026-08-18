import { describe, expect, it } from "vitest";

import { createRecordingStopNotification } from "../src/recording/recording-notification.js";

describe("notificações terminais da gravação", () => {
  it("informa quem encerrou por comando", () => {
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "command", stoppedByUserId: "user-1" },
      ),
    ).toBe("⏹️ Gravação encerrada por <@user-1>. Os segmentos de áudio foram preservados.");
  });

  it("informa o canal quando todos os participantes saem", () => {
    expect(
      createRecordingStopNotification({ voiceChannelName: "Lobby" }, { reason: "channel_empty" }),
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
      ),
    ).toContain("de **Lobby \\*\\*teste\\*\\***");
  });

  it("usa uma mensagem compatível com manifestos antigos sem nome do canal", () => {
    expect(createRecordingStopNotification({}, { reason: "channel_empty" })).toBe(
      "⏹️ Todos os participantes saíram do canal de voz. A gravação foi encerrada automaticamente. " +
        "Os segmentos de áudio foram preservados e serão processados.",
    );
  });

  it("mantém o aviso de desligamento", () => {
    expect(
      createRecordingStopNotification({ voiceChannelName: "Lobby" }, { reason: "shutdown" }),
    ).toBe(
      "⚠️ O Summyz foi desligado durante a call. O áudio foi preservado e a retomada ocorrerá no próximo início.",
    );
  });

  it("não duplica o aviso após esgotar a reconexão", () => {
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "reconnect_exhausted" },
      ),
    ).toBeUndefined();
  });
});
