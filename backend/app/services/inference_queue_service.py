import json
import os
from typing import Any

import redis


REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

INFERENCE_QUEUE = "inference_jobs"
STATUS_KEY_PREFIX = "inference_status:"
RESULT_KEY_PREFIX = "inference_result:"


redis_client = redis.from_url(
    REDIS_URL,
    decode_responses=True,
)


def enqueue_inference_job(job: dict[str, Any]) -> None:
    request_id = job["request_id"]

    set_job_status(
        request_id=request_id,
        status="queued",
        message="분석 대기열에 등록되었습니다.",
    )

    redis_client.lpush(INFERENCE_QUEUE, json.dumps(job, ensure_ascii=False))


def pop_inference_job(timeout: int = 5) -> dict[str, Any] | None:
    item = redis_client.brpop(INFERENCE_QUEUE, timeout=timeout)

    if item is None:
        return None

    _, raw_job = item
    return json.loads(raw_job)


def set_job_status(
    request_id: str,
    status: str,
    message: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    payload = {
        "requestId": request_id,
        "status": status,
        "message": message,
    }

    if extra:
        payload.update(extra)

    redis_client.set(
        STATUS_KEY_PREFIX + request_id,
        json.dumps(payload, ensure_ascii=False),
        ex=60 * 60 * 24,
    )


def get_job_status(request_id: str) -> dict[str, Any] | None:
    value = redis_client.get(STATUS_KEY_PREFIX + request_id)

    if value is None:
        return None

    return json.loads(value)


def set_job_result(request_id: str, result: dict[str, Any]) -> None:
    redis_client.set(
        RESULT_KEY_PREFIX + request_id,
        json.dumps(result, ensure_ascii=False),
        ex=60 * 60 * 24,
    )


def get_job_result(request_id: str) -> dict[str, Any] | None:
    value = redis_client.get(RESULT_KEY_PREFIX + request_id)

    if value is None:
        return None

    return json.loads(value)