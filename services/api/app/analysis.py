"""Peak-preserving analytics used by the API and the Kafka worker."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from statistics import mean


@dataclass(frozen=True)
class ExposureWindow:
    minutes: int
    start: datetime
    end: datetime
    mean_pm25: float
    peak_pm25: float
    peak_preserved: bool
    label: str


def rolling_exposure(values: list[tuple[datetime, float]], minutes: int) -> ExposureWindow:
    """Return a window that preserves the observed peak alongside the mean.

    This intentionally never replaces a burst with a daily average. A 24-hour
    report can coexist with 5/15/60-minute exposure windows for health response.
    """
    if not values:
        now = datetime.now(timezone.utc)
        return ExposureWindow(minutes, now, now, 0, 0, False, "No observations")
    values = sorted(values, key=lambda item: item[0])
    end = values[-1][0]
    start = end - timedelta(minutes=minutes)
    window = [value for timestamp, value in values if timestamp >= start]
    return ExposureWindow(minutes, start, end, round(mean(window), 1), round(max(window), 1), len(window) > 1, f"{minutes}-minute exposure")


def anomaly_score(current: float, baseline: float, quality: float = 1.0) -> float:
    """Bounded, explainable anomaly score for a first-pass edge detector."""
    if baseline <= 0:
        return 1.0 if current > 0 else 0.0
    return round(min(1.0, max(0.0, ((current / baseline) - 1) / 4) * quality), 3)
