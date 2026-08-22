from datetime import datetime, timedelta, timezone
import hmac
import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .analysis import rolling_exposure
from .database import connect, historical_pm25, monthly_pm25, persist_sensor
from .dual_mode import demo_history, predict_action
from .live import hub
from .decision_engine import action_plan, checkpoint_manifest, evidence_package, forecast_export, recommendation
from .schemas import ActionTriggerRequest, AlertAction, CitizenReport, DualModePrediction, HistoricalObservation, IncidentAlert, IngestEnvelope, SensorReading
from .store import ALERTS, CORRIDORS, HOTSPOTS, overview

app = FastAPI(title="Atmos Federated Climate Action API", version="0.1.0", docs_url="/docs")
allowed_hosts = [item.strip() for item in os.getenv("ATMOS_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",") if item.strip()]
allowed_origins = [item.strip() for item in os.getenv("ATMOS_ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",") if item.strip()]
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type", "X-Action-Token", "X-Ingest-Token"])


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app.add_middleware(SecurityHeadersMiddleware)


def verify_ingest_token(token: str | None) -> None:
    configured = os.getenv("ATMOS_INGEST_TOKEN")
    if configured and (not token or not hmac.compare_digest(token, configured)):
        raise HTTPException(status_code=401, detail="Valid X-Ingest-Token required")


@app.on_event("startup")
async def startup():
    await connect()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "atmos-api"}


@app.get("/api/overview")
def get_overview():
    return overview()


@app.get("/api/live/snapshot")
def get_live_snapshot():
    return jsonable_encoder({"stream_status": "live" if hub.last_event_at else "waiting", "last_event_at": hub.last_event_at, "events_seen": hub.events_seen, "quality": {"sensor": "verified", "satellite": "modeled", "citizen": "corroborated", "weather": "verified"}, "hotspots": HOTSPOTS, "alerts": ALERTS})


@app.websocket("/ws/live")
async def live_socket(websocket: WebSocket):
    await hub.connect(websocket)
    try:
        await websocket.send_json({"type": "snapshot", "data": get_live_snapshot()})
        while True:
            # Clients may send a ping or filter request; the server keeps the
            # connection open for low-latency event fan-out.
            await websocket.receive_text()
    except WebSocketDisconnect:
        await hub.disconnect(websocket)


@app.get("/api/hotspots")
def get_hotspots(country: str | None = Query(default=None, min_length=2), min_anomaly: float = Query(default=0, ge=0, le=1)):
    return [h for h in HOTSPOTS if (not country or h.country_code == country.upper()) and h.anomaly_score >= min_anomaly]


@app.get("/api/hotspots/{hotspot_id}/evidence")
def get_evidence_chain(hotspot_id: str):
    hotspot = next((h for h in HOTSPOTS if h.hotspot_id == hotspot_id), None)
    if not hotspot:
        raise HTTPException(status_code=404, detail="Hotspot not found")
    return {"hotspot_id": hotspot_id, "chain_is_complete": len(hotspot.evidence) >= 3, "links": hotspot.evidence, "likely_sources": hotspot.likely_sources, "affected_regions": hotspot.affected_regions}


@app.get("/api/events/{alert_id}/evidence-package")
def get_evidence_package(alert_id: str):
    """Return a hashable attribution package for human/legal review."""
    alert = next((a for a in ALERTS if a.alert_id == alert_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Incident not found")
    hotspot = next((h for h in HOTSPOTS if h.hotspot_id == alert.hotspot_id), None)
    if not hotspot:
        raise HTTPException(status_code=404, detail="Hotspot not found")
    return evidence_package(alert, hotspot)


@app.get("/api/hotspots/{hotspot_id}/exposure")
def get_exposure_windows(hotspot_id: str):
    hotspot = next((h for h in HOTSPOTS if h.hotspot_id == hotspot_id), None)
    if not hotspot:
        raise HTTPException(status_code=404, detail="Hotspot not found")
    now = hotspot.last_seen
    samples = [(now - timedelta(minutes=m), value) for m, value in [(180, 61), (150, 72), (120, 91), (90, 121), (60, 187), (45, 252), (30, 220), (15, 201), (0, hotspot.peak_pm25)]]
    return [rolling_exposure(samples, minutes).__dict__ for minutes in (5, 15, 60, 1440)]


@app.get("/api/events")
def get_events(status: str | None = None):
    return [a for a in ALERTS if not status or a.status.value == status]


@app.get("/api/events/{alert_id}")
def get_event(alert_id: str) -> IncidentAlert:
    alert = next((a for a in ALERTS if a.alert_id == alert_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Incident not found")
    return alert


@app.post("/api/events/{alert_id}/actions")
def action_event(alert_id: str, action: AlertAction) -> IncidentAlert:
    alert = next((a for a in ALERTS if a.alert_id == alert_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Incident not found")
    alert.status = action.status
    return alert


@app.post("/api/events/{alert_id}/action-trigger")
def trigger_action(alert_id: str, request: ActionTriggerRequest, x_action_token: str | None = Header(default=None)):
    """Plan or dispatch routes; non-dry-run execution requires an environment token."""
    alert = next((a for a in ALERTS if a.alert_id == alert_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Incident not found")
    configured_token = os.getenv("ATMOS_ACTION_TOKEN")
    if not request.dry_run and (not configured_token or not x_action_token or not hmac.compare_digest(x_action_token, configured_token)):
        raise HTTPException(status_code=403, detail="Live action dispatch requires a valid X-Action-Token")
    return action_plan(alert, request)


@app.get("/api/forecasts/corridors")
def get_forecasts():
    return CORRIDORS


@app.get("/api/forecasts/corridors/{corridor_id}/export")
def export_corridor_forecast(corridor_id: str):
    corridor = next((item for item in CORRIDORS if item.corridor_id == corridor_id), None)
    if not corridor:
        raise HTTPException(status_code=404, detail="Corridor not found")
    return forecast_export(corridor)


@app.get("/api/recommendations")
def get_recommendations(alert_id: str | None = None):
    alert = next((a for a in ALERTS if a.alert_id == alert_id), None) if alert_id else ALERTS[0]
    hotspot = next((h for h in HOTSPOTS if h.hotspot_id == alert.hotspot_id), None) if alert else HOTSPOTS[0]
    if not hotspot:
        raise HTTPException(status_code=404, detail="Hotspot not found")
    return recommendation(alert, hotspot)


@app.get("/api/hotspots/{hotspot_id}/dual-mode-prediction", response_model=DualModePrediction)
async def get_dual_mode_prediction(hotspot_id: str):
    """Combine current live state with nearby historical observations."""
    hotspot = next((h for h in HOTSPOTS if h.hotspot_id == hotspot_id), None)
    if not hotspot:
        raise HTTPException(status_code=404, detail="Hotspot not found")
    alert = next((a for a in ALERTS if a.hotspot_id == hotspot_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    stored = await historical_pm25(hotspot.latitude, hotspot.longitude, hotspot.radius_km, 7)
    observations = [HistoricalObservation(**item) for item in stored] if stored else demo_history(hotspot.baseline_pm25)
    prediction = predict_action(hotspot, alert, observations, hub.events_seen)
    if not stored and not hub.events_seen:
        prediction.mode = "demo-fallback"
    return prediction


@app.get("/api/hotspots/{hotspot_id}/history")
async def get_hotspot_history(hotspot_id: str, years: int = Query(default=5, ge=1, le=5), window: str = Query(default="5y", pattern="^(5y|5m|7d|24h)$")):
    """Return an aggregated history window without exposing raw sensor rows."""
    hotspot = next((h for h in HOTSPOTS if h.hotspot_id == hotspot_id), None)
    if not hotspot:
        raise HTTPException(status_code=404, detail="Hotspot not found")
    if window in {"7d", "24h"}:
        stored = await historical_pm25(hotspot.latitude, hotspot.longitude, hotspot.radius_km, 7 if window == "7d" else 1)
        if stored:
            points = [{"period": item["observed_at"].isoformat(), "aqi": round(item["pm25"] * 1.25), "mean_pm25": item["pm25"], "peak_pm25": item["pm25"], "observations": 1, "source": item["source"]} for item in stored]
            return {"hotspot_id": hotspot_id, "range": window, "source": "postgis", "points": points}
    stored = await monthly_pm25(hotspot.latitude, hotspot.longitude, hotspot.radius_km, years if window == "5y" else 1)
    if stored:
        points = [{**item, "aqi": round(item["mean_pm25"] * 1.25)} for item in stored]
        if window == "5m":
            points = points[-5:]
        return {"hotspot_id": hotspot_id, "range": window, "years": years, "source": "postgis", "points": points}
    # Development fallback: this is explicitly synthetic and is replaced as soon as
    # monthly sensor aggregates exist in PostGIS.
    points = []
    now = datetime.now(timezone.utc)
    count = 60 if window == "5y" else 5 if window == "5m" else 7 if window == "7d" else 13
    for offset in range(count - 1, -1, -1):
        month_index = now.month - 1 - offset
        year = now.year + month_index // 12
        month = month_index % 12 + 1
        seasonal = 1.0 + (.35 if month in (10, 11, 12, 1) else .05)
        aqi = round(max(25, hotspot.current_aqi * seasonal * (0.82 + ((offset * 17) % 19) / 100)))
        if window in {"7d", "24h"}:
            period = (now - timedelta(hours=offset * (24 if window == "7d" else 2))).isoformat()
        else:
            period = f"{year:04d}-{month:02d}-01"
        points.append({"period": period, "aqi": aqi, "mean_pm25": round(aqi / 1.25, 1), "peak_pm25": round(aqi / 1.25 * 1.7, 1), "observations": 0, "source": "demo-history"})
    return {"hotspot_id": hotspot_id, "range": window, "years": years, "source": "demo-history", "points": points}


@app.get("/api/location/context")
async def get_location_context(latitude: float = Query(..., ge=-90, le=90), longitude: float = Query(..., ge=-180, le=180)):
    """Fetch nearby weather and optional OpenAQ context without exposing credentials."""
    import httpx
    weather: dict[str, Any] = {"status": "unavailable"}
    openaq: dict[str, Any] = {"status": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get("https://api.open-meteo.com/v1/forecast", params={"latitude": latitude, "longitude": longitude, "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m"})
            response.raise_for_status()
            weather = {"status": "live", **response.json().get("current", {})}
            if os.getenv("OPENAQ_API_KEY"):
                aq_response = await client.get("https://api.openaq.org/v3/locations", params={"coordinates": f"{latitude},{longitude}", "radius": 10000, "limit": 5}, headers={"X-API-Key": os.getenv("OPENAQ_API_KEY", "")})
                openaq = {"status": "live", "locations": aq_response.json().get("results", [])}
    except Exception as exc:
        weather = {"status": "unavailable", "detail": str(exc)[:120]}
    return {"coordinates": {"latitude": latitude, "longitude": longitude}, "weather": weather, "air_quality": openaq, "risk": {"status": "context-only", "message": "Risk scoring requires a nearby sensor or satellite observation."}}


@app.get("/api/location/search")
async def search_location(query: str = Query(..., min_length=2, max_length=120)):
    """Resolve a city or facility label through Open-Meteo geocoding."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": query, "count": 1, "language": "en", "format": "json"})
            response.raise_for_status()
            result = response.json().get("results", [])
        if not result:
            raise HTTPException(status_code=404, detail="Location not found")
        item = result[0]
        return {"name": item.get("name", query), "country": item.get("country"), "latitude": item["latitude"], "longitude": item["longitude"]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Location search unavailable: {str(exc)[:100]}") from exc


@app.get("/api/events/{alert_id}/dual-mode-prediction", response_model=DualModePrediction)
async def get_event_dual_mode_prediction(alert_id: str):
    alert = next((a for a in ALERTS if a.alert_id == alert_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Incident not found")
    return await get_dual_mode_prediction(alert.hotspot_id)


@app.post("/api/ingest/sensor", status_code=202)
async def ingest_sensor(reading: SensorReading, x_ingest_token: str | None = Header(default=None)):
    """Live edge contract. Kafka workers can call this after normalization."""
    verify_ingest_token(x_ingest_token)
    payload = reading.model_dump(mode="json")
    stored = await persist_sensor(payload)
    hub.mark_event()
    await hub.broadcast({"type": "sensor.reading", "event_id": str(reading.event_id), "observed_at": reading.observed_at.isoformat(), "stored_in_postgis": stored, "data_quality": reading.quality_score, "node_id": reading.node_id, "pm25": reading.pm25, "latitude": reading.latitude, "longitude": reading.longitude})
    return {"accepted": True, "event_id": str(reading.event_id), "peak_window": "5m", "stored_in_postgis": stored, "stream": "kafka-compatible"}


@app.post("/api/ingest/citizen", status_code=202)
def ingest_citizen(report: CitizenReport, x_ingest_token: str | None = Header(default=None)):
    """Citizen reports become evidence links; location is never rounded before storage."""
    verify_ingest_token(x_ingest_token)
    return {"accepted": True, "report_id": str(report.report_id), "triage": "queued", "nearby_risk": "high" if report.pm25 and report.pm25 > 150 else "moderate"}


@app.post("/api/internal/live-event", status_code=202)
async def internal_live_event(envelope: IngestEnvelope, x_ingest_token: str | None = Header(default=None)):
    """Kafka normalizer callback used by the worker for all source types."""
    verify_ingest_token(x_ingest_token)
    hub.mark_event()
    await hub.broadcast({"type": f"{envelope.source.value}.event", "data": envelope.payload, "received_at": hub.last_event_at.isoformat() if hub.last_event_at else None, "data_quality": envelope.payload.get("quality_score", envelope.payload.get("anomaly_score", .7))})
    return {"accepted": True, "broadcast": len(hub.clients), "source": envelope.source}


@app.post("/api/ingest/envelope", status_code=202)
def ingest_envelope(envelope: IngestEnvelope, x_ingest_token: str | None = Header(default=None)):
    verify_ingest_token(x_ingest_token)
    return {"accepted": True, "schema_version": envelope.schema_version, "received_at": datetime.now(timezone.utc)}


@app.get("/api/federation/status")
def federation_status():
    return {"round": 42, "model_version": "aq-transformer-v0.4.2", "aggregation": "secure_weighted_fedavg", "raw_data_shared": False, "nodes": overview().federation_nodes}


@app.get("/api/federation/checkpoint")
def federation_checkpoint():
    """Return the shareable checkpoint manifest; raw national data never enters it."""
    return checkpoint_manifest(overview().federation_nodes)
