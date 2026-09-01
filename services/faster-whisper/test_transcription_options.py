import unittest

from transcription_options import create_transcription_options


class TranscriptionOptionsTests(unittest.TestCase):
    def test_includes_the_configured_prompt(self) -> None:
        self.assertEqual(
            create_transcription_options(
                "pt-BR",
                4,
                "Transcreva literalmente.",
                {
                    "enabled": True,
                    "maxSpeechDurationSeconds": "auto",
                    "minSilenceDurationMs": "auto",
                    "minSpeechDurationMs": 0,
                    "negativeSpeechThreshold": "auto",
                    "speechPadMs": 400,
                    "threshold": 0.5,
                },
            ),
            {
                "batch_size": 4,
                "initial_prompt": "Transcreva literalmente.",
                "language": "pt",
                "multilingual": True,
                "task": "transcribe",
                "vad_filter": True,
                "vad_parameters": {
                    "max_speech_duration_s": 30,
                    "min_silence_duration_ms": 160,
                    "min_speech_duration_ms": 0,
                    "speech_pad_ms": 400,
                    "threshold": 0.5,
                },
                "word_timestamps": True,
            },
        )

    def test_omits_prompt_and_batch_size_when_disabled(self) -> None:
        options = create_transcription_options(
            "auto",
            0,
            None,
            {
                "enabled": False,
                "maxSpeechDurationSeconds": "auto",
                "minSilenceDurationMs": "auto",
                "minSpeechDurationMs": 0,
                "negativeSpeechThreshold": "auto",
                "speechPadMs": 400,
                "threshold": 0.5,
            },
        )

        self.assertNotIn("initial_prompt", options)
        self.assertNotIn("batch_size", options)
        self.assertIsNone(options["language"])
        self.assertFalse(options["vad_filter"])
        self.assertNotIn("vad_parameters", options)

    def test_maps_every_custom_vad_parameter(self) -> None:
        options = create_transcription_options(
            "en",
            0,
            None,
            {
                "enabled": True,
                "maxSpeechDurationSeconds": 45,
                "minSilenceDurationMs": 320,
                "minSpeechDurationMs": 64,
                "negativeSpeechThreshold": 0.25,
                "speechPadMs": 192,
                "threshold": 0.4,
            },
        )

        self.assertEqual(
            options["vad_parameters"],
            {
                "max_speech_duration_s": 45,
                "min_silence_duration_ms": 320,
                "min_speech_duration_ms": 64,
                "neg_threshold": 0.25,
                "speech_pad_ms": 192,
                "threshold": 0.4,
            },
        )


if __name__ == "__main__":
    unittest.main()
