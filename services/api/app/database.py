"""Optional async PostGIS persistence.

The API remains usable for local UI work when PostGIS is unavailable, but every
accepted live event is written when DATABASE_URL is configured and reachable.
"""
import os
from typing import Any

pool = None


async def connect() -> bool:
    global pool
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return False
    try:
        import asyncpg
        pool = await asyncpg.create_pool(database_url, min_size=1, max_size=5)
        return True
    except Exception:
        pool = None
        return False


async def persist_sensor(payload: dict[str, Any]) -> bool:
    if pool is None:
        return False
    query = """INSERT INTO sensor_readings (event_id,node_id,country_code,region,observed_at,geom,pm25,no2,temperature_c,humidity_pct,quality_score)
               VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326),$8,$9,$10,$11,$12)
               ON CONFLICT (event_id) DO NOTHING"""
    try:
        async with pool.acquire() as connection:
            await connection.execute(query, payload["event_id"], payload["node_id"], payload["country_code"], payload["region"], payload["observed_at"], payload["longitude"], payload["latitude"], payload.get("pm25"), payload.get("no2"), payload.get("temperature_c"), payload.get("humidity_pct"), payload.get("quality_score", .95))
        return True
    except Exception:
        return False


async def historical_pm25(latitude: float, longitude: float, radius_km: float = 10, days: int = 7) -> list[dict[str, Any]]:
    """Read historical observations from PostGIS without exposing raw rows."""
    if pool is None:
        return []
    query = """SELECT observed_at, pm25 FROM sensor_readings
               WHERE pm25 IS NOT NULL
                 AND observed_at >= now() - ($1::int * interval '1 day')
                 AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4)
               ORDER BY observed_at ASC LIMIT 2000"""
    try:
        async with pool.acquire() as connection:
            rows = await connection.fetch(query, days, longitude, latitude, radius_km * 1000)
        return [{"observed_at": row["observed_at"], "pm25": float(row["pm25"]), "source": "postgis"} for row in rows]
    except Exception:
        return []


async def monthly_pm25(latitude: float, longitude: float, radius_km: float = 10, years: int = 5) -> list[dict[str, Any]]:
    """Return monthly aggregates for a long-range trend without raw-row export."""
    if pool is None:
        return []
    query = """SELECT date_trunc('month', observed_at) AS month, avg(pm25) AS mean_pm25,
                      max(pm25) AS peak_pm25, count(*) AS observations
               FROM sensor_readings
               WHERE pm25 IS NOT NULL
                 AND observed_at >= now() - ($1::int * interval '1 year')
                 AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4)
               GROUP BY 1 ORDER BY 1 ASC"""
    try:
        async with pool.acquire() as connection:
            rows = await connection.fetch(query, years, longitude, latitude, radius_km * 1000)
        return [{"period": row["month"].date().isoformat(), "mean_pm25": round(float(row["mean_pm25"]), 1), "peak_pm25": round(float(row["peak_pm25"]), 1), "observations": row["observations"], "source": "postgis"} for row in rows]
    except Exception:
        return []
