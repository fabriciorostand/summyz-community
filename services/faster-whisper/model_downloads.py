from __future__ import annotations

import hashlib
import json
import logging
import shutil
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock, Thread

from huggingface_hub.hf_api import RepoSibling

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
        inventory = read_installed_model(root, directory)
        if inventory is not None:
            result.append(inventory)
    return result


def read_installed_model(root: Path, directory: Path) -> dict[str, object] | None:
    metadata = directory / "summyz-model-inventory.json"
    if (
        directory.is_symlink()
        or directory.suffix == ".download"
        or not is_installed(directory)
        or not metadata.is_file()
    ):
        return None
    try:
        inventory = json.loads(metadata.read_text(encoding="utf-8"))
        model = inventory["model"]
        if not isinstance(model, str) or len(model) > 200 or directory != model_path(root, model):
            return None
        return {"model": model, "size": directory_file_size(directory)}
    except (OSError, ValueError, KeyError, TypeError) as error:
        logger.warning("Model inventory is invalid", extra={"error_type": type(error).__name__})
        return None


def directory_file_size(directory: Path) -> int:
    return sum(file.stat().st_size for file in directory.iterdir() if file.is_file())


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
    files = select_model_files(info.siblings or [])
    if not isinstance(info.sha, str) or sum(size for _, size in files) > MAX_MODEL_BYTES:
        raise ValueError("Invalid model metadata")
    if not {"model.bin", "config.json", "tokenizer.json"}.issubset({name for name, _ in files}):
        raise ValueError("Incomplete model metadata")
    return repository, info.sha, files


def select_model_files(siblings: Iterable[RepoSibling]) -> list[tuple[str, int]]:
    return [
        (file.rfilename, file.size)
        for file in siblings
        if file.rfilename in FILES and isinstance(file.size, int) and file.size > 0
    ]


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
    offset = partial_offset(partial, size)
    if cancelled():
        raise DownloadCancelled()
    if offset != size:
        headers = {"Range": f"bytes={offset}-"} if offset else {}
        with request(url, headers=headers, stream=True, timeout=(10, 30)) as response:
            response.raise_for_status()
            offset = response_offset(
                response.status_code, response.headers.get("Content-Range", ""), offset
            )
            offset = write_download_chunks(
                partial,
                response.iter_content(chunk_size=1024 * 1024),
                offset,
                size,
                cancelled,
                progress,
            )
    if offset != size:
        raise ValueError("Incomplete download")
    partial.replace(path)


def partial_offset(partial: Path, size: int) -> int:
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > size:
        partial.unlink()
        return 0
    return offset


def response_offset(status_code: int, content_range: str, offset: int) -> int:
    if status_code == 200:
        return 0
    if status_code != 206 or not content_range.startswith(f"bytes {offset}-"):
        raise ValueError("Invalid download range")
    return offset


def write_download_chunks(
    partial: Path,
    chunks: Iterable[bytes],
    offset: int,
    size: int,
    cancelled: Callable[[], bool],
    progress: Callable[[int], None],
) -> int:
    with partial.open("ab" if offset else "wb") as output:
        progress(offset)
        for chunk in chunks:
            if cancelled():
                raise DownloadCancelled()
            offset += len(chunk)
            if offset > size:
                raise ValueError("Model exceeds declared size")
            output.write(chunk)
            progress(offset)
    return offset


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
            self._install_staged_model(model, revision, resolved_revision)
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

    def _install_staged_model(
        self, model: str, revision: str | None, resolved_revision: str
    ) -> None:
        from model_inventory import create_model_inventory, write_model_inventory

        directory = model_path(self.root, model, revision)
        staging = directory.with_suffix(".download")
        write_model_inventory(
            staging, create_model_inventory(model, requested_revision=resolved_revision)
        )
        if not directory.exists():
            staging.rename(directory)
            return
        # An installed model is never overwritten by a download.
        if not is_installed(directory):
            raise ValueError("Incomplete legacy model requires removal")
        self._clean_staging(model, revision)
