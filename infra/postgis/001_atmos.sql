CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sensor_readings (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  region TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  geom GEOMETRY(Point, 4326) NOT NULL,
  pm25 DOUBLE PRECISION,
  no2 DOUBLE PRECISION,
  temperature_c DOUBLE PRECISION,
  humidity_pct DOUBLE PRECISION,
  quality_score DOUBLE PRECISION NOT NULL DEFAULT .95,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sensor_readings_geom_gix ON sensor_readings USING GIST (geom);
CREATE INDEX IF NOT EXISTS sensor_readings_observed_at_idx ON sensor_readings (observed_at DESC);

CREATE TABLE IF NOT EXISTS citizen_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_at TIMESTAMPTZ NOT NULL,
  geom GEOMETRY(Point, 4326) NOT NULL,
  description TEXT NOT NULL,
  photo_url TEXT,
  observed_symptoms JSONB NOT NULL DEFAULT '[]',
  pm25 DOUBLE PRECISION,
  country_code CHAR(2) NOT NULL
);
CREATE INDEX IF NOT EXISTS citizen_reports_geom_gix ON citizen_reports USING GIST (geom);

CREATE TABLE IF NOT EXISTS satellite_observations (
  observation_id TEXT PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL,
  product TEXT NOT NULL,
  anomaly_score DOUBLE PRECISION NOT NULL,
  cloud_fraction DOUBLE PRECISION NOT NULL,
  footprint GEOMETRY(Polygon, 4326) NOT NULL,
  raster_uri TEXT
);
CREATE INDEX IF NOT EXISTS satellite_observations_footprint_gix ON satellite_observations USING GIST (footprint);

CREATE TABLE IF NOT EXISTS hotspots (
  hotspot_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  region TEXT NOT NULL,
  center GEOMETRY(Point, 4326) NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL,
  anomaly_score DOUBLE PRECISION NOT NULL,
  peak_pm25 DOUBLE PRECISION,
  baseline_pm25 DOUBLE PRECISION,
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS hotspots_center_gix ON hotspots USING GIST (center);

CREATE TABLE IF NOT EXISTS evidence_links (
  evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotspot_id TEXT REFERENCES hotspots(hotspot_id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  summary TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_alerts (
  alert_id TEXT PRIMARY KEY,
  hotspot_id TEXT REFERENCES hotspots(hotspot_id),
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  peak_window_start TIMESTAMPTZ NOT NULL,
  peak_window_end TIMESTAMPTZ NOT NULL,
  source_confidence DOUBLE PRECISION NOT NULL,
  likely_source TEXT NOT NULL,
  affected_regions JSONB NOT NULL,
  recommended_actions JSONB NOT NULL
);
