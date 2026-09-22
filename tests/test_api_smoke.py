"""Read-only API smoke tests.

Run from the repository root with:

    python tests/test_api_smoke.py

The tests use FastAPI's in-memory ASGI transport. They do not start Uvicorn,
connect to PostgreSQL/Kafka, write files, or modify application state.
"""

from __future__ import annotations

import sys
import unittest
import asyncio
import os
from pathlib import Path
from unittest.mock import patch


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = REPOSITORY_ROOT / "services" / "api"
sys.path.insert(0, str(API_ROOT))

from app.main import (  # noqa: E402
    federation_checkpoint,
    federation_status,
    get_forecasts,
    get_hotspots,
    get_ai_briefing,
    get_live_snapshot,
    get_overview,
    health,
)


class ApiSmokeTests(unittest.TestCase):
    def test_health_contract(self) -> None:
        self.assertEqual(health(), {"status": "ok", "service": "atmos-api"})

    def test_dashboard_snapshot_contracts(self) -> None:
        overview = get_overview().model_dump()
        snapshot = get_live_snapshot()

        self.assertIn("corridor_risk", overview)
        self.assertIn("federation_nodes", overview)
        self.assertIn("hotspots", snapshot)
        self.assertIn("alerts", snapshot)

    def test_hotspots_and_forecasts_are_populated(self) -> None:
        hotspots = get_hotspots(country=None, min_anomaly=0)
        forecasts = get_forecasts()

        self.assertGreater(len(hotspots), 0)
        self.assertGreater(len(forecasts), 0)
        self.assertTrue(all(item.current_aqi >= 0 for item in hotspots))
        self.assertTrue(all(item.points for item in forecasts))

    def test_federation_contracts(self) -> None:
        status = federation_status()
        checkpoint = federation_checkpoint().model_dump()

        self.assertEqual(status["round"], 42)
        self.assertGreater(len(status["nodes"]), 0)
        self.assertEqual(checkpoint["model_version"], "aq-transformer-v0.4.2")

    def test_gemini_briefing_has_a_safe_offline_fallback(self) -> None:
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            briefing = asyncio.run(get_ai_briefing("ALT-2026-0819-001", language="English"))

        self.assertEqual(briefing["mode"], "demo-fallback")
        self.assertEqual(briefing["provider"], "local-demo")
        self.assertIn("human review", briefing["briefing"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
