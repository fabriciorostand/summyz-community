import asyncio
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import server
from execution_policy import AccelerationUnavailableError
from fastapi import HTTPException, UploadFile
from pydantic import ValidationError


async def immediate(function: object, *args: object) -> object:
    return function(*args)  # type: ignore[operator]


class FakeTranscriber:
    def __init__(self, segments: list[object], info: object | None = None) -> None:
        self.segments = segments
        self.info = info or SimpleNamespace(language="en", language_probability=1.0)
        self.calls: list[tuple[object, dict[str, object]]] = []

    def transcribe(self, audio: object, **kwargs: object) -> tuple[list[object], object]:
        self.calls.append((audio, kwargs))
        return self.segments, self.info


def runtime(transcriber: object | None = None) -> server.LoadedRuntime:
    return server.LoadedRuntime(
        batch_size=0,
        compute_type="int8",
        device="cpu",
        fallback_applied=False,
        model=SimpleNamespace(model=SimpleNamespace(is_multilingual=True)),
        multilingual=True,
        transcriber=transcriber or FakeTranscriber([]),
    )


class TestModels:
    def test_validates_revision_and_vad_ranges(self) -> None:
        request = server.ModelRequest(
            model="tiny",
            revision="d90ca5fe260221311c53c58e660288d3deb8d356",
        )
        assert request.revision is not None
        with pytest.raises(ValidationError):
            server.ModelRequest(model="tiny", revision="main")
        for field, value in (
            ("maxSpeechDurationSeconds", -1.0),
            ("minSilenceDurationMs", 10_001),
            ("negativeSpeechThreshold", 1.1),
        ):
            with pytest.raises(ValidationError):
                server.VadOptionsRequest(**{field: value})

    def test_model_directory_is_stable_and_confined(
        self, tmp_path: Path, monkeypatch: object
    ) -> None:
        monkeypatch.setattr(server, "MODEL_ROOT", tmp_path)  # type: ignore[attr-defined]
        first = server.model_directory("org/model@revision")
        second = server.model_directory("org/model@revision")
        assert first == second
        assert first.parent == tmp_path

    def test_create_runtime_selects_batching_and_compute_type(self, monkeypatch: object) -> None:
        model = SimpleNamespace(model=SimpleNamespace(is_multilingual=True))
        model_factory = Mock(return_value=model)
        pipeline = object()
        warm_up = Mock()
        monkeypatch.setattr(server, "WhisperModel", model_factory)  # type: ignore[attr-defined]
        monkeypatch.setattr(server, "BatchedInferencePipeline", Mock(return_value=pipeline))  # type: ignore[attr-defined]
        monkeypatch.setattr(server, "warm_up", warm_up)  # type: ignore[attr-defined]

        batched = server.create_runtime(Path("/model"), "cuda", 4)
        direct = server.create_runtime(Path("/model"), "cpu", 0)

        assert batched.compute_type == "float16"
        assert batched.transcriber is pipeline
        assert direct.compute_type == "int8"
        assert direct.transcriber is model
        assert warm_up.call_count == 2

    def test_warm_up_consumes_lazy_segments(self) -> None:
        consumed: list[str] = []

        def segments() -> object:
            consumed.append("started")
            yield object()

        transcriber = FakeTranscriber(segments())  # type: ignore[arg-type]
        server.warm_up(transcriber, 2)
        assert consumed == ["started"]
        assert transcriber.calls[0][1]["batch_size"] == 2

    def test_load_model_uses_installed_revision_without_downloading(
        self, tmp_path: Path, monkeypatch: object
    ) -> None:
        revision = "d90ca5fe260221311c53c58e660288d3deb8d356"
        created = runtime()
        monkeypatch.setattr(server, "MODEL_ROOT", tmp_path)  # type: ignore[attr-defined]
        directory = server.model_directory(f"tiny@{revision}")
        directory.mkdir()
        for name in ("model.bin", "config.json", "tokenizer.json"):
            (directory / name).write_bytes(b"installed")
        monkeypatch.setattr(server, "create_runtime", Mock(return_value=created))  # type: ignore[attr-defined]
        monkeypatch.setattr(server.ctranslate2, "get_cuda_device_count", Mock(return_value=0))
        server.unload_model()

        first = server.load_model("tiny", revision, "cpu", "none", 0)
        second = server.load_model("tiny", revision, "cpu", "none", 0)

        assert first is second

    def test_missing_model_is_rejected_without_creating_files(self, tmp_path, monkeypatch):
        monkeypatch.setattr(server, "MODEL_ROOT", tmp_path)
        server.unload_model()
        with pytest.raises(FileNotFoundError):
            server.load_model("tiny", None, "cpu", "none", 0)
        assert list(tmp_path.iterdir()) == []

    def test_remove_model_unloads_matching_revision(
        self, tmp_path: Path, monkeypatch: object
    ) -> None:
        monkeypatch.setattr(server, "MODEL_ROOT", tmp_path)  # type: ignore[attr-defined]
        revision = "d90ca5fe260221311c53c58e660288d3deb8d356"
        directory = server.model_directory(f"tiny@{revision}")
        directory.mkdir()
        server.loaded_key = ("tiny", revision, "cpu", "none", 0)
        server.loaded_runtime = runtime()

        server.remove_model("tiny", revision)

        assert not directory.exists()
        assert server.loaded_runtime is None

    def test_transcribe_audio_assembles_text_and_words(self) -> None:
        transcriber = FakeTranscriber(
            [
                SimpleNamespace(
                    text=" Hello ",
                    words=[SimpleNamespace(start=0.0, end=0.5, word=" Hello ")],
                ),
                SimpleNamespace(text=" ", words=None),
            ]
        )
        loaded = runtime(transcriber)

        texts, words, info = server.transcribe_audio(
            loaded,
            Path("audio.wav"),
            "auto",
            None,
            server.VadOptionsRequest().model_dump(),
        )

        assert texts == ["Hello", ""]
        assert words == [{"end": 0.5, "start": 0.0, "word": "Hello"}]
        assert info.language == "en"


class TestEndpoints:
    def setup_method(self) -> None:
        server.unload_model()

    def test_health_and_hardware(self, monkeypatch: object) -> None:
        assert asyncio.run(server.health()) == {"loaded": False, "status": "ok"}
        server.loaded_runtime = runtime()
        assert asyncio.run(server.health()) == {"device": "cpu", "loaded": True, "status": "ok"}
        monkeypatch.setattr(server.os, "cpu_count", Mock(return_value=None))
        monkeypatch.setattr(server.ctranslate2, "get_cuda_device_count", Mock(return_value=2))
        assert asyncio.run(server.hardware()) == {"cpuCores": 1, "cudaDevices": 2}

    def test_prepare_and_delete_model(self, monkeypatch: object) -> None:
        loaded = runtime()
        remove = Mock()
        monkeypatch.setattr(server, "run_in_threadpool", immediate)  # type: ignore[attr-defined]
        monkeypatch.setattr(server, "load_model", Mock(return_value=loaded))  # type: ignore[attr-defined]
        monkeypatch.setattr(server, "remove_model", remove)  # type: ignore[attr-defined]
        request = server.ModelRequest(model="tiny")

        result = asyncio.run(server.prepare_model(request))
        deleted = asyncio.run(server.delete_model(request))

        assert result.status == "ready"
        assert result.device == "cpu"
        assert deleted == {"status": "deleted"}
        remove.assert_called_once_with("tiny", None)

    @pytest.mark.parametrize(
        "status",
        [
            {"status": "cancelling"},
            {"status": "cancelled", "completedBytes": 0, "totalBytes": None},
        ],
    )
    def test_cancel_returns_the_download_status(
        self, monkeypatch: pytest.MonkeyPatch, status: dict[str, object]
    ) -> None:
        cancel = Mock(return_value=status)
        monkeypatch.setattr(server, "run_in_threadpool", immediate)
        monkeypatch.setattr(server.downloads, "cancel", cancel)
        request = server.ModelRequest(model="tiny", revision="a" * 40)
        assert asyncio.run(server.cancel_model_download(request)) == status
        cancel.assert_called_once_with("tiny", "a" * 40)

    def test_prepare_maps_acceleration_and_generic_failures(self, monkeypatch: object) -> None:
        monkeypatch.setattr(server, "run_in_threadpool", immediate)  # type: ignore[attr-defined]
        request = server.ModelRequest(model="tiny")
        monkeypatch.setattr(
            server,
            "load_model",
            Mock(side_effect=AccelerationUnavailableError("missing")),
        )
        with pytest.raises(HTTPException) as unavailable:
            asyncio.run(server.prepare_model(request))
        assert unavailable.value.status_code == 409

        monkeypatch.setattr(server, "load_model", Mock(side_effect=RuntimeError("broken")))
        monkeypatch.setattr(server, "remove_model", Mock())
        with pytest.raises(HTTPException) as invalid:
            asyncio.run(server.prepare_model(request))
        assert invalid.value.status_code == 422

    def test_transcribe_rejects_format_and_invalid_vad(self) -> None:
        unsupported = UploadFile(BytesIO(b"data"), filename="audio.mp3")
        with pytest.raises(HTTPException) as format_error:
            asyncio.run(server.transcribe(unsupported, "tiny"))
        assert format_error.value.status_code == 415

        invalid = UploadFile(BytesIO(b"data"), filename="audio.wav")
        with pytest.raises(HTTPException) as vad_error:
            asyncio.run(server.transcribe(invalid, "tiny", vad_options_json="invalid"))
        assert vad_error.value.status_code == 422
        assert invalid.file.closed

    def test_transcribe_writes_a_temporary_file_and_returns_result(
        self, tmp_path: Path, monkeypatch: object
    ) -> None:
        loaded = runtime()
        info = SimpleNamespace(language="pt", language_probability=0.9)
        monkeypatch.setattr(server, "TEMP_ROOT", tmp_path)  # type: ignore[attr-defined]
        monkeypatch.setattr(server, "run_in_threadpool", immediate)  # type: ignore[attr-defined]
        monkeypatch.setattr(server, "load_model", Mock(return_value=loaded))  # type: ignore[attr-defined]
        transcribe = Mock(return_value=(["Olá", "mundo"], [{"start": 0.0, "end": 1.0}], info))
        monkeypatch.setattr(server, "transcribe_audio", transcribe)  # type: ignore[attr-defined]
        upload = UploadFile(BytesIO(b"wave"), filename="audio.wav")

        result = asyncio.run(
            server.transcribe(
                upload,
                "tiny",
                revision="d90ca5fe260221311c53c58e660288d3deb8d356",
            )
        )

        assert result == {
            "language": "pt",
            "languageProbability": 0.9,
            "text": "Olá mundo",
            "words": [{"start": 0.0, "end": 1.0}],
        }
        assert upload.file.closed
        assert list(tmp_path.iterdir()) == []

    def test_transcribe_maps_runtime_failures(self, tmp_path: Path, monkeypatch: object) -> None:
        monkeypatch.setattr(server, "TEMP_ROOT", tmp_path)  # type: ignore[attr-defined]
        monkeypatch.setattr(server, "run_in_threadpool", immediate)  # type: ignore[attr-defined]
        monkeypatch.setattr(
            server,
            "load_model",
            Mock(side_effect=AccelerationUnavailableError("missing")),
        )
        with pytest.raises(HTTPException) as unavailable:
            asyncio.run(server.transcribe(UploadFile(BytesIO(b"x"), filename="a.wav"), "tiny"))
        assert unavailable.value.status_code == 409

        monkeypatch.setattr(server, "load_model", Mock(side_effect=RuntimeError("broken")))
        with pytest.raises(HTTPException) as failed:
            asyncio.run(server.transcribe(UploadFile(BytesIO(b"x"), filename="a.ogg"), "tiny"))
        assert failed.value.status_code == 503
