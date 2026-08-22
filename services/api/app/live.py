"""In-process live event hub for WebSocket fan-out."""
import asyncio
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket


class LiveHub:
    def __init__(self):
        self.clients: set[WebSocket] = set()
        self.last_event_at: datetime | None = None
        self.events_seen = 0
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            self.clients.add(websocket)

    async def disconnect(self, websocket: WebSocket):
        async with self._lock:
            self.clients.discard(websocket)

    def mark_event(self):
        self.last_event_at = datetime.now(timezone.utc)
        self.events_seen += 1

    async def broadcast(self, message: dict[str, Any]):
        dead: list[WebSocket] = []
        for client in list(self.clients):
            try:
                await client.send_json(message)
            except Exception:
                dead.append(client)
        for client in dead:
            await self.disconnect(client)


hub = LiveHub()
