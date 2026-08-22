"""Live source adapters.

Each adapter publishes a versioned event to Kafka. Provider credentials and
endpoints are environment variables so national feeds can be swapped without
changing the event model.
"""
import asyncio
import json
import os
from datetime import datetime, timezone

import httpx
from aiokafka import AIOKafkaProducer


async def poll_json_feed(producer: AIOKafkaProducer, url: str, topic: str):
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(url)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, list):
            items = payload
        else:
            items = payload.get("data", [payload])
        for item in items:
            item.update({"schema_version": "atmos.event.v1", "source": topic.split(".")[1], "ingested_at": datetime.now(timezone.utc).isoformat()})
            await producer.send_and_wait(topic, json.dumps(item).encode())


async def run():
    bootstrap = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    producer = AIOKafkaProducer(bootstrap_servers=bootstrap)
    await producer.start()
    try:
        jobs = []
        for env, topic in [("SENSOR_FEED_URL", "atmos.sensor.readings"), ("WEATHER_FEED_URL", "atmos.weather.vectors")]:
            if os.getenv(env):
                jobs.append(poll_json_feed(producer, os.environ[env], topic))
        if jobs:
            await asyncio.gather(*jobs)
    finally:
        await producer.stop()


if __name__ == "__main__":
    asyncio.run(run())
