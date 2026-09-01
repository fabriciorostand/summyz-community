import unittest

from model_capability import UnknownModelCapabilityError, require_multilingual_capability


class FakeCheckpoint:
    pass


class ModelCapabilityTests(unittest.TestCase):
    def test_accepts_real_boolean_capability(self) -> None:
        checkpoint = FakeCheckpoint()
        checkpoint.is_multilingual = True
        self.assertTrue(require_multilingual_capability(checkpoint))

        checkpoint.is_multilingual = False
        self.assertFalse(require_multilingual_capability(checkpoint))

    def test_blocks_when_checkpoint_does_not_report_capability(self) -> None:
        with self.assertRaises(UnknownModelCapabilityError):
            require_multilingual_capability(FakeCheckpoint())

    def test_rejects_truthy_non_boolean_values(self) -> None:
        checkpoint = FakeCheckpoint()
        checkpoint.is_multilingual = "true"
        with self.assertRaises(UnknownModelCapabilityError):
            require_multilingual_capability(checkpoint)


if __name__ == "__main__":
    unittest.main()
