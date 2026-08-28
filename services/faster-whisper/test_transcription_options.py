import unittest

from transcription_options import create_transcription_options


class TranscriptionOptionsTests(unittest.TestCase):
    def test_includes_the_configured_prompt(self) -> None:
        self.assertEqual(
            create_transcription_options("pt-BR", 4, "Transcreva literalmente."),
            {
                "batch_size": 4,
                "initial_prompt": "Transcreva literalmente.",
                "language": "pt",
                "vad_filter": True,
                "word_timestamps": True,
            },
        )

    def test_omits_prompt_and_batch_size_when_disabled(self) -> None:
        options = create_transcription_options("auto", 0, None)

        self.assertNotIn("initial_prompt", options)
        self.assertNotIn("batch_size", options)
        self.assertIsNone(options["language"])


if __name__ == "__main__":
    unittest.main()
