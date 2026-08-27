from __future__ import annotations


def normalize_whisper_language(language: str) -> str | None:
    if language == "auto":
        return None
    primary_language, _, _ = language.partition("-")
    return primary_language.lower()
