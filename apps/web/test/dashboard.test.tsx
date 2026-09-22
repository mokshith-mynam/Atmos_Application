import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The dashboard layers need a WebGL canvas in production. These lightweight
// mocks keep the test focused on the user interface and API integration.
vi.mock('@deck.gl/react', () => ({ default: () => null }));
vi.mock('@deck.gl/geo-layers', () => ({ TileLayer: class TileLayer { constructor(_props: unknown) {} } }));
vi.mock('@deck.gl/layers', () => ({
  BitmapLayer: class BitmapLayer { constructor(_props: unknown) {} },
  PathLayer: class PathLayer { constructor(_props: unknown) {} },
  ScatterplotLayer: class ScatterplotLayer { constructor(_props: unknown) {} },
}));

beforeAll(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  await import('../src/main');
});

describe('authority dashboard', () => {
  it('renders the live overview and asks for its dashboard data', async () => {
    expect(await screen.findByRole('heading', { name: 'Live overview' })).toBeInTheDocument();
    expect(screen.getByText('Network health')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open response room →' })).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/live/snapshot'));
  });

  it('opens the federation view and renders its coordination controls', async () => {
    await userEvent.click(screen.getByRole('button', { name: /Federation$/ }));

    expect(await screen.findByText('Federated model exchange')).toBeInTheDocument();
    expect(screen.getByText('Joint Action Protocol')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request satellite tasking' })).toBeInTheDocument();
  });
});
