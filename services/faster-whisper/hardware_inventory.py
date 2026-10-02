from __future__ import annotations

import csv
import io
import subprocess


def read_hardware_inventory(cuda_devices: int) -> dict[str, object]:
    if type(cuda_devices) is not int or not 0 <= cuda_devices <= 128:
        raise ValueError("Invalid CUDA device count")
    if cuda_devices == 0:
        return {"cudaDevices": 0, "accelerators": []}
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=index,name,memory.total", "--format=csv,noheader,nounits"],
        capture_output=True,
        check=True,
        encoding="utf-8",
        timeout=3,
    )
    accelerators: list[dict[str, object]] = []
    identifiers: set[str] = set()
    for fields in csv.reader(io.StringIO(result.stdout)):
        identifier, accelerator = parse_gpu(fields)
        if identifier in identifiers:
            raise ValueError("Duplicate GPU identity")
        identifiers.add(identifier)
        accelerators.append(accelerator)
    if len(accelerators) != cuda_devices:
        raise ValueError("GPU inventory does not match CUDA visibility")
    return {"cudaDevices": cuda_devices, "accelerators": accelerators}


def parse_gpu(fields: list[str]) -> tuple[str, dict[str, object]]:
    if len(fields) != 3:
        raise ValueError("Invalid GPU inventory")
    index, name, memory = (field.strip() for field in fields)
    if not index.isascii() or not index.isdecimal() or not 0 <= int(index) < 128:
        raise ValueError("Invalid GPU index")
    if not 1 <= len(name) <= 256:
        raise ValueError("Invalid GPU identity")
    if not memory.isascii() or not memory.isdecimal():
        raise ValueError("Invalid GPU memory")
    memory_bytes = int(memory) * 1024**2
    if not 0 < memory_bytes <= 2**53 - 1:
        raise ValueError("Invalid GPU memory")
    identifier = f"nvidia-{int(index)}"
    return identifier, {
        "id": identifier,
        "name": name,
        "vendor": "nvidia",
        "memoryBytes": memory_bytes,
    }
