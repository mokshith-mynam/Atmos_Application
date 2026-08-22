"""Satellite/raster and plume attribution primitives.

The adapters are intentionally dependency-light at import time. In production,
Earth Engine authentication and Rasterio windows are supplied by the worker.
"""
from dataclasses import dataclass
from math import cos, radians, sin
from pathlib import Path


@dataclass(frozen=True)
class PlumeTrace:
    source_latitude: float
    source_longitude: float
    downwind_km: float
    confidence: float
    method: str


def backtrack_plume(lat: float, lon: float, wind_direction_deg: float, wind_speed_mps: float, hours: float = 3) -> PlumeTrace:
    """Walk the observed plume upwind to produce an auditable source candidate.

    This is the explainable first-pass model used before a CFD/dispersion model.
    Direction is the direction *from which* wind arrives, so the source is upwind.
    """
    distance_km = max(0.1, wind_speed_mps * hours * 3.6)
    bearing = radians((wind_direction_deg + 180) % 360)
    dlat = distance_km * cos(bearing) / 111.0
    dlon = distance_km * sin(bearing) / (111.0 * max(cos(radians(lat)), 0.1))
    confidence = min(0.97, 0.55 + min(hours / 6, .25) + min(wind_speed_mps / 20, .17))
    return PlumeTrace(lat - dlat, lon - dlon, distance_km, round(confidence, 2), "wind-aware upwind trace")


class EarthEngineRasterAdapter:
    """Boundary for national satellite products; credentials stay server-side."""

    def export_scene(self, collection: str, region: list[float], start_iso: str, end_iso: str, output: Path) -> Path:
        # Replace with ee.ImageCollection(...).filterDate(...).getDownloadURL(...)
        # in the worker environment. Keeping this adapter makes the pipeline testable offline.
        output.parent.mkdir(parents=True, exist_ok=True)
        return output


def read_raster_window(path: Path, bbox: tuple[float, float, float, float]):
    """Read a Rasterio window for a small AOI instead of loading a full scene."""
    import rasterio
    from rasterio.windows import from_bounds

    with rasterio.open(path) as dataset:
        window = from_bounds(*bbox, transform=dataset.transform)
        return dataset.read(1, window=window), dataset.window_transform(window)
