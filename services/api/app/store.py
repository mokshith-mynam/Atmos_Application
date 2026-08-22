from datetime import datetime, timedelta, timezone

from .schemas import (
    AlertStatus,
    CorridorForecast,
    EvidenceLink,
    FederationNode,
    ForecastPoint,
    Hotspot,
    IncidentAlert,
    Overview,
    SourceKind,
)

NOW = datetime.now(timezone.utc)

HOTSPOTS: list[Hotspot] = [
    Hotspot(
        hotspot_id="hs-town-a-b", name="Town A → Town B plume", country_code="IN", region="Punjab border corridor",
        latitude=30.79, longitude=75.84, radius_km=2.8, current_aqi=168, peak_pm25=252, baseline_pm25=59,
        anomaly_score=.96, first_seen=NOW - timedelta(hours=3), last_seen=NOW,
        likely_sources=["Chemical processing cluster · Town A", "Upwind industrial stack 3.1 km"],
        evidence=[
            EvidenceLink(source_type=SourceKind.sensor, source_id="IN-PB-044", captured_at=NOW - timedelta(minutes=11), confidence=.98, summary="PM₂.₅ 4.2× baseline"),
            EvidenceLink(source_type=SourceKind.satellite, source_id="S5P-2026-08-19-0812", captured_at=NOW - timedelta(minutes=30), confidence=.77, summary="NO₂ column anomaly aligns with plume"),
            EvidenceLink(source_type=SourceKind.weather, source_id="WX-PB-30.8-75.8", captured_at=NOW - timedelta(minutes=12), confidence=.93, summary="Wind 4.8 m/s from 278°"),
            EvidenceLink(source_type=SourceKind.citizen, source_id="CR-9821", captured_at=NOW - timedelta(hours=2), confidence=.89, summary="Eye irritation report with photo"),
        ], affected_regions=["Punjab, IN", "Lahore, PK"],
    ),
    Hotspot(
        hotspot_id="hs-punjab-burn", name="Punjab crop burn cluster", country_code="IN", region="Indo-Gangetic Plain",
        latitude=30.95, longitude=75.32, radius_km=8.3, current_aqi=142, peak_pm25=187, baseline_pm25=71,
        anomaly_score=.84, first_seen=NOW - timedelta(hours=7), last_seen=NOW - timedelta(minutes=20),
        likely_sources=["Agricultural burning cluster · 18 reports"], evidence=[
            EvidenceLink(source_type=SourceKind.satellite, source_id="VIIRS-2026-08-19-0710", captured_at=NOW - timedelta(hours=1), confidence=.92, summary="Thermal anomaly cluster"),
            EvidenceLink(source_type=SourceKind.citizen, source_id="CR-9794", captured_at=NOW - timedelta(hours=2), confidence=.86, summary="18 corroborating reports"),
        ], affected_regions=["Punjab, IN", "Haryana, IN"],
    ),
]

ALERTS: list[IncidentAlert] = [
    IncidentAlert(alert_id="ALT-2026-0819-001", hotspot_id="hs-town-a-b", severity="high", title="Industrial plume · Town A → B", summary="PM₂.₅ spike 4.2× baseline. Wind-aware attribution points to the chemical processing cluster.", status=AlertStatus.open, created_at=NOW - timedelta(hours=2), peak_window="00:40–03:10 IST", source_confidence=.91, likely_source="Chemical processing cluster · Town A", affected_regions=["Punjab, IN", "Lahore, PK"], recommended_actions=["Dispatch border inspection team", "Issue shelter-in-place alert for Town B", "Request stack logs from Town A operators"], evidence_count=4),
    IncidentAlert(alert_id="ALT-2026-0819-002", hotspot_id="hs-punjab-burn", severity="medium", title="Crop burn cluster · Punjab corridor", summary="Satellite thermal anomalies and citizen reports corroborate an active burn cluster.", status=AlertStatus.acknowledged, created_at=NOW - timedelta(hours=5), peak_window="11:00–16:00 IST", source_confidence=.84, likely_source="Agricultural burning cluster", affected_regions=["Punjab, IN", "Haryana, IN"], recommended_actions=["Notify district response cell", "Send public health advisory"], evidence_count=2),
]

CORRIDORS: list[CorridorForecast] = [
    CorridorForecast(corridor_id="igp", name="Indo-Gangetic Plain", countries=["IN", "PK", "BD", "NP"], risk_level="elevated", confidence=.73, peak_window="12:00–16:00 IST", signals=["Low boundary-layer height", "Upwind thermal anomalies", "Persistent westerly winds"], points=[ForecastPoint(hour=h, risk=r, predicted_aqi=a, confidence=c) for h, r, a, c in [("NOW", .22, 62, .91), ("10", .34, 78, .87), ("12", .58, 114, .82), ("14", .82, 168, .73), ("16", .67, 141, .77), ("18", .43, 96, .84), ("20", .29, 71, .9)]]),
    CorridorForecast(corridor_id="sh-mos", name="Shanghai–Moscow", countries=["CN", "KZ", "RU"], risk_level="low", confidence=.61, peak_window="18:00–22:00 local", signals=["Stable synoptic pattern", "Low anomaly density"], points=[ForecastPoint(hour=h, risk=r, predicted_aqi=a, confidence=c) for h, r, a, c in [("NOW", .14, 41, .82), ("10", .19, 47, .8), ("12", .22, 53, .76), ("14", .31, 62, .7), ("16", .37, 72, .65), ("18", .31, 65, .69), ("20", .2, 49, .77)]]),
]

FEDERATION = [FederationNode(country_code=c, node_count=n, model_version="aq-transformer-v0.4.2", last_round=42, privacy="Secure aggregation", status="synced") for c, n in [("BR", 412), ("RU", 531), ("IN", 948), ("CN", 713), ("ZA", 237)]]


def overview() -> Overview:
    return Overview(network_health=98.7, nodes_online=2841, nodes_total=2878, active_hotspots=12, citizen_reports_7d=1284, corridor_risk="Elevated", corridor_confidence=.73, last_model_sync=NOW - timedelta(minutes=4), peak_windows_enabled=True, federation_nodes=FEDERATION)
