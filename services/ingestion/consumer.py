"""Kafka ingestion worker for raw, timestamp-preserving observations."""
import asyncio
import json
import os
from datetime import datetime, timezone

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer, TopicPartition
from aiokafka.admin import AIOKafkaAdminClient, NewTopic
from aiokafka.errors import TopicAlreadyExistsError


TOPICS = ("atmos.sensor.readings", "atmos.citizen.reports", "atmos.satellite.observations", "atmos.weather.vectors")
NORMALIZED_TOPIC = "atmos.normalized.events"


def normalize(raw: dict) -> dict:
    raw["ingested_at"] = datetime.now(timezone.utc).isoformat()
    raw["schema_version"] = raw.get("schema_version", "atmos.event.v1")
    raw["event_time"] = raw.get("observed_at") or raw.get("captured_at") or raw["ingested_at"]
    return raw


async def ensure_topics(bootstrap: str) -> None:
    """Create application topics before joining a consumer group.

    This removes the startup race on a fresh single-broker Kafka instance.
    Kafka's internal __consumer_offsets topic is created by the broker with
    replication factor one from the Compose configuration.
    """
    admin = AIOKafkaAdminClient(bootstrap_servers=bootstrap, client_id="atmos-topic-init")
    await admin.start()
    try:
        topics = [NewTopic(name=name, num_partitions=1, replication_factor=1) for name in (*TOPICS, NORMALIZED_TOPIC)]
        try:
            await admin.create_topics(topics)
        except TopicAlreadyExistsError:
            pass
    finally:
        await admin.close()


async def start_reader(bootstrap: str, topics: tuple[str, ...]) -> AIOKafkaConsumer:
    """Start a reader without requiring a group coordinator in local mode."""
    group_id = os.getenv("ATMOS_CONSUMER_GROUP", "").strip() or None
    # Passing topics subscribes the consumer; manual assignment must construct
    # the consumer without topic arguments because the modes are exclusive.
    consumer = AIOKafkaConsumer(*topics, bootstrap_servers=bootstrap, group_id=group_id, auto_offset_reset="latest") if group_id else AIOKafkaConsumer(bootstrap_servers=bootstrap, group_id=None, auto_offset_reset="latest")
    await consumer.start()
    if group_id is None:
        assignments = []
        for topic in topics:
            partitions = consumer.partitions_for_topic(topic)
            if partitions is None:
                raise RuntimeError(f"Kafka topic metadata unavailable for {topic}")
            assignments.extend(TopicPartition(topic, partition) for partition in partitions)
        consumer.assign(assignments)
    return consumer


async def run() -> None:
    bootstrap = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    for attempt in range(1, 13):
        try:
            await ensure_topics(bootstrap)
            break
        except Exception as error:
            if attempt == 12:
                raise
            print(f"Kafka is not ready yet ({attempt}/12): {error}", flush=True)
            await asyncio.sleep(5)
    consumer = await start_reader(bootstrap, TOPICS)
    producer = AIOKafkaProducer(bootstrap_servers=bootstrap)
    await producer.start()
    try:
        async for message in consumer:
            payload = normalize(json.loads(message.value))
            await producer.send_and_wait(NORMALIZED_TOPIC, json.dumps(payload).encode())
    finally:
        await consumer.stop(); await producer.stop()


if __name__ == "__main__":
    asyncio.run(run())
