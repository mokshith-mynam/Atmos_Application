# Atmos · Federated Climate Action Platform

Atmos is an end-to-end prototype for detecting, forecasting, attributing, and coordinating response to hyper-local and cross-border air-pollution events.

## Problem-to-solution coverage

| Failure in the scenario | Implemented capability |
| --- | --- |
| Distance dilution | Dense sensor/citizen node registry, satellite fusion, and PostGIS hotspot geometry rather than a single city monitor. |
| Time dilution | Kafka events retain raw timestamps and peak values; API exposes 5/15/60-minute exposure windows instead of only daily averages. |
| Zero traceability | Wind-aware plume backtracking ranks likely source zones and stores a signed evidence chain from sensor → satellite → weather → alert. |
| Weak cross-border action | ISO country/region metadata, shared event contracts, BRICS federation status, and an authority workflow for acknowledge/escalate/resolve. |
| Hidden hotspots | AI anomaly scoring combines PM2.5, NO2, thermal anomalies, citizen reports, and spatial clustering. |
| No advance warning | Corridor forecasts return 6-hour risk trajectories with confidence, contributing signals, and affected administrative regions. |
| Public-health gap | Citizen reporting and nearby-risk guidance are exposed through the React Native mobile app contract. |
| Data fragmentation | Versioned JSON schemas unify edge sensors, photos, satellite observations, weather, and authority actions. |

## Stack

- `services/api`: Python, FastAPI, SQLAlchemy/PostGIS-ready data layer, Pydantic contracts.
- `services/ingestion`: Python Kafka consumer/producer and event normalization.
- `services/federated`: PyTorch model plus Flower server/client strategy for privacy-preserving training.
- `services/geospatial`: Google Earth Engine export adapter, Rasterio processing, plume backtracking helpers.
- `apps/web`: React + TypeScript + Deck.gl authority command dashboard.
- `apps/mobile`: React Native citizen reporting/nearby-risk app scaffold.
- `infra`: PostgreSQL/PostGIS and Kafka development services.

## Live event path

The live path is:

```text
sensor / citizen / weather / satellite
        ↓
Kafka topic → normalization worker → FastAPI live-event endpoint
        ↓                         ↘
PostGIS persistence              WebSocket /ws/live
                                      ↓
                            React + Deck.gl dashboard
```

The dashboard opens `/ws/live`, consumes the initial snapshot, and updates the map and live-feed status when new sensor events arrive. `services/ingestion/live_worker.py` bridges normalized Kafka events into that WebSocket hub. `DATABASE_URL` enables PostGIS writes; without it the API stays in development fallback mode and reports that persistence is unavailable.

## Accuracy boundary

The software is real-time capable, but accuracy depends on the live sources configured in the deployment. Set `SENSOR_FEED_URL`, `WEATHER_FEED_URL`, `GEE_REGION_BBOX`, Earth Engine credentials, and real node calibration metadata before treating alerts as regulatory evidence. Modeled satellite/anomaly results remain explicitly labeled as modeled until corroborated by calibrated ground observations.

## Run the API locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r services/api/requirements.txt -r services/ingestion/requirements.txt -r services/geospatial/requirements.txt
.venv/bin/uvicorn app.main:app --app-dir services/api --reload --port 8000
```

The API intentionally uses a realistic in-memory seed when PostGIS is not available so the dashboard can be developed offline. Set `DATABASE_URL` to switch to PostgreSQL and `KAFKA_BOOTSTRAP_SERVERS` to enable event publishing.

## Run the authority dashboard

```bash
cd apps/web
npm install
npm run dev
```

For production, build the web app and reverse-proxy `/api` to FastAPI. See `docker-compose.yml` for local PostGIS and Kafka dependencies.

If Node/npm are not installed system-wide, use the local runtime installed in `.tools/node`:

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
cd apps/web && npm run dev
```

For CPU-only federation development, install `services/federated/requirements-cpu.txt`; the default federation requirements are suitable for a hardware-specific PyTorch installation.
