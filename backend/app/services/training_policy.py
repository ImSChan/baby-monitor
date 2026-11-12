"""Lightweight policy shared by job creation, preflight and head-only training."""
import os
from collections import Counter
from dataclasses import dataclass

LEGACY_MIN_PER_CLASS = 4  # Compatibility floor for pre-policy jobs only.

LABELS = {
    "audio": ["belly pain", "burping", "cold_hot", "discomfort", "hungry", "laugh", "tired"],
    "vision": ["happy", "normal", "unhappy"],
}
AUDIO_MAP = {"feeding": "hungry", "sleep": "tired"}
VISION_MAP = {"care": "unhappy"}
LABEL_ALIASES = {
    "feeding": "feeding", "hungry": "feeding", "배고픔": "feeding", "배고파요": "feeding",
    "sleep": "sleep", "tired": "sleep", "졸림": "sleep", "졸려요": "sleep", "잠와요": "sleep",
    "잠": "sleep", "피곤": "sleep", "피곤함": "sleep",
    "care": "care", "discomfort": "care", "불편함": "care",
    "stable": "stable", "안정": "stable", "안정 상태": "stable",
}


def normalize_feedback_label(value):
    return LABEL_ALIASES.get(str(value or "").strip().lower())


def true_flag(value):
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class TrainingPolicy:
    min_per_class: int = 3
    stable_vision_as_normal: bool = False

    def __post_init__(self):
        if type(self.min_per_class) is not int or self.min_per_class < 3:
            raise ValueError("TRAINING_MIN_PER_CLASS must be an integer >= 3")
        if type(self.stable_vision_as_normal) is not bool:
            raise ValueError("stable_vision_as_normal must be boolean")

    @classmethod
    def from_env(cls):
        return cls(int(os.getenv("TRAINING_MIN_PER_CLASS", "3")),
            true_flag(os.getenv("AUTO_TRAIN_STABLE_VISION_AS_NORMAL", "false")))

    def snapshot(self):
        return {"version": 1, "min_per_class": self.min_per_class,
                "stable_vision_as_normal": self.stable_vision_as_normal}


def job_spec(job):
    """NULL/NULL is a legacy job; never infer a new modality from current data."""
    if job.modalities is None and job.training_policy is None:
        current = TrainingPolicy.from_env()
        return None, TrainingPolicy(max(LEGACY_MIN_PER_CLASS, current.min_per_class), current.stable_vision_as_normal)
    mods, data = job.modalities, job.training_policy
    if (not isinstance(mods, list) or not mods or len(mods) != len(set(mods))
            or any(mod not in LABELS for mod in mods) or not isinstance(data, dict)
            or data.get("version") != 1):
        raise ValueError("Invalid persisted training job specification")
    return tuple(mods), TrainingPolicy(data.get("min_per_class"), data.get("stable_vision_as_normal"))


def entries(rows, modality, stable_vision_as_normal=False):
    if modality not in LABELS:
        raise ValueError("Unsupported training modality")
    mapping = dict(AUDIO_MAP if modality == "audio" else VISION_MAP)
    if modality == "vision" and stable_vision_as_normal:
        mapping["stable"] = "normal"
    labels = LABELS[modality]
    items = []
    for row in rows:
        target = mapping.get(row["label"])
        file = row[modality]
        if target and file:
            items.append((row["id"], file, labels.index(target)))
    return items, labels


def class_counts(rows, modality, policy):
    items, labels = entries(rows, modality, policy.stable_vision_as_normal)
    return Counter(labels[label] for _, _, label in items)


def distribution_is_trainable(counts, min_per_class):
    return len(counts) >= 2 and min(counts.values()) >= min_per_class
