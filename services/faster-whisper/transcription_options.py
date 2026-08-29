from language import normalize_whisper_language


def create_transcription_options(
    language: str,
    batch_size: int,
    prompt: str | None,
    vad_options: dict[str, object],
) -> dict[str, object]:
    vad_enabled = vad_options["enabled"] is True
    options: dict[str, object] = {
        "language": normalize_whisper_language(language),
        "vad_filter": vad_enabled,
        "word_timestamps": True,
    }
    if batch_size > 0:
        options["batch_size"] = batch_size
    if prompt is not None:
        options["initial_prompt"] = prompt
    if vad_enabled:
        parameters: dict[str, object] = {
            "min_speech_duration_ms": vad_options["minSpeechDurationMs"],
            "speech_pad_ms": vad_options["speechPadMs"],
            "threshold": vad_options["threshold"],
        }
        negative_threshold = vad_options["negativeSpeechThreshold"]
        if negative_threshold != "auto":
            parameters["neg_threshold"] = negative_threshold
        minimum_silence = vad_options["minSilenceDurationMs"]
        parameters["min_silence_duration_ms"] = (
            160 if batch_size > 0 else 2_000
        ) if minimum_silence == "auto" else minimum_silence
        maximum_speech = vad_options["maxSpeechDurationSeconds"]
        if maximum_speech != "auto":
            parameters["max_speech_duration_s"] = maximum_speech
        elif batch_size > 0:
            parameters["max_speech_duration_s"] = 30
        options["vad_parameters"] = parameters
    return options
