"""Hybrid live + historical reasoning with an explicit safety boundary."""
from datetime import datetime, timedelta, timezone

from .schemas import DualModePrediction, HistoricalObservation


def demo_history(baseline: float) -> list[HistoricalObservation]:
    now = datetime.now(timezone.utc)
    # Clearly labeled fallback history for local development when PostGIS is empty.
    values = [baseline * .9, baseline * 1.05, baseline * 1.2, baseline * 1.8, baseline * 2.7, baseline * 1.4, baseline * 1.1]
    return [HistoricalObservation(observed_at=now - timedelta(days=6 - index), pm25=round(value, 1), source="demo-history") for index, value in enumerate(values)]


def predict_action(hotspot, alert, observations: list[HistoricalObservation], live_events: int) -> DualModePrediction:
    historical_peak = max((item.pm25 for item in observations), default=hotspot.baseline_pm25)
    recurrence = min(1.0, max(0.0, (historical_peak / max(hotspot.baseline_pm25, 1) - 1) / 3))
    live_signal = min(1.0, max(0.0, (hotspot.peak_pm25 / max(hotspot.baseline_pm25, 1) - 1) / 3))
    confidence = round(min(.97, .45 + recurrence * .2 + live_signal * .25 + (.1 if live_events else 0)), 2)
    next_action = "dispatch inspection and issue downwind health advisory" if live_signal >= .5 else "increase monitoring and request local verification"
    mode = "live-plus-history" if observations and live_events else "history-only" if observations else "live-only"
    return DualModePrediction(hotspot_id=hotspot.hotspot_id, generated_at=datetime.now(timezone.utc), mode=mode, live_state={"current_aqi": hotspot.current_aqi, "peak_pm25": hotspot.peak_pm25, "baseline_pm25": hotspot.baseline_pm25, "events_seen": live_events}, history=observations, predicted_action={"action": next_action, "historical_recurrence_score": round(recurrence, 2), "live_anomaly_score": round(live_signal, 2), "recommended_window": alert.peak_window, "human_approval_required": True}, confidence=confidence, safety={"raw_historical_rows_exposed": False, "external_side_effects": "disabled by default", "model_output": "decision support, not autonomous legal enforcement"})
