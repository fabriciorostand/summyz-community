import { describe, expect, it } from "vitest";

import {
  createRecordingStopNotification,
  getRecordingText,
} from "../src/recording/recording-notification.js";

describe("notificações terminais da gravação", () => {
  it("explains ownership transfer and preserved processing to participants", () => {
    expect(createRecordingStopNotification({}, { reason: "owner_changed" }, "pt-BR")).toMatch(
      /dono.*mudou.*preservad.*publicad/i,
    );
    expect(createRecordingStopNotification({}, { reason: "owner_changed" }, "en")).toMatch(
      /owner changed.*preserved.*published/i,
    );
  });
  it("describes publication after recovery and deleted voice channels", () => {
    expect(getRecordingText("pt-BR").recoveryExpired).toMatch(/processamento/i);
    expect(getRecordingText("en").voiceChannelDeleted).toMatch(/configured forum/i);
  });
  it("informa quem encerrou por comando", () => {
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "command", stoppedByUserId: "user-1" },
        "pt-BR",
      ),
    ).toBe("Gravação encerrada por <@user-1>");
  });

  it("informa o canal quando todos os participantes saem", () => {
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "channel_empty" },
        "pt-BR",
      ),
    ).toBe(
      "Todos os participantes saíram de **Lobby**. A gravação foi encerrada automaticamente. " +
        "O áudio foi preservado e será processado",
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

  it("usa uma mensagem genérica quando o nome do canal não está disponível", () => {
    expect(createRecordingStopNotification({}, { reason: "channel_empty" }, "pt-BR")).toBe(
      "Todos os participantes saíram do canal de voz. A gravação foi encerrada automaticamente. " +
        "O áudio foi preservado e será processado.",
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
    ).toBe("Recording stopped by <@user-1>");
    expect(
      createRecordingStopNotification(
        { voiceChannelName: "Lobby" },
        { reason: "channel_empty" },
        "en",
      ),
    ).toBe(
      "All participants left **Lobby**. The recording was stopped automatically. " +
        "The audio was preserved and will be processed",
    );
    expect(createRecordingStopNotification({}, { reason: "channel_empty" }, "en")).toBe(
      "All participants left the voice channel. The recording was stopped automatically. " +
        "The audio was preserved and will be processed.",
    );
    expect(
      createRecordingStopNotification({ voiceChannelName: "Lobby" }, { reason: "shutdown" }, "en"),
    ).toContain("Summyz was shut down during the voice call");
  });

  it("expõe em inglês todos os avisos do ciclo de gravação", () => {
    const text = getRecordingText("en");

    expect(text.recoveryExpired).toContain("30 minutes");
    expect(text.voiceChannelDeleted).toContain("deleted");

    expect(text.startFailed).toContain("Unable to start recording");
    expect(text.emptyAfterRestart).toContain("empty when resumption was checked");
    expect(text.resumingAfterRestart).toContain("Trying to resume");
    expect(text.resumed).toContain("resumed automatically");
    expect(text.resumeFailed).toContain("Unable to resume");
    expect(text.connectionInterrupted).toContain("connection problem");
    expect(text.reconnectExhausted).toContain("Unable to resume");
    expect(Object.values(text).join(" ")).not.toMatch(/gravação|áudio|retomada/i);
  });
});
