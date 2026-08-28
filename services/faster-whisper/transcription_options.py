from language import normalize_whisper_language


def create_transcription_options(
    language: str, batch_size: int, prompt: str | None
) -> dict[str, object]:
    options: dict[str, object] = {
        "language": normalize_whisper_language(language),
        "vad_filter": True,
        "word_timestamps": True,
    }
    if batch_size > 0:
        options["batch_size"] = batch_size
    if prompt is not None:
        options["initial_prompt"] = prompt
    return options
