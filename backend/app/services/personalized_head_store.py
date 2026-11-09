
"""Shared personalized classifier-head storage for BabyEye.

Candidate training artifacts live in /app/training-data/job_N/.
Active heads live in /app/weights/users/.

Promotion is explicit, never automatic.
"""

import argparse
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import torch


USER_WEIGHTS_DIR = Path(
    os.getenv("USER_WEIGHTS_DIR", "/app/weights/users")
).resolve()

TRAINING_DATA_DIR = Path(
    os.getenv("TRAINING_DATA_DIR", "/app/training-data")
).resolve()

LABELS = {
    "audio": [
        "belly pain",
        "burping",
        "cold_hot",
        "discomfort",
        "hungry",
        "laugh",
        "tired",
    ],
    "vision": [
        "happy",
        "normal",
        "unhappy",
    ],
}


def check_identity(user_id, modality):
    user_id = str(user_id)

    if not user_id.isdecimal() or int(user_id) < 1:
        raise ValueError("Invalid user_id")

    if modality not in LABELS:
        raise ValueError("Invalid modality")

    return user_id


def active_path(user_id, modality):
    user_id = check_identity(user_id, modality)

    # Compatible with the existing model_runtime.py filename.
    return USER_WEIGHTS_DIR / (
        f"{user_id}_{modality}_head.pt"
    )


def validate_head(data, modality, reference=None):
    if not isinstance(data, dict):
        raise ValueError("Checkpoint must be a dictionary")

    weight = data.get("weight")
    bias = data.get("bias")

    if not isinstance(weight, torch.Tensor):
        raise ValueError("Missing weight tensor")

    if not isinstance(bias, torch.Tensor):
        raise ValueError("Missing bias tensor")

    output_count = len(LABELS[modality])

    if weight.ndim != 2 or bias.ndim != 1:
        raise ValueError("Invalid head tensor dimensions")

    if weight.shape[0] != output_count:
        raise ValueError("Model output classes do not match")

    if bias.shape[0] != output_count:
        raise ValueError("Model bias classes do not match")

    if not weight.is_floating_point():
        raise ValueError("Weight must be floating point")

    if not bias.is_floating_point():
        raise ValueError("Bias must be floating point")

    if not torch.isfinite(weight).all().item():
        raise ValueError("Non-finite weight detected")

    if not torch.isfinite(bias).all().item():
        raise ValueError("Non-finite bias detected")

    if reference is not None:
        ref_weight, ref_bias = reference

        if weight.shape != ref_weight.shape:
            raise ValueError(
                "Personalized weight shape mismatch"
            )

        if bias.shape != ref_bias.shape:
            raise ValueError(
                "Personalized bias shape mismatch"
            )

    return {
        "weight": weight.detach().float().cpu().contiguous(),
        "bias": bias.detach().float().cpu().contiguous(),
    }


def read_checkpoint(path, modality, reference=None):
    checkpoint = torch.load(
        str(path),
        map_location="cpu",
        weights_only=True,
    )

    return validate_head(
        checkpoint,
        modality,
        reference=reference,
    )


def load_active_head(user_id, modality, reference=None):
    path = active_path(user_id, modality)

    if not path.is_file():
        return None

    return read_checkpoint(
        path,
        modality,
        reference=reference,
    )


def atomic_copy(source, destination):
    destination.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp = destination.with_name(
        destination.name + "." + uuid.uuid4().hex + ".tmp"
    )

    try:
        shutil.copyfile(source, temp)
        os.replace(temp, destination)
    finally:
        temp.unlink(missing_ok=True)


def promote_candidate(job_id, user_id, modality):
    user_id = check_identity(user_id, modality)

    if job_id < 1:
        raise ValueError("Invalid job_id")

    # Verify this job actually completed for this user.
    from sqlmodel import Session
    from app.database import engine
    from app.models import TrainingJob

    with Session(engine) as session:
        job = session.get(TrainingJob, job_id)

        if (
            job is None
            or int(job.user_id) != int(user_id)
            or job.status != "completed"
        ):
            raise RuntimeError(
                "Only completed jobs owned by this user "
                "can be promoted"
            )

    job_dir = TRAINING_DATA_DIR / f"job_{job_id}"

    candidate = job_dir / (
        f"candidate_{modality}_head.pt"
    )

    report_path = job_dir / (
        f"candidate_{modality}_report.json"
    )

    if not candidate.is_file():
        raise FileNotFoundError(candidate)

    if not report_path.is_file():
        raise FileNotFoundError(report_path)

    report = json.loads(
        report_path.read_text(encoding="utf-8")
    )

    if (
        int(report["job_id"]) != job_id
        or int(report["user_id"]) != int(user_id)
        or report["modality"] != modality
    ):
        raise RuntimeError("Training report mismatch")

    # Reject malformed checkpoints before promotion.
    validated = read_checkpoint(candidate, modality)

    versions_dir = (
        USER_WEIGHTS_DIR
        / user_id
        / modality
    )

    version_path = (
        versions_dir / f"head_job_{job_id}.pt"
    )

    if version_path.exists():
        raise FileExistsError(
            "This job was already promoted"
        )

    # Also reject promotion when another job has no known
    # archived version of an existing active checkpoint.
    active = active_path(user_id, modality)

    versions_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    if active.exists():
        existing = list(
            versions_dir.glob("head_job_*.pt")
        )
        if not existing:
            raise RuntimeError(
                "Legacy active checkpoint found. "
                "Back it up and review migration first."
            )

        # Verify the candidate is compatible with the
        # currently active head dimensions.
        current = read_checkpoint(active, modality)

        if current["weight"].shape != validated["weight"].shape:
            raise ValueError("Incompatible active head shape")

        if current["bias"].shape != validated["bias"].shape:
            raise ValueError("Incompatible active head bias")

    # Save immutable version first.
    # Exclusive creation avoids accidentally replacing it.
    with version_path.open("xb") as destination:
        with candidate.open("rb") as source:
            shutil.copyfileobj(source, destination)

    # Atomically replace the active checkpoint.
    atomic_copy(version_path, active)

    metadata = {
        "user_id": int(user_id),
        "modality": modality,
        "active_job_id": job_id,
        "version_file": str(version_path),
        "activated_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "labels": LABELS[modality],
    }

    metadata_path = versions_dir / "current.json"
    temp_metadata = versions_dir / (
        ".current." + uuid.uuid4().hex + ".tmp"
    )

    try:
        temp_metadata.write_text(
            json.dumps(
                metadata,
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        os.replace(temp_metadata, metadata_path)
    finally:
        temp_metadata.unlink(missing_ok=True)

    print("PROMOTED:", active)
    print("VERSION:", version_path)
    print("METADATA:", metadata_path)


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "action",
        choices=["promote"],
    )

    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument(
        "--modality",
        choices=["audio", "vision"],
        required=True,
    )

    parser.add_argument(
        "--approve",
        action="store_true",
        help="Explicitly approve production activation",
    )

    args = parser.parse_args()

    if not args.approve:
        parser.error(
            "Promotion requires --approve after "
            "independent model validation"
        )

    promote_candidate(
        args.job_id,
        args.user_id,
        args.modality,
    )


if __name__ == "__main__":
    main()
