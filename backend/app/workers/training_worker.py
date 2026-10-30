
import os
import time
import logging
from pathlib import Path

from sqlmodel import Session, select

from app.database import engine
from app.models import InferenceFeedback


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [TRAINING] %(levelname)s: %(message)s",
)

logger = logging.getLogger("training-worker")

TRAINING_DATA_DIR = Path(
    os.getenv("TRAINING_DATA_DIR", "/app/training-data")
)

USER_WEIGHTS_DIR = Path(
    os.getenv("USER_WEIGHTS_DIR", "/app/weights/users")
)

INFERENCE_DATA_DIR = Path(
    os.getenv("INFERENCE_DATA_DIR", "/app/uploads/inference")
)

TRAINING_THRESHOLD = int(
    os.getenv("TRAINING_THRESHOLD", "20")
)


def initialize_storage():
    """공유 학습 저장소 초기화 및 접근 확인."""

    TRAINING_DATA_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    USER_WEIGHTS_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    if not INFERENCE_DATA_DIR.is_dir():
        raise RuntimeError(
            f"Inference data directory not found: "
            f"{INFERENCE_DATA_DIR}"
        )

    logger.info("Training data: %s", TRAINING_DATA_DIR)
    logger.info("User weights: %s", USER_WEIGHTS_DIR)
    logger.info("Inference data: %s", INFERENCE_DATA_DIR)
    logger.info("Threshold: %s", TRAINING_THRESHOLD)


def check_database():
    """DB 연결 및 학습 대기 피드백 확인."""

    with Session(engine) as session:
        feedbacks = session.exec(
            select(InferenceFeedback).where(
                InferenceFeedback.training_status == "pending"
            )
        ).all()

        counts = {}

        for feedback in feedbacks:
            user_id = feedback.user_id
            counts[user_id] = counts.get(user_id, 0) + 1

        logger.info(
            "Total pending feedbacks: %s",
            len(feedbacks),
        )

        for user_id, count in sorted(counts.items()):
            logger.info(
                "User %s: %s/%s pending",
                user_id,
                count,
                TRAINING_THRESHOLD,
            )


def run_worker():
    logger.info("Training worker starting...")

    initialize_storage()

    logger.info("Checking database connection...")
    check_database()

    logger.info("Training worker ready.")
    logger.info(
        "Training execution is disabled in this stage."
    )

    # 현재 단계에서는 실제 학습을 실행하지 않는다.
    # 다음 단계에서 학습 작업 큐와 트리거를 구현한다.
    while True:
        time.sleep(30)


if __name__ == "__main__":
    run_worker()
