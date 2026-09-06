import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import quote

def _safe_metadata(value: object) -> str | None:
    if isinstance(value, str) and 0 < len(value) <= 200:
        return value
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        joined = ", ".join(value)
        return joined if len(joined) <= 200 else None
    return None


def create_model_inventory(
    model: str,
    get_model_info: Callable[[str], object] | None = None,
) -> dict[str, object]:
    repository = model
    if "/" not in model:
        from faster_whisper.utils import _MODELS

        repository = _MODELS.get(model, model)
    if get_model_info is None:
        from huggingface_hub import model_info

        get_model_info = model_info
    inventory: dict[str, object] = {
        "license": None,
        "model": model,
        "origin": f"https://huggingface.co/{quote(repository, safe='/')}",
        "provider": "huggingface",
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "repository": repository,
        "revision": None,
    }
    try:
        metadata = get_model_info(repository)
        inventory["revision"] = _safe_metadata(getattr(metadata, "sha", None))
        card_data = getattr(metadata, "card_data", None)
        inventory["license"] = _safe_metadata(getattr(card_data, "license", None))
    except Exception:
        # Metadata is evidence, not an allowlist. Offline and private models remain usable.
        pass
    return inventory


def write_model_inventory(directory: Path, inventory: dict[str, object]) -> None:
    target = directory / "summyz-model-inventory.json"
    temporary = directory / ".summyz-model-inventory.tmp"
    temporary.write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(target)
