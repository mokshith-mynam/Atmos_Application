import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

class MockWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(_url: string) {
    queueMicrotask(() => this.onopen?.());
  }

  close() {
    this.onclose?.();
  }
}

Object.defineProperty(window, 'WebSocket', { value: MockWebSocket, writable: true });
Object.defineProperty(globalThis, 'WebSocket', { value: MockWebSocket, writable: true });

const jsonResponse = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
}));

vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
  const url = String(input);
  if (url.includes('/api/live/snapshot')) return jsonResponse({ stream_status: 'waiting', events_seen: 0, alerts: [], hotspots: [] });
  if (url.includes('/api/forecasts/corridors')) return jsonResponse([]);
  if (url.includes('/api/federation/status')) return jsonResponse({ round: 42, model_version: 'aq-transformer-v0.4.2', raw_data_shared: false, nodes: [{ country_code: 'IN', node_count: 2841, model_version: 'aq-transformer-v0.4.2', last_round: 42, privacy: 'federated', status: 'active' }] });
  if (url.includes('/history')) return jsonResponse({ source: 'demo-history', points: [{ period: '2026-01-01', aqi: 120 }, { period: '2026-02-01', aqi: 132 }] });
  return jsonResponse({});
}));
