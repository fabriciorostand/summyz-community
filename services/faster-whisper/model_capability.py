from __future__ import annotations

from typing import Protocol


class CheckpointCapability(Protocol):
    is_multilingual: object


class UnknownModelCapabilityError(RuntimeError):
    pass


def require_multilingual_capability(checkpoint: object) -> bool:
    capability = getattr(checkpoint, "is_multilingual", None)
    if not isinstance(capability, bool):
        raise UnknownModelCapabilityError(
            "The loaded checkpoint did not report a reliable multilingual capability"
        )
    return capability
