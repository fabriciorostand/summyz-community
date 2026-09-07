from __future__ import annotations

import json
import logging

SAFE_LOG_FIELDS = (
    "batch_size",
    "compute_type",
    "device",
    "error_type",
    "fallback_applied",
    "model",
    "word_count",
)


class StructuredLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, bool | float | int | None | str] = {
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
            "time": round(record.created * 1_000),
        }
        for field in SAFE_LOG_FIELDS:
            value = getattr(record, field, None)
            if isinstance(value, bool | float | int | str):
                payload[field] = value
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_structured_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredLogFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
