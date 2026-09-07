import tempfile
import unittest
from pathlib import Path

from model_inventory import create_model_inventory, write_model_inventory


class FakeCardData:
    license = "apache-2.0"


class FakeModelInfo:
    card_data = FakeCardData()
    sha = "abcdef123456"


class ModelInventoryTests(unittest.TestCase):
    def test_records_hugging_face_origin_revision_and_license(self) -> None:
        inventory = create_model_inventory(
            "org/custom-model",
            lambda repo_id: FakeModelInfo(),
        )

        self.assertEqual(inventory["model"], "org/custom-model")
        self.assertEqual(inventory["origin"], "https://huggingface.co/org/custom-model")
        self.assertEqual(inventory["revision"], "abcdef123456")
        self.assertEqual(inventory["license"], "apache-2.0")

    def test_resolves_metadata_at_the_requested_immutable_revision(self) -> None:
        requested_revision = "d90ca5fe260221311c53c58e660288d3deb8d356"
        requests: list[tuple[str, str | None]] = []

        def model_info(repo_id: str, revision: str | None = None) -> object:
            requests.append((repo_id, revision))
            return FakeModelInfo()

        inventory = create_model_inventory(
            "Systran/faster-whisper-tiny",
            model_info,
            requested_revision=requested_revision,
        )

        self.assertEqual(
            requests,
            [("Systran/faster-whisper-tiny", requested_revision)],
        )
        self.assertEqual(inventory["requestedRevision"], requested_revision)

    def test_unknown_metadata_does_not_block_arbitrary_model(self) -> None:
        def unavailable(_repo_id: str) -> object:
            raise RuntimeError("offline")

        inventory = create_model_inventory("org/private-model", unavailable)

        self.assertEqual(inventory["model"], "org/private-model")
        self.assertIsNone(inventory["revision"])
        self.assertIsNone(inventory["license"])

    def test_rejects_unsafe_or_oversized_metadata(self) -> None:
        class InvalidMetadata:
            card_data = type("Card", (), {"license": ["a", 2]})()
            sha = "x" * 201

        inventory = create_model_inventory("org/model", lambda _repo_id: InvalidMetadata())

        self.assertIsNone(inventory["revision"])
        self.assertIsNone(inventory["license"])

    def test_writes_inventory_next_to_downloaded_model(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            write_model_inventory(target, {"model": "small", "license": None})

            content = (target / "summyz-model-inventory.json").read_text(encoding="utf-8")
            self.assertIn('"model": "small"', content)


if __name__ == "__main__":
    unittest.main()
