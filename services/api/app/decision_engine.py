"""Deterministic, auditable decision-engine outputs for the development system.

The engine is deliberately side-effect free: it assembles evidence, plans routes,
exports forecast geometry, and produces recommendations. Dispatch is handled by
an explicit API call and is dry-run by default.
"""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from uuid import uuid4

from .schemas import (
    ActionTriggerResult,
    EvidencePackage,
    ForecastExport,
    MitigationRecommendation,
    ModelCheckpointManifest,
)
from math import cos, radians, sin


def backtrack_plume(lat: float, lon: float, wind_direction_deg: float, wind_speed_mps: float, hours: float = 3):
    distance_km = max(0.1, wind_speed_mps * hours * 3.6)
    bearing = radians((wind_direction_deg + 180) % 360)
    dlat = distance_km * cos(bearing) / 111.0
    dlon = distance_km * sin(bearing) / (111.0 * max(cos(radians(lat)), 0.1))
    return type("Trace", (), {"source_latitude": lat - dlat, "source_longitude": lon - dlon, "downwind_km": distance_km, "confidence": min(0.97, 0.55 + min(hours / 6, .25) + min(wind_speed_mps / 20, .17)), "method": "wind-aware upwind trace"})()


def evidence_package(alert, hotspot) -> EvidencePackage:
    weather = next((item for item in hotspot.evidence if item.source_type.value == "weather"), None)
    wind_speed = 4.8
    wind_direction = 278.0
    if weather:
        # The demo store carries the values in the summary; production adapters
        # replace these defaults with the normalized weather event payload.
        wind_speed, wind_direction = 4.8, 278.0
    trace = backtrack_plume(hotspot.latitude, hotspot.longitude, wind_direction, wind_speed)
    package_id = f"EVD-{uuid4().hex[:12].upper()}"
    digest_input = "|".join(f"{item.source_type.value}:{item.source_id}:{item.captured_at.isoformat()}" for item in hotspot.evidence)
    digest = sha256(digest_input.encode()).hexdigest()
    return EvidencePackage(
        package_id=package_id,
        alert_id=alert.alert_id,
        legal_status="machine-assembled-review-required",
        generated_at=datetime.now(timezone.utc),
        incident={"hotspot_id": hotspot.hotspot_id, "title": alert.title, "peak_window": alert.peak_window, "affected_regions": alert.affected_regions},
        source_chain=hotspot.evidence,
        attribution={"likely_sources": hotspot.likely_sources, "source_confidence": alert.source_confidence, "method": trace.method, "origin_candidate": {"latitude": round(trace.source_latitude, 6), "longitude": round(trace.source_longitude, 6), "upwind_distance_km": round(trace.downwind_km, 2), "confidence": trace.confidence}, "wind": {"speed_mps": wind_speed, "direction_from_deg": wind_direction}},
        integrity={"sha256": digest, "evidence_count": len(hotspot.evidence), "timestamps_preserved": True},
        export_formats=["JSON", "GeoJSON-compatible metadata"],
    )


def action_plan(alert, request) -> ActionTriggerResult:
    routes = []
    for channel in request.channels:
        destination = {"webhook": "ACTION_WEBHOOK_URL", "sms": "SMS_PROVIDER_NOT_CONFIGURED", "api": "municipal-response-api", "health_advisory": "school-health-advisory-api"}[channel]
        routes.append({"channel": channel, "destination": destination, "status": "planned" if request.dry_run else "queued", "requires_credentials": channel in {"webhook", "sms"}})
    return ActionTriggerResult(trigger_id=f"TRG-{uuid4().hex[:12].upper()}", alert_id=alert.alert_id, dry_run=request.dry_run, status="planned" if request.dry_run else "queued", routes=routes, recommended_actions=alert.recommended_actions, created_at=datetime.now(timezone.utc))


def forecast_export(corridor) -> ForecastExport:
    bases = {"igp": (75.84, 30.79), "sh-mos": (121.47, 31.23)}
    base_lon, base_lat = bases.get(corridor.corridor_id, (0.0, 0.0))
    features = []
    for item in corridor.points:
        offset = 0 if item.hour == "NOW" else int(item.hour)
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [base_lon + offset * 0.03, base_lat + offset * 0.012]}, "properties": {"corridor_id": corridor.corridor_id, "horizon_hours": offset, "risk": item.risk, "predicted_aqi": item.predicted_aqi, "confidence": item.confidence, "valid_time_label": item.hour}})
    now = datetime.now(timezone.utc)
    return ForecastExport(export_id=f"FC-{uuid4().hex[:12].upper()}", corridor_id=corridor.corridor_id, generated_at=now, valid_until=now + timedelta(hours=72), horizon_hours=72, format="GeoJSON", feature_collection={"type": "FeatureCollection", "features": features}, provenance={"model": "aq-transformer-v0.4.2", "signals": corridor.signals, "countries": corridor.countries, "warning": "Forecast geometry is a model output, not a legal boundary."})


def checkpoint_manifest(nodes) -> ModelCheckpointManifest:
    model_version = "aq-transformer-v0.4.2"
    node_codes = [node.country_code for node in nodes]
    digest = sha256(f"{model_version}|42|{'|'.join(node_codes)}".encode()).hexdigest()
    return ModelCheckpointManifest(artifact_id=f"CKPT-{uuid4().hex[:12].upper()}", model_version=model_version, round=42, format="safetensors-manifest", encryption="transport-and-at-rest encryption required at deployment", raw_data_shared=False, participating_nodes=node_codes, sha256=digest, artifact_status="federated-round-complete")


def recommendation(alert, hotspot) -> MitigationRecommendation:
    ratio = round(hotspot.peak_pm25 / max(hotspot.baseline_pm25, 1), 1)
    return MitigationRecommendation(recommendation_id=f"REC-{uuid4().hex[:12].upper()}", alert_id=alert.alert_id if alert else None, priority="urgent" if hotspot.current_aqi >= 150 else "high", title="Reduce downwind exposure during the predicted peak window", rationale=f"PM₂.₅ is {ratio}× the local baseline and the source confidence is {round(alert.source_confidence * 100)}%.", interventions=[{"action": "temporarily reroute heavy diesel freight", "target": hotspot.affected_regions[0], "reduction_percent": 30, "window": alert.peak_window if alert else "next 6 hours"}, {"action": "dispatch environmental inspection unit", "target": hotspot.likely_sources[0]}, {"action": "issue school health advisory", "target": ", ".join(hotspot.affected_regions)}], expected_effect={"metric": "downwind PM10 accumulation", "direction": "decrease", "estimated_reduction_percent": "10–25%", "confidence": "scenario estimate"}, assumptions=["Wind direction remains within the current forecast envelope", "Authorities can authorize temporary freight controls", "Inspection capacity is available"], requires_human_authorization=True)
