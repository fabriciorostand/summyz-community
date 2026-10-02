import unittest
from unittest.mock import Mock, patch

from hardware_inventory import read_hardware_inventory


class TestHardwareInventory(unittest.TestCase):
    def test_cpu_only_does_not_launch_a_sensor(self) -> None:
        with patch("hardware_inventory.subprocess.run") as run:
            self.assertEqual(read_hardware_inventory(0), {"cudaDevices": 0, "accelerators": []})
            run.assert_not_called()

    def test_reads_all_visible_gpus_with_bounded_execution(self) -> None:
        with patch(
            "hardware_inventory.subprocess.run",
            return_value=Mock(stdout="0, Current GPU, 6144\n1, Second GPU, 8192\n"),
        ) as run:
            result = read_hardware_inventory(2)
            self.assertEqual(
                result["accelerators"],
                [
                    {
                        "id": "nvidia-0",
                        "name": "Current GPU",
                        "vendor": "nvidia",
                        "memoryBytes": 6144 * 1024**2,
                    },
                    {
                        "id": "nvidia-1",
                        "name": "Second GPU",
                        "vendor": "nvidia",
                        "memoryBytes": 8192 * 1024**2,
                    },
                ],
            )
            self.assertEqual(run.call_args.kwargs["timeout"], 3)
            self.assertTrue(run.call_args.kwargs["check"])

    def test_rejects_invalid_counts_duplicate_ids_and_malformed_memory(self) -> None:
        for output, count in [
            ("0, GPU, N/A\n", 1),
            ("0, GPU, 0\n", 1),
            ("0, GPU, -1\n", 1),
            ("0, GPU, 1.5\n", 1),
            ("0, GPU, 1\n", 2),
            ("0, GPU, 1\n0, GPU, 1\n", 2),
            ("bad", 1),
            ("-1, GPU, 1\n", 1),
            ("0, , 1\n", 1),
            ("0, GPU, 999999999999999\n", 1),
        ]:
            with (
                self.subTest(output=output),
                patch("hardware_inventory.subprocess.run", return_value=Mock(stdout=output)),
                self.assertRaises(ValueError),
            ):
                read_hardware_inventory(count)
        for count in [-1, 129, True]:
            with self.subTest(count=count), self.assertRaises(ValueError):
                read_hardware_inventory(count)

    def test_propagates_sensor_failure_without_a_fabricated_reading(self) -> None:
        with (
            patch("hardware_inventory.subprocess.run", side_effect=OSError("sensor unavailable")),
            self.assertRaises(OSError),
        ):
            read_hardware_inventory(1)
