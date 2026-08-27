from collections.abc import Callable
from typing import Literal, TypeVar

DevicePreference = Literal["auto", "cpu", "gpu"]
FallbackPreference = Literal["cpu", "none"]
RuntimeDevice = Literal["cpu", "cuda"]
Runtime = TypeVar("Runtime")


class AccelerationUnavailableError(RuntimeError):
    pass


def load_with_device_policy(
    preference: DevicePreference,
    fallback: FallbackPreference,
    cuda_device_count: int,
    loader: Callable[[RuntimeDevice], Runtime],
) -> tuple[Runtime, RuntimeDevice, bool]:
    if preference == "cpu":
        return loader("cpu"), "cpu", False

    if cuda_device_count <= 0:
        if preference == "auto":
            return loader("cpu"), "cpu", False
        if fallback == "cpu":
            return loader("cpu"), "cpu", True
        raise AccelerationUnavailableError("A CUDA device is required but unavailable")

    try:
        return loader("cuda"), "cuda", False
    except Exception as error:
        if fallback == "cpu":
            return loader("cpu"), "cpu", True
        raise AccelerationUnavailableError("CUDA initialization or warm-up failed") from error
