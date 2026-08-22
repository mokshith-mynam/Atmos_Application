"""Scheduled Google Earth Engine scene export entrypoint."""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from processing import EarthEngineRasterAdapter


def run_once():
    region = [float(value) for value in os.getenv("GEE_REGION_BBOX", "75.0,30.0,76.8,31.8").split(",")]
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=2)
    output = Path(os.getenv("RASTER_OUTPUT_DIR", "./data/raster")) / f"sentinel_{end:%Y%m%dT%H%M%SZ}.tif"
    return EarthEngineRasterAdapter().export_scene("COPERNICUS/S5P/OFFL/L3_NO2", region, start.isoformat(), end.isoformat(), output)


if __name__ == "__main__":
    print(run_once())
