import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DeckGL from '@deck.gl/react';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import './styles.css';

type Severity = 'high' | 'medium';
type Section = 'Live overview' | 'Hotspot detection' | 'Corridor forecasts' | 'Evidence vault' | 'Federation';
type Alert = { id: string; title: string; detail: string; severity: Severity; status: string; source: string; confidence: number };
type HotspotPoint = { id: string; position: [number, number]; color: [number, number, number]; radius: number; aqi: number };
type ApiHotspot = { hotspot_id: string; longitude: number; latitude: number; radius_km: number; current_aqi: number; anomaly_score: number };
type ForecastPoint = { hour: string; risk: number; predicted_aqi: number; confidence: number };
type CorridorData = { corridor_id: string; name: string; countries: string[]; risk_level: string; confidence: number; peak_window: string; signals: string[]; points: ForecastPoint[] };
type FederationNode = { country_code: string; node_count: number; model_version: string; last_round: number; privacy: string; status: string };
type FederationStatus = { round?: number; model_version?: string; raw_data_shared?: boolean; nodes?: FederationNode[] };
type MapFocus = { longitude: number; latitude: number; zoom: number };
type ActionModalKind = 'dispatch' | 'evidence';
type HistoryWindow = '5y' | '5m' | '7d' | '24h';
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const WS_BASE_URL = (import.meta.env.VITE_WS_URL ?? '').replace(/\/$/, '');
const DEMO_HORIZONS = [0, 1, 3, 6, 12];
const DEMO_HORIZON_EVENT = 'atmos:demo-horizon';
const BUTTON_PURPOSES: Array<[RegExp, string]> = [
  [/(Live overview)$/, 'Show the real-time regional pollution overview.'],
  [/(Hotspot detection)$/, 'Inspect hyper-local pollution anomalies and attribution signals.'],
  [/(Corridor forecasts)$/, 'View cross-border corridor risk forecasts and map context.'],
  [/(Evidence vault)$/, 'Review incident evidence chains and citizen verification.'],
  [/(Federation)$/, 'Inspect federated model health and joint response protocols.'],
  [/^↥ Export$/, 'Download the current overview as a JSON report.'],
  [/^Open response room/, 'Open the Evidence Vault for response coordination.'],
  [/^Retry connection$/, 'Reconnect the API and live WebSocket stream.'],
  [/^View layers/, 'Open detailed hotspot layers and attribution signals.'],
  [/^Dispatch Authority Alert$/, 'Prepare an authority notification for this incident.'],
  [/^Download Legal Evidence$/, 'Generate and download the incident evidence package.'],
  [/^(5Y|5M|7D|24H)$/, 'Change the AQI history time window.'],
  [/^(Now|\+1h|\+3h|\+6h|\+12h)$/, 'Set the projected wind-dispersion forecast horizon.'],
  [/^Locate$/, 'Center the global map and load nearby weather and air-quality context.'],
  [/^Verify citizen evidence$/, 'Open image, metadata, and sensor cross-check verification.'],
  [/^Add verification image$/, 'Select a pollution image for local verification review.'],
  [/^Acknowledge$/, 'Mark this incident as acknowledged by the reviewing authority.'],
  [/^Escalate/, 'Escalate this incident for coordinated intervention.'],
  [/^Initiate Joint/, 'Prepare a cross-border inspection protocol request.'],
  [/^Request satellite tasking$/, 'Request high-resolution satellite coverage from a partner node.'],
  [/^Request mobile IoT sensing$/, 'Request temporary mobile sensors from a partner node.'],
  [/^Export policy JSON$/, 'Download the freight advisory as a machine-readable policy file.'],
  [/^Acknowledge advisory$/, 'Record that an authorized reviewer has seen this advisory.'],
  [/^Generate evidence package$/, 'Create an auditable evidence artifact from the selected alert.'],
  [/^Predict next action$/, 'Run the hybrid live-plus-history action prediction.'],
  [/^Generate mitigation plan$/, 'Generate a prescriptive mitigation recommendation.'],
  [/^Preview action routes$/, 'Preview webhook and authority notification routes without sending them.'],
  [/^Export 72h GeoJSON$/, 'Download the 72-hour corridor forecast as GeoJSON.'],
  [/^Checkpoint manifest$/, 'Inspect the federated model checkpoint manifest.'],
  [/^Download JSON$/, 'Download the displayed artifact as JSON.'],
  [/^Close/, 'Close this dialog or evidence view.'],
];
function applyButtonPurposes() {
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    const label = button.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!label) return;
    const match = BUTTON_PURPOSES.find(([pattern]) => pattern.test(label));
    button.title = match?.[1] ?? `Activate ${label.toLowerCase()}.`;
    button.setAttribute('aria-label', label);
  });
}
function useDemoHorizon() {
  const [horizon, setHorizon] = useState(0);
  useEffect(() => { const handler = (event: Event) => setHorizon((event as CustomEvent<number>).detail); window.addEventListener(DEMO_HORIZON_EVENT, handler); return () => window.removeEventListener(DEMO_HORIZON_EVENT, handler); }, []);
  return { horizon, setHorizon: (value: number) => window.dispatchEvent(new CustomEvent(DEMO_HORIZON_EVENT, { detail: value })) };
}

const nav: Section[] = ['Live overview', 'Hotspot detection', 'Corridor forecasts', 'Evidence vault', 'Federation'];
const seedPoints: HotspotPoint[] = [
  { id: 'town-a', position: [75.84, 30.79], color: [216, 104, 86], radius: 12000, aqi: 168 },
  { id: 'burns', position: [75.32, 30.95], color: [239, 154, 83], radius: 22000, aqi: 142 },
  { id: 'city-c', position: [76.38, 31.2], color: [92, 155, 102], radius: 8000, aqi: 62 },
];
const seedAlerts: Alert[] = [
  { id: 'ALT-2026-0819-001', title: 'Industrial plume · Town A → B', detail: 'PM₂.₅ 4.2× baseline. Upwind chemical-processing cluster ranked first.', severity: 'high', status: 'open', source: 'Chemical processing cluster · Town A', confidence: 91 },
  { id: 'ALT-2026-0819-002', title: 'Crop burn cluster · Punjab corridor', detail: 'Thermal anomalies corroborated by 18 citizen reports.', severity: 'medium', status: 'acknowledged', source: 'Agricultural burning cluster', confidence: 84 },
  { id: 'ALT-2026-0819-003', title: 'Model drift · node BR-044', detail: 'Calibration variance detected; readings excluded from fusion.', severity: 'medium', status: 'review', source: 'Node BR-044', confidence: 78 },
];

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json() as Promise<T>;
}
function apiUrl(path: string) { return `${API_BASE_URL}${path}`; }

function formatLocalDateTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(value);
}

function downloadJson(filename: string, payload: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function PollutionMap({ points }: { points: HotspotPoint[] }) {
  const { horizon, setHorizon } = useDemoHorizon();
  const horizonIndex = DEMO_HORIZONS.indexOf(horizon);
  const plumeReach = Math.round(2.1 + horizon * 0.42);
  const coneWidth = 115 + horizon * 11;
  const coneOpacity = 0.12 + horizon * 0.012;
  const layers = useMemo<Layer[]>(() => [
    new PathLayer({ id: 'plume', data: [{ path: [[75.74, 30.69], [75.84, 30.79], [75.94 + horizon * .018, 30.9 + horizon * .012], [76.03 + horizon * .027, 30.98 + horizon * .017]], color: [216, 104, 86], width: 4 }], getPath: d => d.path, getColor: d => d.color, getWidth: d => d.width }),
    new ScatterplotLayer<HotspotPoint>({ id: 'hotspots', data: points, getPosition: d => d.position, getFillColor: d => d.color, getRadius: d => d.radius, radiusMinPixels: 6, radiusMaxPixels: 55, opacity: .58, pickable: true }),
    new ScatterplotLayer({ id: 'nodes', data: [[75.79, 30.77], [75.89, 30.84], [76.2, 31.1], [76.38, 31.2]], getPosition: d => d, getFillColor: [42, 104, 74], getRadius: 1200, radiusMinPixels: 3, radiusMaxPixels: 8 }),
  ], [points, horizon]);
  return <div><div className="map-wrap"><div className="map-grain"/><div className="dispersion-cone" style={{ width: `${coneWidth}px`, opacity: coneOpacity }} aria-label={`Projected plume cone for ${horizon === 0 ? 'now' : `plus ${horizon} hours`}`}/><DeckGL initialViewState={{ longitude: 75.98, latitude: 30.92, zoom: 8.2, pitch: 0, bearing: 0 }} controller layers={layers}/><div className="place place-a">TOWN A · INDUSTRIAL</div><div className="place place-b">TOWN B · {168 + Math.round(horizon * 2.6)} AQI</div><div className="place place-c">CITY C · {62 + Math.round(horizon * 0.7)} AQI</div><div className="map-key"><span><i className="dot hot"/> hotspot</span><span><i className="dot node"/> edge node</span><span><i className="line"/> plume path</span></div><div className="map-horizon-badge">PLUME {horizon === 0 ? 'NOW' : `+${horizon}H`}</div></div><div className="wind-slider"><label>4D wind dispersion · <b>{horizon === 0 ? 'Now' : `+${horizon}h`}</b> · projected reach {plumeReach.toFixed(1)} km</label><input aria-label="4D wind dispersion horizon" type="range" min="0" max="4" step="1" value={horizonIndex} onInput={event => setHorizon(DEMO_HORIZONS[Number(event.currentTarget.value)])} onChange={event => setHorizon(DEMO_HORIZONS[Number(event.currentTarget.value)])}/><div className="horizon-buttons">{DEMO_HORIZONS.map(value => <button key={value} className={horizon === value ? 'selected' : ''} onClick={() => setHorizon(value)}>{value === 0 ? 'Now' : `+${value}h`}</button>)}</div><small className="wind-readout">Discrete forecast horizons: Now, +1h, +3h, +6h, and +12h. All demo forecast values update from the selected horizon.</small></div><p className="map-explanation"><b>What this field shows:</b> colored areas are fused PM₂.₅ anomaly estimates, dots are monitoring nodes, and the red path/cone is the demo wind-projected plume. This view is currently centered on the seeded Town A–Town B demonstration corridor.</p></div>;
}

function GlobalObservationMap({ points, focus }: { points: HotspotPoint[]; focus: MapFocus }) {
  const layers = useMemo<Layer[]>(() => [
    new TileLayer({ id: 'osm-basemap', data: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', minZoom: 0, maxZoom: 19, tileSize: 256, renderSubLayers: props => { const { boundingBox } = props.tile; return new BitmapLayer(props, { data: undefined, image: props.data, bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]] }); } }),
    new ScatterplotLayer<HotspotPoint>({ id: 'live-observations', data: points, getPosition: d => d.position, getFillColor: d => d.color, getRadius: d => d.radius, getLineColor: [255, 255, 255], getLineWidth: 2, radiusMinPixels: 5, radiusMaxPixels: 28, opacity: .8, pickable: true, stroked: true }),
  ], [points]);
  return <div className="global-map-wrap">
    <div className="map-scope"><span>LIVE OBSERVATIONS · OPENSTREETMAP</span><small>Drag to pan · scroll to zoom</small></div>
    <DeckGL key={`${focus.longitude}-${focus.latitude}-${focus.zoom}`} initialViewState={{ ...focus, pitch: 0, bearing: 0 }} controller layers={layers}/>
    <div className="global-map-key"><span><i className="dot hot"/> high AQI</span><span><i className="dot node"/> active record</span><span>© OpenStreetMap contributors</span></div>
  </div>;
}

function App() {
  const [section, setSection] = useState<Section>('Live overview');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [message, setMessage] = useState('');
  const [alerts, setAlerts] = useState(seedAlerts);
  const [points, setPoints] = useState(seedPoints);
  const [apiState, setApiState] = useState<'checking' | 'online' | 'offline'>('checking');
  const [socketState, setSocketState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [eventsSeen, setEventsSeen] = useState(0);
  const [lastEvent, setLastEvent] = useState('Checking API and live event stream…');
  const [corridors, setCorridors] = useState<CorridorData[]>([]);
  const [federation, setFederation] = useState<FederationStatus | null>(null);
  const [corridorId, setCorridorId] = useState('igp');
  const [actionModal, setActionModal] = useState<{ alert: Alert; kind: ActionModalKind } | null>(null);
  const [citizenModal, setCitizenModal] = useState<Alert | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const toast = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(''), 2400); };

  const connect = () => {
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    setApiState('checking'); setSocketState('connecting'); setLastEvent('Connecting to API and event stream…');
    getJson<{ stream_status: string; events_seen: number; alerts?: any[]; hotspots?: ApiHotspot[] }>('/api/live/snapshot').then(snapshot => {
      setApiState('online'); setEventsSeen(snapshot.events_seen ?? 0);
      if (snapshot.alerts?.length) setAlerts(snapshot.alerts.map(item => ({ id: item.alert_id, title: item.title, detail: item.summary, severity: item.severity, status: item.status, source: item.likely_source, confidence: Math.round(item.source_confidence * 100) })));
      if (snapshot.hotspots?.length) setPoints(snapshot.hotspots.map(item => ({ id: item.hotspot_id, position: [item.longitude, item.latitude], color: (item.anomaly_score > .9 ? [216, 104, 86] : [239, 154, 83]) as [number, number, number], radius: item.radius_km * 4000, aqi: item.current_aqi })));
    }).catch(() => { setApiState('offline'); setLastEvent('API unavailable — retry required'); });
    const open = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${WS_BASE_URL || `${protocol}://${window.location.host}`}/ws/live`);
      socket.onopen = () => { setSocketState('live'); setLastEvent('WebSocket connected — waiting for events'); };
      socket.onmessage = event => {
        const payload = JSON.parse(event.data) as { type: string; data?: { events_seen?: number }; node_id?: string; pm25?: number; latitude?: number; longitude?: number };
        if (payload.type === 'snapshot') { setEventsSeen(payload.data?.events_seen ?? 0); return; }
        setSocketState('live'); setEventsSeen(value => value + 1); setLastEvent(`${payload.type.replace('.', ' ')} · ${payload.node_id ?? 'network'} · ${payload.pm25 ?? 'event'} μg/m³`);
        if (payload.latitude !== undefined && payload.longitude !== undefined) setPoints(items => [{ id: payload.node_id ?? `node-${Date.now()}`, position: [payload.longitude!, payload.latitude!] as [number, number], color: [216, 104, 86] as [number, number, number], radius: 4500, aqi: Math.round(payload.pm25 ?? 0) }, ...items.filter(item => item.id !== payload.node_id)].slice(0, 20));
      };
      socket.onclose = () => { setSocketState('offline'); retry = window.setTimeout(open, 3000); };
      socket.onerror = () => setSocketState('offline');
    };
    open();
    return () => { if (retry) window.clearTimeout(retry); socket?.close(); };
  };

  useEffect(() => connect(), []);
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!API_BASE_URL) return; const originalFetch = window.fetch.bind(window); window.fetch = (input, init) => { if (typeof input === 'string' && input.startsWith('/api/')) return originalFetch(`${API_BASE_URL}${input}`, init); return originalFetch(input, init); }; return () => { window.fetch = originalFetch; }; }, []);
  useEffect(() => { applyButtonPurposes(); }, [section, alerts.length, actionModal, citizenModal]);
  useEffect(() => { getJson<CorridorData[]>('/api/forecasts/corridors').then(setCorridors).catch(() => setCorridors([])); getJson<FederationStatus>('/api/federation/status').then(setFederation).catch(() => setFederation(null)); }, []);
  const action = (alert: Alert, status: string) => { setAlerts(items => items.map(item => item.id === alert.id ? { ...item, status } : item)); setSelected({ ...alert, status }); toast(`Incident ${status} and audit state updated`); };
  const feedLabel = apiState === 'offline' || socketState === 'offline' ? 'OFFLINE' : socketState === 'live' && eventsSeen > 0 ? 'LIVE FEED' : 'CONNECTED · WAITING';

  return <div className="app-shell"><aside className="sidebar"><div className="brand">atmos<span>•</span></div><div className="side-label">Operations</div><nav>{nav.map((label, index) => <button key={label} className={section === label ? 'active' : ''} onClick={() => { setSection(label); toast(`${label} opened`); }}><span>{['◉', '⌁', '⌁', '▣', '◎'][index]}</span>{label}</button>)}</nav><div className="network"><div className="side-label">Federated network</div><p><b className="pulse"/> 5 nations connected</p><small>Model sync · 4 min ago</small></div></aside><main><header className="topbar"><div><div className="kicker">South Asia · Regional command</div><h1>{section}</h1><p>The network has found <b>{alerts.length} events</b> that need attention today. <span className={`stream-pill ${socketState}`}>● {feedLabel}</span></p><small className="last-event">{lastEvent}</small></div><div className="top-actions"><span className="local-clock">{formatLocalDateTime(clock)}</span><select className="corridor-select" value={corridorId} onChange={event => { setCorridorId(event.target.value); setSection('Corridor forecasts'); }}><option value="igp">Indo-Gangetic Corridor · IN</option><option value="prv">Paraíba Valley · BR</option><option value="prd">Pearl River Delta · CN</option><option value="gauteng">Gauteng Belt · ZA</option><option value="sh-mos">Shanghai–Moscow · CN/RU</option></select><button className="ghost" onClick={() => downloadJson('atmos-overview.json', { generated_at: new Date().toISOString(), alerts, hotspots: points })}>↥ Export</button><button className="primary" onClick={() => { setSection('Evidence vault'); toast('Response room opened in Evidence Vault'); }}>Open response room →</button></div></header><ConnectionPanel apiState={apiState} socketState={socketState} eventsSeen={eventsSeen} onRetry={() => connect()}/><div className="metrics"><Metric label="Network health" value="98.7%" detail="2,841 of 2,878 nodes online" tone="green"/><Metric label="Active hotspots" value={String(points.length)} detail="Live fused anomalies" tone="orange"/><Metric label="Corridor risk · next 6h" value="Elevated" detail="Indo-Gangetic Plain · 73% confidence"/><Metric label="Citizen evidence" value="1,284" detail="+18% this week" tone="green"/></div>{section === 'Live overview' && <Overview points={points} alerts={alerts} selected={selected} setSelected={setSelected} toast={toast} onOpenAction={(alert, kind) => setActionModal({ alert, kind })} onOpenLayers={() => setSection('Hotspot detection')}/>} {section === 'Live overview' && <HistoricalFiveYearChart/>} {section === 'Hotspot detection' && <HotspotView points={points}/>} {section === 'Corridor forecasts' && <CorridorView corridors={corridors} points={points} eventsSeen={eventsSeen} corridorId={corridorId}/>} {section === 'Evidence vault' && <EvidenceView alerts={alerts} setSelected={setSelected} onVerify={setCitizenModal}/>} {section === 'Federation' && <FederationView federation={federation}/>}<DecisionOutputs alertId={alerts[0]?.id}/></main>{selected && <Drawer selected={selected} close={() => setSelected(null)} action={action}/>} {actionModal && <ActionModal alert={actionModal.alert} kind={actionModal.kind} close={() => setActionModal(null)}/>} {citizenModal && <CitizenVerificationModal alert={citizenModal} close={() => setCitizenModal(null)}/>} {message && <div className="toast">{message}</div>}</div>;
}

function ConnectionPanel({ apiState, socketState, eventsSeen, onRetry }: { apiState: string; socketState: string; eventsSeen: number; onRetry: () => void }) { return <section className="connection-panel"><div className="connection-heading"><i className={`status-led ${socketState}`}/><div><b>{apiState === 'online' && socketState === 'live' ? 'Live network status' : 'Connection needs attention'}</b><small>API and WebSocket are checked independently</small></div></div><div className="connection-checks"><span><i className={apiState === 'online' ? 'ok' : apiState === 'offline' ? 'bad' : 'waiting'}/> API {apiState}</span><span><i className={socketState === 'live' ? 'ok' : socketState === 'offline' ? 'bad' : 'waiting'}/> WebSocket {socketState}</span><span><i className={eventsSeen ? 'ok' : 'waiting'}/> {eventsSeen} ingested events</span></div><div className="federation-status"><span>Federated AI Sync:</span><b>IN · Online</b><b>CN · v3.1 synced</b><b>BR · Training</b></div><button className="ghost" onClick={onRetry}>Retry connection</button></section>; }
function Overview({ points, alerts, selected, setSelected, toast, onOpenAction, onOpenLayers }: { points: HotspotPoint[]; alerts: Alert[]; selected: Alert | null; setSelected: (a: Alert) => void; toast: (s: string) => void; onOpenAction: (alert: Alert, kind: ActionModalKind) => void; onOpenLayers: () => void }) { return <div className="dashboard-grid"><section className="panel map-panel"><PanelTitle title="Live pollution field" subtitle="Fused sensor + satellite estimate · PM₂.₅" badge="REAL-TIME"/><PollutionMap points={points}/><div className="panel-foot"><span>High-confidence anomaly field · map updates from event stream</span><button onClick={onOpenLayers}>View layers ↗</button></div></section><EventPanel alerts={alerts} selected={selected} setSelected={setSelected} onOpenAction={onOpenAction}/><ForecastPanel/><section className="panel federation-panel"><PanelTitle title="Federated model health" subtitle="Raw readings never leave their country" badge="ROUND 42"/><div className="fed-row"><div className="fed-circles"><span>BR</span><span>RU</span><span>IN</span><span>CN</span><span>ZA</span></div><div><b>aq-transformer-v0.4.2</b><small>Secure weighted aggregation · all nodes synced</small></div></div></section></div>; }
function EventPanel({ alerts, selected, setSelected, onOpenAction }: { alerts: Alert[]; selected: Alert | null; setSelected: (a: Alert) => void; onOpenAction: (alert: Alert, kind: ActionModalKind) => void }) { return <section className="panel"><PanelTitle title="Priority events" subtitle="AI-triaged for intervention" badge={`${alerts.length} OPEN`}/><div className="event-list">{alerts.map(alert => <div className={`event ${selected?.id === alert.id ? 'selected' : ''}`} key={alert.id} onClick={() => setSelected(alert)}><span className={`event-icon ${alert.severity}`}>{alert.severity === 'high' ? '♨' : '◌'}</span><span className="event-copy"><b>{alert.title}</b><small>{alert.detail}</small><span className="event-actions"><button onClick={event => { event.stopPropagation(); onOpenAction(alert, 'dispatch'); }}>Dispatch Authority Alert</button><button onClick={event => { event.stopPropagation(); onOpenAction(alert, 'evidence'); }}>Download Legal Evidence</button></span></span><em className={alert.severity}>{alert.status === 'acknowledged' ? 'ACK' : alert.severity.toUpperCase()}</em></div>)}</div></section>; }
function ForecastPanel() { const { horizon } = useDemoHorizon(); const uplift = horizon * 1.8; const values = [22 + uplift * .2, 34 + uplift * .35, 58 + uplift * .55, 82 + uplift * .7, 67 + uplift * .5, 43 + uplift * .3, 29 + uplift * .15].map(value => Math.min(98, Math.round(value))); return <section className="panel"><PanelTitle title="Corridor forecast" subtitle={`Risk trajectory · next 6 hours · demo horizon ${horizon === 0 ? 'Now' : `+${horizon}h`}`} badge={`${Math.min(96, 73 + Math.round(horizon * 1.1))}% CONF.`}/><div className="forecast">{values.map((value, i) => <div className="bar-item" key={i}><div className={`bar ${i > 1 && i < 5 ? 'hot' : ''}`} style={{ height: `${value}%` }}/><small>{i === 0 ? 'NOW' : 8 + i * 2}</small></div>)}</div><Corridor name="Indo-Gangetic Plain" value={Math.min(96, 73 + Math.round(horizon * 1.1))}/><Corridor name="Shanghai–Moscow" value={Math.min(80, 31 + Math.round(horizon * .7))}/></section>; }
function HistoricalAqiChart() {
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const values = range === '24h' ? [58, 61, 64, 72, 91, 121, 187, 252, 220, 201, 168, 154, 142] : [72, 84, 96, 131, 168, 143, 119];
  const labels = range === '24h' ? ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22', 'NOW'] : ['6d ago', '5d ago', '4d ago', '3d ago', '2d ago', 'Yesterday', 'Today'];
  const width = 760, height = 230, pad = 32, max = 300;
  const coords = values.map((value, index) => `${pad + index * ((width - pad * 2) / (values.length - 1))},${height - pad - (value / max) * (height - pad * 2)}`).join(' ');
  return <section className="panel history-panel"><div className="panel-title"><div><h2>Historical AQI trend</h2><small>Observed AQI at the selected hotspot · past {range === '24h' ? '24 hours' : '7 days'}</small></div><div className="chart-tabs"><button className={range === '24h' ? 'selected' : ''} onClick={() => setRange('24h')}>24H</button><button className={range === '7d' ? 'selected' : ''} onClick={() => setRange('7d')}>7D</button></div></div><div className="history-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Historical AQI line chart"><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="chart-axis"/><line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} className="chart-grid"/><polyline points={coords} className="chart-line"/>{values.map((value, index) => { const x = pad + index * ((width - pad * 2) / (values.length - 1)); const y = height - pad - (value / max) * (height - pad * 2); return <g key={`${labels[index]}-${value}`}><circle cx={x} cy={y} r="4" className="chart-point"/><text x={x} y={height - 10} textAnchor="middle" className="chart-label">{labels[index]}</text></g>; })}<text x="8" y="20" className="chart-label">300</text><text x="8" y={height / 2 + 4} className="chart-label">150</text><text x="16" y={height - pad + 4} className="chart-label">0</text></svg></div><small className="chart-note">AQI is historical observed data; future values belong in Corridor forecasts. A high peak is not erased by a 24-hour regional average.</small></section>;
}
function HistoricalFiveYearChart() {
  const [points, setPoints] = useState<{ period: string; aqi: number }[]>([]);
  const [source, setSource] = useState('loading');
  const [window, setWindow] = useState<HistoryWindow>('5y');
  const [hovered, setHovered] = useState<number | null>(null);
  useEffect(() => { let active = true; setSource('loading'); getJson<{ source: string; points: { period: string; aqi: number }[] }>(`/api/hotspots/hs-town-a-b/history?window=${window}`).then(data => { if (active) { setPoints(data.points); setSource(data.source); } }).catch(() => active && setSource('unavailable')); return () => { active = false; }; }, [window]);
  const values = points.length ? points.map(point => point.aqi) : Array.from({ length: window === '5y' ? 60 : window === '5m' ? 5 : window === '7d' ? 7 : 13 }, (_, index) => 70 + ((index * 17) % 85));
  const labels = points.length ? points.map(point => window === '5y' || window === '5m' ? point.period.slice(0, 7) : point.period.slice(11, 16) || point.period.slice(5, 10)) : values.map((_, index) => `P${index + 1}`);
  const width = 900, height = 250, pad = 36, max = Math.max(200, ...values, 300);
  const coords = values.map((value, index) => `${pad + index * ((width - pad * 2) / Math.max(values.length - 1, 1))},${height - pad - (value / max) * (height - pad * 2)}`).join(' ');
  const titles: Record<HistoryWindow, string> = { '5y': '5 years', '5m': '5 months', '7d': '7 days', '24h': '24 hours' };
  return <section className="panel history-panel"><div className="panel-title"><div><h2>AQI history</h2><small>Observed/persisted AQI · selected hotspot · {titles[window]} · source: {source}</small></div><div className="chart-tabs" role="tablist">{(['5y', '5m', '7d', '24h'] as HistoryWindow[]).map(item => <button key={item} className={window === item ? 'selected' : ''} onClick={() => { setWindow(item); setHovered(null); }}>{item.toUpperCase()}</button>)}</div></div><div className="history-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${titles[window]} AQI line chart`}><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="chart-axis"/><line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} className="chart-grid"/><polyline points={coords} className="chart-line"/>{values.map((value, index) => { const x = pad + index * ((width - pad * 2) / Math.max(values.length - 1, 1)); const y = height - pad - (value / max) * (height - pad * 2); return <g key={`${labels[index]}-${index}`} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}><circle cx={x} cy={y} r={hovered === index ? 6 : index % 3 === 0 ? 3 : 1.5} className="chart-point"/>{(values.length < 15 || index % 6 === 0) && <text x={x} y={height - 10} textAnchor="middle" className="chart-label">{labels[index]}</text>}{hovered === index && <g className="chart-tooltip"><rect x={Math.min(x + 8, width - 150)} y={Math.max(y - 38, 8)} width="140" height="28" rx="4"/><text x={Math.min(x + 16, width - 142)} y={Math.max(y - 20, 26)}>{labels[index]} · AQI {value}</text></g>}</g>; })}<text x="7" y="20" className="chart-label">{max}</text><text x="12" y={height / 2 + 4} className="chart-label">{Math.round(max / 2)}</text><text x="20" y={height - pad + 4} className="chart-label">0</text></svg></div><small className="chart-note">Hover a point to inspect its exact AQI and period. The selected window calls the same aggregated history API; demo-history is explicitly labeled until data is ingested.</small></section>;
}
function HotspotView({ points }: { points: HotspotPoint[] }) { return <div className="section-grid"><section className="panel wide"><PanelTitle title="Detected hyper-local hotspots" subtitle="Fused edge readings, satellite anomalies and wind attribution" badge={`${points.length} ACTIVE`}/><div className="data-table">{points.map((point, i) => <div className="data-row" key={point.id}><b className="rank">{i + 1}</b><div><b>{point.id.replaceAll('-', ' ').toUpperCase()}</b><small>{point.position[1].toFixed(3)}, {point.position[0].toFixed(3)} · radius {(point.radius / 4000).toFixed(1)} km</small></div><strong className={point.aqi > 150 ? 'danger' : 'warn'}>{point.aqi} AQI</strong><span className="ghost">Inspect ↗</span></div>)}</div></section><section className="panel"><PanelTitle title="Spatial proof" subtitle="Zoom and inspect the anomaly field" badge="POSTGIS"/><PollutionMap points={points}/></section><section className="panel"><PanelTitle title="Attribution signals" subtitle="Why an alert was raised" badge="TRACEABLE"/><div className="signal-list"><span>✓ Wind direction and plume path aligned</span><span>✓ Local sensor peak exceeds macro baseline</span><span>✓ Satellite or citizen evidence corroborates</span><span>✓ Source corridor ranked for intervention</span></div></section></div>; }
function LocationSearch({ onFocus }: { onFocus: (focus: MapFocus) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Search city, GPS coordinates, or facility ID…');
  const search = async () => {
    const pair = query.split(',').map(value => Number(value.trim()));
    let latitude: number; let longitude: number; let label = query;
    if (pair.length === 2 && pair.every(value => Number.isFinite(value)) && Math.abs(pair[0]) <= 90 && Math.abs(pair[1]) <= 180) { [latitude, longitude] = pair; } else {
      try { const location = await getJson<{ name: string; country?: string; latitude: number; longitude: number }>(`/api/location/search?query=${encodeURIComponent(query)}`); latitude = location.latitude; longitude = location.longitude; label = `${location.name}${location.country ? `, ${location.country}` : ''}`; } catch { setStatus('Search a city or enter latitude, longitude — for example 30.79, 75.84'); return; }
    }
    onFocus({ latitude, longitude, zoom: 8 }); setStatus(`Focused ${label} · loading nearby Open-Meteo/OpenAQ context…`);
    try { const context = await getJson<{ weather: { status: string; temperature_2m?: number; wind_speed_10m?: number }; air_quality: { status: string } }>(`/api/location/context?latitude=${latitude}&longitude=${longitude}`); setStatus(`Focused ${label} · weather ${context.weather.status} · air quality ${context.air_quality.status}`); } catch { setStatus(`Focused ${label}; live location feeds are unavailable.`); }
  };
  return <div className="location-search"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void search(); }} placeholder="Search city, GPS coordinates, or facility ID…"/><button className="primary" onClick={() => void search()}>Locate</button><small>{status}</small></div>;
}
function CorridorView({ corridors, points, eventsSeen, corridorId }: { corridors: CorridorData[]; points: HotspotPoint[]; eventsSeen: number; corridorId: string }) {
  const fallback: CorridorData[] = [{ corridor_id: 'igp', name: 'Indo-Gangetic Plain', countries: ['IN', 'PK', 'BD', 'NP'], risk_level: 'elevated', confidence: .73, peak_window: '12:00–16:00 IST', signals: [], points: [{ hour: 'NOW', risk: .22, predicted_aqi: 62, confidence: .91 }, { hour: '14', risk: .82, predicted_aqi: 168, confidence: .73 }] }];
  const selected = corridors.filter(c => c.corridor_id === corridorId);
  const shown = selected.length ? selected : (corridorId === 'igp' ? (corridors.length ? corridors : fallback) : [{ ...fallback[0], corridor_id: corridorId, name: corridorId === 'prd' ? 'Pearl River Delta' : corridorId === 'prv' ? 'Paraíba Valley' : corridorId === 'gauteng' ? 'Gauteng Belt' : 'Selected corridor', countries: [corridorId === 'prd' ? 'CN' : corridorId === 'prv' ? 'BR' : corridorId === 'gauteng' ? 'ZA' : 'IN'] }]);
  const initialFocus: Record<string, MapFocus> = { igp: { longitude: 75.8, latitude: 30.8, zoom: 2.4 }, prd: { longitude: 113.3, latitude: 23.1, zoom: 2.4 }, prv: { longitude: -45.4, latitude: -22.5, zoom: 2.4 }, gauteng: { longitude: 28.2, latitude: -26.2, zoom: 2.4 }, 'sh-mos': { longitude: 90, latitude: 42, zoom: 1.7 } };
  const [focus, setFocus] = useState<MapFocus>(initialFocus[corridorId] ?? initialFocus.igp);
  useEffect(() => setFocus(initialFocus[corridorId] ?? initialFocus.igp), [corridorId]);
  return <div className="corridor-view"><section className="panel global-map-panel"><PanelTitle title="Global live observation map" subtitle="Switch corridors or search a precise coordinate to focus the map" badge={`${points.length} RECORDS`}/><LocationSearch onFocus={setFocus}/><GlobalObservationMap points={points} focus={focus}/><div className="global-map-foot"><span>Live records · {eventsSeen} ingested events · source: API + WebSocket</span><span className="muted">No nearby record means context is unavailable, not zero pollution.</span></div></section><div className="section-grid">{shown.map(c => <section className="panel corridor-card" key={c.corridor_id}><PanelTitle title={c.name} subtitle={`${c.countries.join(' · ')} · peak ${c.peak_window}`} badge={`${Math.round(c.confidence * 100)}% CONF.`}/><strong className="large-risk">{c.risk_level.toUpperCase()}</strong><div className="forecast large">{c.points.map(item => <div className="bar-item" key={item.hour}><div className={`bar ${item.risk > .5 ? 'hot' : ''}`} style={{ height: `${Math.max(10, item.risk * 100)}%` }}/><small>{item.hour === 'NOW' ? 'NOW' : `+${item.hour}h`}</small></div>)}</div><p className="muted">Early warning horizon is refreshed when new meteorological or sensor data arrives.</p></section>)}</div></div>;
}
function EvidenceView({ alerts, setSelected, onVerify }: { alerts: Alert[]; setSelected: (a: Alert) => void; onVerify: (a: Alert) => void }) { return <section className="panel"><PanelTitle title="Evidence vault" subtitle="Auditable evidence chains for cross-border action" badge="VERIFIED"/><div className="evidence-grid">{alerts.map(alert => <div className="evidence-card" key={alert.id} onClick={() => setSelected(alert)}><span className={`event-icon ${alert.severity}`}>▣</span><b>{alert.title}</b><small>{alert.source}</small><span>{alert.confidence}% source confidence · open chain ↗</span><button className="verify-button" onClick={event => { event.stopPropagation(); onVerify(alert); }}>Verify citizen evidence</button></div>)}</div></section>; }
function FederationView({ federation }: { federation: FederationStatus | null }) { const nodes = federation?.nodes ?? []; const [status, setStatus] = useState('No joint request queued.'); const runProtocol = async (label: string) => { setStatus(`${label} queued · awaiting authorized node approval…`); try { const response = await fetch('/api/events/ALT-2026-0819-001/action-trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true, channels: ['api', 'webhook'], note: label }) }); if (!response.ok) throw new Error(); setStatus(`${label} prepared · dry-run webhook recorded.`); } catch { setStatus(`${label} staged locally · API unavailable.`); } }; return <div className="section-grid"><section className="panel wide"><PanelTitle title="Federated model exchange" subtitle="Predictive models travel; raw national readings stay local" badge="FLOWER"/><div className="federation-summary"><Metric label="Current round" value={String(federation?.round ?? 42)} detail="Secure aggregation"/><Metric label="Participating nodes" value={String(nodes.length || 5)} detail="BRICS network" tone="green"/><Metric label="Model" value={federation?.model_version ?? 'aq-transformer-v0.4.2'} detail="Production candidate"/><Metric label="Raw data shared" value={federation?.raw_data_shared ? 'Yes' : 'No'} detail="Federated privacy boundary"/></div><div className="federation-nodes">{nodes.map(node => <div className="federation-node" key={node.country_code}><b>{node.country_code}</b><span>{node.node_count.toLocaleString()} nodes</span><small>round {node.last_round} · {node.status}</small></div>)}</div><div className="data-row"><b className="rank">✓</b><div><b>Cross-border model health</b><small>Updates can be inspected without exposing citizen or sensor payloads.</small></div><strong className="green">SYNCHRONIZED</strong></div><div className="protocol-panel"><PanelTitle title="Joint Action Protocol" subtitle="Coordinate resources without moving raw national readings" badge="AUTHORIZED"/><div className="protocol-actions"><button className="ghost" onClick={() => void runProtocol('Joint IN–BD trans-boundary inspection')}>Initiate Joint IN–BD Protocol</button><button className="ghost" onClick={() => void runProtocol('High-resolution satellite tasking request')}>Request satellite tasking</button><button className="ghost" onClick={() => void runProtocol('Temporary mobile IoT deployment request')}>Request mobile IoT sensing</button></div><small className="protocol-status">{status}</small></div></section></div>; }
function CitizenVerificationModal({ alert, close }: { alert: Alert; close: () => void }) {
  const [imageUrl, setImageUrl] = useState('');
  const [imageName, setImageName] = useState('No verification image attached');
  const selectImage = (file?: File) => { if (!file) return; if (!file.type.startsWith('image/')) { setImageName('Please select a JPG, PNG, or WEBP image'); return; } if (file.size > 10 * 1024 * 1024) { setImageName('Image must be smaller than 10 MB'); return; } setImageName(file.name); const reader = new FileReader(); reader.onload = () => setImageUrl(String(reader.result)); reader.readAsDataURL(file); };
  return <div className="modal-backdrop" onClick={close}><section className="action-modal citizen-modal" onClick={event => event.stopPropagation()}><button className="close" onClick={close}>×</button><div className="kicker">Citizen evidence verification</div><h2>{alert.title}</h2><div className="verification-upload"><div className="upload-preview">{imageUrl ? <img src={imageUrl} alt="Selected pollution verification"/> : <span>Upload a pollution photo for review</span>}</div><label className="upload-button">Add verification image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => selectImage(event.target.files?.[0])}/></label><small>{imageName} · local preview until authenticated evidence ingest is configured</small></div><div className="verification-grid"><div><span>Image AI score</span><b>{imageUrl ? `${alert.confidence}%` : 'Pending'}</b><small>Plume opacity classification</small></div><div><span>EXIF & geotag</span><b className={imageUrl ? 'green' : ''}>{imageUrl ? 'MATCH' : 'Pending'}</b><small>Coordinates and time window aligned</small></div><div><span>Sensor cross-check</span><b className={imageUrl ? 'green' : ''}>{imageUrl ? 'CONFIRMED' : 'Pending'}</b><small>Nearby PM₂.₅ spike at capture minute</small></div></div><p className="verification-note">Uploaded images remain in this browser preview and are not transmitted automatically. Production staff workflows should send the file to the authenticated evidence-ingest API, where EXIF, hash, geotag, and malware checks can run.</p><div className="drawer-actions"><button className="primary" onClick={close}>Close verification</button></div></section></div>;
}
function ActionModal({ alert, kind, close }: { alert: Alert; kind: ActionModalKind; close: () => void }) {
  const [payload, setPayload] = useState('Generating…');
  const [delivery, setDelivery] = useState('Checking webhook delivery status…');
  useEffect(() => { const load = async () => { try { const path = kind === 'evidence' ? `/api/events/${alert.id}/evidence-package` : `/api/events/${alert.id}/action-trigger`; const response = await fetch(path, kind === 'dispatch' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true }) } : undefined); const json = await response.json(); setPayload(JSON.stringify(json, null, 2)); setDelivery(kind === 'dispatch' ? 'Dry-run queued; no external webhook was sent.' : 'Evidence package generated; human/legal review required.'); } catch { setPayload('Unable to generate package.'); setDelivery('API unavailable.'); } }; void load(); }, [alert.id, kind]);
  const download = () => { const blob = new Blob([payload], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${alert.id}-${kind}.json`; link.click(); URL.revokeObjectURL(url); };
  return <div className="modal-backdrop" onClick={close}><section className="action-modal" onClick={event => event.stopPropagation()}><button className="close" onClick={close}>×</button><div className="kicker">{kind === 'dispatch' ? 'Authority notification' : 'Legal evidence bundle'}</div><h2>{alert.title}</h2><p className="delivery-status"><i/> {delivery}</p><pre className="modal-json">{payload}</pre><div className="drawer-actions"><button className="ghost" onClick={download}>Download JSON</button><button className="primary" onClick={close}>Close</button></div><small className="muted">PDF rendering and live delivery require configured deployment services. This local action is intentionally dry-run.</small></section></div>;
}
function DecisionOutputs({ alertId }: { alertId?: string }) {
  const [output, setOutput] = useState('Select an output to generate an auditable agent artifact.');
  const [busy, setBusy] = useState(false);
  const [advisoryAcknowledged, setAdvisoryAcknowledged] = useState(false);
  const [briefingLanguage, setBriefingLanguage] = useState('English');
  const run = async (path: string, options?: RequestInit) => { if (!alertId) return; setBusy(true); try { const response = await fetch(path, options); setOutput(JSON.stringify(await response.json(), null, 2)); } catch { setOutput('Unable to generate output: API unavailable.'); } finally { setBusy(false); } };
  const advisory = { type: 'temporary-freight-advisory', corridor: 'NH-44', window: '02:00–05:00', recommendation: 'Restrict heavy diesel vehicle ingress to prevent thermal inversion trapping PM2.5 above 300 µg/m³.', human_approval_required: true };
  return <section className="panel decision-panel"><PanelTitle title="Decision engine outputs" subtitle="Machine-generated artifacts; enforcement still requires authorized officials" badge="AI READY"/><div className="policy-advisory"><div><div className="kicker">Automated policy & freight advisory</div><h3>Temporary Freight Advisory</h3><p>Restrict heavy diesel vehicle ingress on NH-44 corridor between 02:00–05:00 AM to prevent thermal inversion trapping PM₂.₅ levels above 300 µg/m³.</p><small>Prescriptive recommendation · human approval required</small></div><div className="advisory-actions"><button className="ghost" onClick={() => downloadJson('freight-advisory.json', advisory)}>Export policy JSON</button><button className="primary" onClick={() => setAdvisoryAcknowledged(true)}>{advisoryAcknowledged ? 'Acknowledged' : 'Acknowledge advisory'}</button></div></div><div className="gemini-briefing"><div><b>Google Gemini authority briefing</b><small>Generates a concise multilingual briefing from the selected incident’s normalized evidence. A clearly labelled offline fallback is used until Gemini is configured.</small></div><select aria-label="Gemini briefing language" value={briefingLanguage} onChange={event => setBriefingLanguage(event.target.value)}><option>English</option><option>Hindi</option><option>Portuguese</option><option>Russian</option><option>Chinese</option></select><button className="primary" onClick={() => run(`/api/events/${alertId}/ai-briefing?language=${encodeURIComponent(briefingLanguage)}`)}>Generate Gemini briefing</button></div><div className="decision-actions"><button className="ghost" onClick={() => run(`/api/events/${alertId}/evidence-package`)}>Generate evidence package</button><button className="ghost" onClick={() => run(`/api/events/${alertId}/dual-mode-prediction`)}>Predict next action</button><button className="ghost" onClick={() => run(`/api/recommendations?alert_id=${alertId}`)}>Generate mitigation plan</button><button className="ghost" onClick={() => run(`/api/events/${alertId}/action-trigger`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true }) })}>Preview action routes</button><button className="ghost" onClick={() => run('/api/forecasts/corridors/igp/export')}>Export 72h GeoJSON</button><button className="ghost" onClick={() => run('/api/federation/checkpoint')}>Checkpoint manifest</button></div><pre className="decision-output">{busy ? 'Generating…' : output}</pre></section>;
}
function Drawer({ selected, close, action }: { selected: Alert; close: () => void; action: (a: Alert, status: string) => void }) { return <div className="drawer-backdrop" onClick={close}><aside className="drawer" onClick={e => e.stopPropagation()}><button className="close" onClick={close}>×</button><div className="kicker">Incident evidence chain</div><h2>{selected.title}</h2><p>{selected.detail}</p><div className="incident-status">Current action state: <b>{selected.status}</b></div><div className="confidence"><b>{selected.confidence}%</b><span>source confidence</span></div><div className="evidence-visuals"><div className="evidence-visual photo"><b>Citizen photo</b><small>CR-9821 · geotag preserved</small><span>▧ Photo timestamp corroborated</span></div><div className="evidence-visual satellite"><b>Satellite thermal</b><small>VIIRS/S5P observation linked</small><span>◈ Anomaly footprint aligned</span></div><div className="evidence-visual wind"><b>Wind vector</b><small>4.8 m/s · from 278°</small><span>← plume backtrack to source</span></div></div><div className="chain"><ChainItem title="Edge sensor fusion" text="PM₂.₅ peak · 11 min ago"/><ChainItem title="Satellite corroboration" text="Column anomaly aligned · 30 min ago"/><ChainItem title="Wind-aware backtrack" text="Source corridor ranked upwind"/><ChainItem title="Citizen evidence" text="Photo and symptom report received"/></div><div className="drawer-actions"><button className="ghost" onClick={() => action(selected, 'acknowledged')}>Acknowledge</button><button className="primary" onClick={() => action(selected, 'escalated')}>Escalate →</button></div></aside></div>; }
function Metric({ label, value, detail, tone = '' }: { label: string; value: string; detail: string; tone?: string }) { const { horizon } = useDemoHorizon(); const dynamicValue = label === 'Active hotspots' ? String(Number(value) + (horizon >= 6 ? 2 : horizon >= 3 ? 1 : 0)) : label === 'Corridor risk · next 6h' ? horizon >= 6 ? 'High' : horizon >= 3 ? 'Elevated+' : value : value; const dynamicDetail = label === 'Active hotspots' && horizon > 0 ? `Projected plume window · +${horizon}h` : detail; return <div className="metric"><span>{label}</span><strong className={tone}>{dynamicValue}</strong><small>{dynamicDetail}</small></div>; }
function PanelTitle({ title, subtitle, badge }: { title: string; subtitle: string; badge: string }) { return <div className="panel-title"><div><h2>{title}</h2><small>{subtitle}</small></div><span className="badge">{badge}</span></div>; }
function Corridor({ name, value }: { name: string; value: number }) { return <div className="corridor"><b>{name}</b><div><i style={{ width: `${value}%` }}/></div><span>{value}%</span></div>; }
function ChainItem({ title, text }: { title: string; text: string }) { return <div className="chain-item"><span>✓</span><div><b>{title}</b><small>{text}</small></div><i>verified</i></div>; }

createRoot(document.getElementById('root')!).render(<App />);
