from __future__ import annotations

import hashlib
import json
import logging
import shutil
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock, Thread

logger = logging.getLogger("summyz.model_downloads")
MAX_MODEL_BYTES = 32 * 1024**3
FILES = {
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.json",
    "vocabulary.txt",
}


def model_path(root: Path, model: str, revision: str | None = None) -> Path:
    digest = hashlib.sha256(f"{model}@{revision or 'default'}".encode()).hexdigest()
    return root / digest


def is_installed(directory: Path) -> bool:
    return all(
        (directory / name).is_file()
        and not (directory / name).is_symlink()
        and (directory / name).stat().st_size > 0
        for name in ("model.bin", "config.json", "tokenizer.json")
    )


def installed_models(root: Path) -> list[dict[str, object]]:
    result = []
    for directory in root.iterdir():
        metadata = directory / "summyz-model-inventory.json"
        if (
            directory.is_symlink()
            or directory.suffix == ".download"
            or not is_installed(directory)
            or not metadata.is_file()
        ):
            continue
        try:
            inventory = json.loads(metadata.read_text(encoding="utf-8"))
            model = inventory["model"]
            if (
                not isinstance(model, str)
                or len(model) > 200
                or directory != model_path(root, model)
            ):
                continue
            result.append(
                {
                    "model": model,
                    "size": sum(
                        file.stat().st_size for file in directory.iterdir() if file.is_file()
                    ),
                }
            )
        except (OSError, ValueError, KeyError, TypeError) as error:
            logger.warning("Model inventory is invalid", extra={"error_type": type(error).__name__})
    return result


def known_models() -> dict[str, str]:
    from faster_whisper.utils import _MODELS

    return {
        name: repository
        for name, repository in _MODELS.items()
        if not name.endswith(".en") and not name.startswith("distil-")
    }


def model_files(model: str, revision: str | None = None) -> tuple[str, str, list[tuple[str, int]]]:
    from huggingface_hub import model_info

    repository = known_models().get(model)
    if repository is None:
        raise ValueError("Unknown model")
    info = model_info(repository, revision=revision, files_metadata=True, token=False, timeout=10)
    files = [
        (file.rfilename, file.size)
        for file in (info.siblings or [])
        if file.rfilename in FILES and isinstance(file.size, int) and file.size > 0
    ]
    if not isinstance(info.sha, str) or sum(size for _, size in files) > MAX_MODEL_BYTES:
        raise ValueError("Invalid model metadata")
    if not {"model.bin", "config.json", "tokenizer.json"}.issubset({name for name, _ in files}):
        raise ValueError("Incomplete model metadata")
    return repository, info.sha, files


def catalog() -> list[dict[str, object]]:
    def describe(model: str) -> dict[str, object]:
        try:
            _, _, files = model_files(model)
            size = sum(size for _, size in files)
        except Exception as error:
            logger.warning(
                "Model size metadata unavailable",
                extra={"model": model, "error_type": type(error).__name__},
            )
            size = None
        return {"model": model, "name": model, "sizeBytes": size}

    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(describe, known_models()))


class DownloadCancelled(Exception):
    pass


def transfer_file(
    path: Path,
    url: str,
    size: int,
    cancelled: Callable[[], bool],
    progress: Callable[[int], None],
    request: Callable | None = None,
) -> None:
    if request is None:
        import requests

        request = requests.get
    partial = path.with_suffix(path.suffix + ".partial")
    if path.is_file() and path.stat().st_size == size:
        progress(size)
        return
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > size:
        partial.unlink()
        offset = 0
    if cancelled():
        raise DownloadCancelled()
    if offset != size:
        headers = {"Range": f"bytes={offset}-"} if offset else {}
        with request(url, headers=headers, stream=True, timeout=(10, 30)) as response:
            response.raise_for_status()
            if response.status_code == 200:
                offset = 0
            elif response.status_code != 206 or not response.headers.get(
                "Content-Range", ""
            ).startswith(f"bytes {offset}-"):
                raise ValueError("Invalid download range")
            with partial.open("ab" if offset else "wb") as output:
                progress(offset)
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if cancelled():
                        raise DownloadCancelled()
                    offset += len(chunk)
                    if offset > size:
                        raise ValueError("Model exceeds declared size")
                    output.write(chunk)
                    progress(offset)
    if offset != size:
        raise ValueError("Incomplete download")
    partial.replace(path)


class ModelDownloads:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.lock = Lock()
        self.jobs: dict[str, dict[str, object]] = {}
        self.events: dict[str, Event] = {}
        self.threads: dict[str, Thread] = {}

    def start(self, model: str, revision: str | None = None) -> dict[str, object]:
        key = f"{model}@{revision or 'default'}"
        if model not in known_models():
            raise ValueError("Unknown model")
        with self.lock:
            current = self.jobs.get(key)
            if current is not None and current["status"] == "downloading":
                return dict(current)
            if any(job["status"] == "downloading" for job in self.jobs.values()):
                raise ValueError("Another download is active")
            event = Event()
            self.events[key] = event
            self.jobs[key] = {"status": "downloading", "completedBytes": 0, "totalBytes": None}
            thread = Thread(target=self._download, args=(model, event, revision), daemon=True)
            self.threads[key] = thread
            thread.start()
            return dict(self.jobs[key])

    def status(self, model: str, revision: str | None = None) -> dict[str, object]:
        key = f"{model}@{revision or 'default'}"
        with self.lock:
            return dict(self.jobs.get(key, {"status": "unknown"}))

    def cancel(self, model: str, revision: str | None = None) -> dict[str, object]:
        key = f"{model}@{revision or 'default'}"
        with self.lock:
            event = self.events.get(key)
            thread = self.threads.get(key)
            if event is not None:
                event.set()
        if thread is not None:
            thread.join(timeout=45)
            if thread.is_alive():
                return {"status": "cancelling"}
        self._clean_staging(model, revision)
        with self.lock:
            self.jobs[key] = {"status": "cancelled", "completedBytes": 0, "totalBytes": None}
            return dict(self.jobs[key])

    def _clean_staging(self, model: str, revision: str | None = None) -> None:
        staging = model_path(self.root, model, revision).with_suffix(".download")
        if staging.parent != self.root or staging.is_symlink():
            raise ValueError("Invalid staging directory")
        if staging.exists():
            shutil.rmtree(staging)
            logger.info("Partial model files deleted", extra={"model": model})

    def _download(self, model: str, event: Event, revision: str | None = None) -> None:
        key = f"{model}@{revision or 'default'}"
        directory = model_path(self.root, model, revision)
        staging = directory.with_suffix(".download")
        try:
            repository, resolved_revision, files = model_files(model, revision)
            staging.mkdir(exist_ok=True)
            marker = staging / "revision"
            if marker.exists() and marker.read_text() != resolved_revision:
                self._clean_staging(model, revision)
                staging.mkdir()
            marker.write_text(resolved_revision)
            completed = 0
            total = sum(size for _, size in files)
            for name, size in files:

                def report(count: int, offset: int = completed) -> None:
                    with self.lock:
                        self.jobs[key] = {
                            "status": "downloading",
                            "completedBytes": offset + count,
                            "totalBytes": total,
                        }

                transfer_file(
                    staging / name,
                    f"https://huggingface.co/{repository}/resolve/{resolved_revision}/{name}",
                    size,
                    event.is_set,
                    report,
                )
                completed += size
            if event.is_set():
                raise DownloadCancelled()
            from model_inventory import create_model_inventory, write_model_inventory

            write_model_inventory(
                staging, create_model_inventory(model, requested_revision=resolved_revision)
            )
            if directory.exists():
                # An installed model is never overwritten by a download.
                if is_installed(directory):
                    self._clean_staging(model, revision)
                else:
                    raise ValueError("Incomplete legacy model requires removal")
            else:
                staging.rename(directory)
            with self.lock:
                self.jobs[key] = {
                    "status": "completed",
                    "completedBytes": total,
                    "totalBytes": total,
                }
            logger.info("Model download completed", extra={"model": model})
        except Exception as error:
            try:
                self._clean_staging(model, revision)
            except (OSError, ValueError) as cleanup_error:
                logger.warning(
                    "Partial cleanup requires retry",
                    extra={"error_type": type(cleanup_error).__name__},
                )
            with self.lock:
                self.jobs[key] = {
                    "status": "cancelled" if isinstance(error, DownloadCancelled) else "failed",
                    "completedBytes": 0,
                    "totalBytes": None,
                }
            logger.warning(
                "Model download stopped", extra={"model": model, "error_type": type(error).__name__}
            )
