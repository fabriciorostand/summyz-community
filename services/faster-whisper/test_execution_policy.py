import json
import logging
import unittest

from execution_policy import AccelerationUnavailableError, load_with_device_policy
from language import normalize_whisper_language
from structured_logging import StructuredLogFormatter


class ExecutionPolicyTests(unittest.TestCase):
    def test_cpu_never_attempts_cuda_and_ignores_fallback(self) -> None:
        attempts: list[str] = []

        result = load_with_device_policy(
            "cpu", "cpu", 1, lambda device: attempts.append(device) or device
        )

        self.assertEqual(("cpu", "cpu", False), result)
        self.assertEqual(["cpu"], attempts)

    def test_auto_without_cuda_uses_cpu_as_primary_path(self) -> None:
        result = load_with_device_policy("auto", "none", 0, lambda device: device)

        self.assertEqual(("cpu", "cpu", False), result)

    def test_auto_does_not_hide_cuda_failure_without_fallback(self) -> None:
        def load(device: str) -> str:
            if device == "cuda":
                raise RuntimeError("CUDA failed")
            return device

        with self.assertRaises(AccelerationUnavailableError):
            load_with_device_policy("auto", "none", 1, load)

    def test_explicit_fallback_uses_cpu_after_cuda_failure(self) -> None:
        attempts: list[str] = []

        def load(device: str) -> str:
            attempts.append(device)
            if device == "cuda":
                raise RuntimeError("CUDA failed")
            return device

        result = load_with_device_policy("gpu", "cpu", 1, load)

        self.assertEqual(("cpu", "cpu", True), result)
        self.assertEqual(["cuda", "cpu"], attempts)

    def test_gpu_without_cuda_fails_when_fallback_is_none(self) -> None:
        with self.assertRaises(AccelerationUnavailableError):
            load_with_device_policy("gpu", "none", 0, lambda device: device)


class LanguageTests(unittest.TestCase):
    def test_preserves_automatic_language_detection(self) -> None:
        self.assertIsNone(normalize_whisper_language("auto"))

    def test_converts_bcp47_locale_to_whisper_language(self) -> None:
        self.assertEqual("pt", normalize_whisper_language("pt-BR"))
        self.assertEqual("en", normalize_whisper_language("en-US"))

    def test_preserves_primary_language_codes(self) -> None:
        self.assertEqual("es", normalize_whisper_language("es"))
        self.assertEqual("yue", normalize_whisper_language("yue"))


class StructuredLoggingTests(unittest.TestCase):
    def test_serializes_diagnostic_fields_without_arbitrary_secrets(self) -> None:
        record = logging.LogRecord(
            "summyz.faster_whisper",
            logging.ERROR,
            __file__,
            1,
            "Audio transcription failed",
            (),
            None,
        )
        record.error_type = "ValueError"
        record.device = "cuda"
        record.authorization = "Bearer sensitive-token"

        payload = json.loads(StructuredLogFormatter().format(record))

        self.assertEqual("ValueError", payload["error_type"])
        self.assertEqual("cuda", payload["device"])
        self.assertNotIn("authorization", payload)
        self.assertNotIn("sensitive-token", json.dumps(payload))


if __name__ == "__main__":
    unittest.main()
