"""Bridge normalized Kafka events into the live API and PostGIS writer."""
import asyncio
import json
import os

import httpx
from aiokafka import AIOKafkaConsumer, TopicPartition


async def start_reader(bootstrap: str, topic: str) -> AIOKafkaConsumer:
    """Use direct partition assignment by default for the local one-broker stack."""
    group_id = os.getenv("ATMOS_LIVE_CONSUMER_GROUP", "").strip() or None
    # Topic subscription and manual assignment cannot be mixed in aiokafka.
    consumer = AIOKafkaConsumer(topic, bootstrap_servers=bootstrap, group_id=group_id, auto_offset_reset="latest") if group_id else AIOKafkaConsumer(bootstrap_servers=bootstrap, group_id=None, auto_offset_reset="latest")
    await consumer.start()
    if group_id is None:
        partitions = consumer.partitions_for_topic(topic)
        if partitions is None:
            raise RuntimeError(f"Kafka topic metadata unavailable for {topic}")
        consumer.assign([TopicPartition(topic, partition) for partition in partitions])
    return consumer


async def run():
    consumer = await start_reader(os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"), "atmos.normalized.events")
    api_url = os.getenv("ATMOS_API_URL", "http://localhost:8000")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            async for message in consumer:
                payload = json.loads(message.value)
                source = payload.pop("source", "sensor")
                await client.post(f"{api_url}/api/internal/live-event", json={"source": source, "payload": payload})
    finally:
        await consumer.stop()


if __name__ == "__main__":
    asyncio.run(run())
