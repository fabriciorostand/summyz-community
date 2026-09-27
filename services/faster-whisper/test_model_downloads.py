import tempfile
import unittest
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch

import model_downloads
from model_downloads import (
    DownloadCancelled,
    ModelDownloads,
    installed_models,
    model_path,
    transfer_file,
)


class Response:
    status_code = 206
    headers = {"Content-Range": "bytes 3-5/6"}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        yield b"def"


class ModelDownloadsTests(unittest.TestCase):
    def test_explicit_download_completes_inventory_and_preserves_existing_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            downloads = ModelDownloads(root)

            def transfer(path, url, size, cancelled, progress):
                path.write_bytes(b"abc")
                progress(3)

            files = [(name, 3) for name in ("model.bin", "config.json", "tokenizer.json")]
            with (
                patch.object(
                    model_downloads, "model_files", return_value=("repo/model", "a" * 40, files)
                ),
                patch.object(model_downloads, "transfer_file", side_effect=transfer),
                patch("model_inventory.create_model_inventory", return_value={"model": "tiny"}),
            ):
                downloads._download("tiny", Event())
                self.assertEqual(downloads.status("tiny")["status"], "completed")
                self.assertEqual(installed_models(root)[0]["model"], "tiny")
                downloads._download("tiny", Event())
                self.assertEqual((model_path(root, "tiny") / "model.bin").read_bytes(), b"abc")
                downloads.cancel("tiny")
                self.assertTrue((model_path(root, "tiny") / "model.bin").exists())

    def test_failure_and_cancellation_remove_staging_without_installing(self):
        for error in (RuntimeError("Authorization: secret"), DownloadCancelled()):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                staging = model_path(root, "tiny").with_suffix(".download")
                staging.mkdir()
                (staging / "model.bin.partial").write_bytes(b"partial")
                downloads = ModelDownloads(root)
                with patch.object(model_downloads, "model_files", side_effect=error):
                    downloads._download("tiny", Event())
                self.assertFalse(staging.exists())
                self.assertNotIn("secret", str(downloads.status("tiny")))
                self.assertEqual(installed_models(root), [])

    def test_start_is_idempotent_and_limits_concurrency(self):
        with tempfile.TemporaryDirectory() as temporary:
            downloads = ModelDownloads(Path(temporary))
            with (
                patch.object(
                    model_downloads,
                    "known_models",
                    return_value={"tiny": "repo/tiny", "small": "repo/small"},
                ),
                patch.object(downloads, "_download"),
            ):
                self.assertEqual(downloads.start("tiny")["status"], "downloading")
                self.assertEqual(downloads.start("tiny")["status"], "downloading")
                with self.assertRaises(ValueError):
                    downloads.start("small")
                with self.assertRaises(ValueError):
                    downloads.start("../../invalid")
                self.assertEqual(downloads.cancel("tiny")["status"], "cancelled")
                self.assertEqual(downloads.status("unknown")["status"], "unknown")

    def test_metadata_only_uses_known_multilingual_models_and_required_files(self):
        self.assertNotIn("tiny.en", model_downloads.known_models())
        with (
            patch.object(model_downloads, "known_models", return_value={"tiny": "repo/tiny"}),
            patch("huggingface_hub.model_info") as info,
        ):
            info.return_value = SimpleNamespace(
                sha="a" * 40,
                siblings=[
                    SimpleNamespace(rfilename=name, size=3)
                    for name in ("model.bin", "config.json", "tokenizer.json", "../secret")
                ],
            )
            self.assertEqual(len(model_downloads.model_files("tiny")[2]), 3)
            self.assertEqual(model_downloads.catalog()[0]["sizeBytes"], 9)
            info.return_value = SimpleNamespace(sha="a" * 40, siblings=[])
            with self.assertRaises(ValueError):
                model_downloads.model_files("tiny")
            self.assertIsNone(model_downloads.catalog()[0]["sizeBytes"])
            with self.assertRaises(ValueError):
                model_downloads.model_files("unknown")

    def test_invalid_inventory_is_not_reported_as_installed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = model_path(root, "tiny")
            directory.mkdir()
            for name in ("model.bin", "config.json", "tokenizer.json"):
                (directory / name).write_bytes(b"abc")
            metadata = directory / "summyz-model-inventory.json"
            metadata.write_text("invalid")
            self.assertEqual(installed_models(root), [])
            metadata.write_text('{"model": 12}')
            self.assertEqual(installed_models(root), [])

    def test_transfer_restarts_when_range_is_ignored_and_rejects_bad_sizes(self):
        class FullResponse(Response):
            status_code = 200

        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "model.bin"
            partial = path.with_suffix(".bin.partial")
            partial.write_bytes(b"ol")
            transfer_file(
                path,
                "url",
                3,
                lambda: False,
                lambda _: None,
                lambda *args, **kwargs: FullResponse(),
            )
            self.assertEqual(path.read_bytes(), b"def")
            transfer_file(
                path,
                "url",
                3,
                lambda: False,
                lambda _: None,
                lambda *args, **kwargs: self.fail("No request expected"),
            )
            path.unlink()
            for size in (1, 9):
                partial.unlink(missing_ok=True)
                with self.assertRaises(ValueError):
                    transfer_file(
                        path,
                        "url",
                        size,
                        lambda: False,
                        lambda _: None,
                        lambda *args, **kwargs: FullResponse(),
                    )
            with self.assertRaises(DownloadCancelled):
                transfer_file(path, "url", 3, lambda: True, lambda _: None)

    def test_resume_uses_range_and_finishes_exact_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "model.bin"
            path.with_suffix(".bin.partial").write_bytes(b"abc")
            calls = []

            def request(url, **kwargs):
                calls.append(kwargs)
                return Response()

            transfer_file(
                path, "https://huggingface.co/file", 6, lambda: False, lambda _: None, request
            )
            self.assertEqual(path.read_bytes(), b"abcdef")
            self.assertEqual(calls[0]["headers"], {"Range": "bytes=3-"})

    def test_partial_files_are_not_installed_and_paths_are_hashed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.assertEqual(model_path(root, "../../outside").parent, root)
            directory = model_path(root, "small")
            directory.mkdir()
            (directory / "model.bin.partial").write_bytes(b"audio")
            self.assertEqual(installed_models(root), [])

    def test_staging_and_pinned_revisions_are_not_default_installed_models(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for directory in (
                model_path(root, "tiny").with_suffix(".download"),
                model_path(root, "tiny", "revision"),
            ):
                directory.mkdir()
                for name in ("model.bin", "config.json", "tokenizer.json"):
                    (directory / name).write_bytes(b"abc")
                (directory / "summyz-model-inventory.json").write_text('{"model":"tiny"}')
            self.assertEqual(installed_models(root), [])
