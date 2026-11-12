
"""BabyEye manual, guarded per-user head fine-tuning.

Run from training-worker:

python -m app.workers.train_personalized_heads inspect --job-id N --user-id U

python -m app.workers.train_personalized_heads train --job-id N --user-id U --modality audio --device cpu

This file intentionally NEVER changes DB state or promotes checkpoints
to live inference.

Requires genuine labeled samples; rejects known mock users and
synthetic markers.
"""

import argparse
import json
import os
import random

from collections import Counter
from pathlib import Path

import torch

from app.database import engine
from app.services.personalized_head_store import (
    load_active_head,
    active_path,
)


ROOT = Path(
    os.getenv("INFERENCE_DATA_DIR", "/app/uploads/inference")
).resolve()

STAGING = Path(
    os.getenv("TRAINING_DATA_DIR", "/app/training-data")
).resolve()

WEIGHTS = Path("/app/weights")


from app.services.training_policy import (
    LABELS, AUDIO_MAP, VISION_MAP, LABEL_ALIASES, TrainingPolicy,
    normalize_feedback_label, entries, job_spec, distribution_is_trainable,
)
from app.services.training_data_service import (
    get_rows as validated_rows, get_job, safe_path,
)

AUDIO_LABELS = LABELS["audio"]
IMAGE_LABELS = LABELS["vision"]


def get_rows(job_id, user_id):
    return validated_rows(job_id, user_id, root=ROOT, db_engine=engine)


# ============================================================
# Inspect
# ============================================================

def inspect(rows, stable_vision_as_normal):

    print(
        "Total reserved real feedbacks:",
        len(rows),
    )

    print(
        "Fused feedback distribution:",
        dict(
            Counter(
                r["label"]
                for r in rows
            )
        ),
    )

    for mod in ["audio", "vision"]:

        items, labels = entries(
            rows,
            mod,
            stable_vision_as_normal,
        )

        print(
            mod,
            "usable:",
            len(items),
            "targets:",
            dict(
                Counter(
                    labels[y]
                    for _, _, y in items
                )
            ),
        )

    print(
        "No DB update, no training "
        "and no checkpoint promotion performed"
    )


# ============================================================
# Feature extraction
# ============================================================

def extract(mod, items, device, max_audio_seconds):
    """Extract detached CPU features using the original preprocessing."""

    feats = []
    ys = []
    ids = []

    if mod == "audio":

        import librosa

        from transformers import (
            Wav2Vec2FeatureExtractor,
            WavLMForSequenceClassification,
        )

        root = WEIGHTS / "wavlm_model"

        extractor = Wav2Vec2FeatureExtractor.from_pretrained(
            str(root)
        )

        model = WavLMForSequenceClassification.from_pretrained(
            str(root),
            num_labels=len(AUDIO_LABELS),
            id2label={
                i: v
                for i, v in enumerate(AUDIO_LABELS)
            },
            label2id={
                v: i
                for i, v in enumerate(AUDIO_LABELS)
            },
            ignore_mismatched_sizes=True,
        ).to(device).eval()

        head = model.classifier

        initial_w = head.weight.detach().cpu().clone()
        initial_b = head.bias.detach().cpu().clone()

        for rid, path, label in items:

            try:
                wav, _ = librosa.load(
                    str(path),
                    sr=16000,
                    mono=True,
                )

                if (
                    len(wav) < 1600
                    or len(wav) > int(max_audio_seconds * 16000)
                ):
                    print(
                        "SKIP audio duration:",
                        rid,
                        f"{len(wav) / 16000:.1f}s",
                    )
                    continue

                inputs = extractor(
                    wav,
                    sampling_rate=16000,
                    return_tensors="pt",
                    padding=True,
                )

                with torch.no_grad():

                    hidden = model.wavlm(
                        inputs.input_values.to(device)
                    )[0]

                    if hasattr(model, "projector"):
                        hidden = model.projector(hidden)

                    pooled = (
                        hidden[:, 0, :]
                        if hidden.dim() == 3
                        else hidden
                    )

                    f = pooled.squeeze(0).float().cpu()

                if (
                    f.ndim == 1
                    and f.numel() == head.in_features
                    and torch.isfinite(f).all()
                ):
                    feats.append(f)
                    ys.append(label)
                    ids.append(rid)

            except (OSError, ValueError, RuntimeError) as exc:
                print(
                    "SKIP audio decode/feature:",
                    rid,
                    str(exc)[:160],
                )

    else:

        from PIL import Image
        from torchvision import models, transforms

        model = models.efficientnet_v2_s(
            weights=None
        )

        n_in = model.classifier[1].in_features

        model.classifier[1] = torch.nn.Linear(
            n_in,
            len(IMAGE_LABELS),
        )

        state = torch.load(
            str(WEIGHTS / "efficientnet_best.pth"),
            map_location="cpu",
            weights_only=True,
        )

        model.load_state_dict(
            state,
            strict=True,
        )

        model = model.to(device).eval()

        head = model.classifier[1]

        initial_w = head.weight.detach().cpu().clone()
        initial_b = head.bias.detach().cpu().clone()

        transform = transforms.Compose(
            [
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=[0.485, 0.456, 0.406],
                    std=[0.229, 0.224, 0.225],
                ),
            ]
        )

        for rid, path, label in items:

            try:
                with Image.open(path) as im:
                    x = transform(
                        im.convert("RGB")
                    ).unsqueeze(0).to(device)

                with torch.no_grad():

                    f = model.features(x)

                    f = model.avgpool(f)

                    f = torch.flatten(f, 1)

                    f = model.classifier[0](
                        f
                    ).squeeze(0).float().cpu()

                if (
                    f.ndim == 1
                    and f.numel() == head.in_features
                    and torch.isfinite(f).all()
                ):
                    feats.append(f)
                    ys.append(label)
                    ids.append(rid)

            except (OSError, ValueError, RuntimeError) as exc:
                print(
                    "SKIP image decode/feature:",
                    rid,
                    str(exc)[:160],
                )

    del model

    if device.type == "cuda":
        torch.cuda.empty_cache()

    if not feats:
        raise RuntimeError(
            "No decodable features"
        )

    return (
        torch.stack(feats),
        torch.tensor(ys, dtype=torch.long),
        ids,
        initial_w,
        initial_b,
    )


# ============================================================
# Stratified train/validation split
# ============================================================

def stratified_split(ys, seed, min_per_class=None):
    minimum = TrainingPolicy.from_env().min_per_class if min_per_class is None else min_per_class
    TrainingPolicy(minimum)
    if len(set(ys.tolist())) < 2:
        raise RuntimeError("At least two decoded target classes required for stratified validation")

    rng = random.Random(seed)

    train = []
    val = []

    for y in sorted(set(ys.tolist())):

        idx = [
            i
            for i, v in enumerate(ys.tolist())
            if v == y
        ]

        if len(idx) < minimum:
            raise RuntimeError(
                f"Need >={minimum} genuine examples PER target class "
                "(stratified validation)"
            )

        rng.shuffle(idx)

        n_val = max(
            1,
            round(len(idx) * 0.25),
        )

        val.extend(idx[:n_val])
        train.extend(idx[n_val:])

    rng.shuffle(train)

    return train, val


# ============================================================
# Metrics
# ============================================================

def metrics(head, X, y, indexes):

    with torch.no_grad():

        logits = head(X[indexes])
        target = y[indexes]

        loss = torch.nn.functional.cross_entropy(
            logits,
            target,
        ).item()

        correct = (
            logits.argmax(dim=1) == target
        ).float().mean().item()

    return {
        "cross_entropy": round(loss, 5),
        "accuracy": round(correct, 4),
        "n": len(indexes),
    }


# ============================================================
# Training
# ============================================================

def train(args, rows, policy=None):
    policy = policy or TrainingPolicy(TrainingPolicy.from_env().min_per_class, args.stable_vision_as_normal)

    items, labels = entries(
        rows,
        args.modality,
        policy.stable_vision_as_normal,
    )

    distribution = Counter(
        labels[y]
        for _, _, y in items
    )

    print(
        "Eligible before feature decoding:",
        len(items),
        dict(distribution),
    )

    if not distribution_is_trainable(distribution, policy.min_per_class):
        raise RuntimeError(
            f"Need >=2 mapped classes and >={policy.min_per_class} samples per class. "
            "No model is written."
        )

    device = torch.device(args.device)

    if (
        device.type == "cuda"
        and not torch.cuda.is_available()
    ):
        raise RuntimeError(
            "CUDA unavailable; try --device cpu"
        )

    torch.manual_seed(args.seed)

    X, y, ids, w0, b0 = extract(
        args.modality,
        items,
        device,
        args.max_audio_seconds,
    )

    # Start from the latest APPROVED personalized head.
    # If none exists, keep the original base-model head.
    approved_head = load_active_head(
        args.user_id,
        args.modality,
        reference=(w0, b0),
    )

    training_parent = "base_model"

    if approved_head is not None:
        w0 = approved_head["weight"].clone()
        b0 = approved_head["bias"].clone()

        training_parent = str(
            active_path(args.user_id, args.modality)
        )

        print(
            "Continuing from approved personalized head:",
            training_parent,
        )
    else:
        print(
            "No approved personalized head; "
            "starting from base model"
        )

    actual = Counter(
        labels[i]
        for i in y.tolist()
    )

    print(
        "Decoded features:",
        tuple(X.shape),
        "labels:",
        dict(actual),
    )

    if not distribution_is_trainable(actual, policy.min_per_class):
        raise RuntimeError("Decoded samples no longer meet the persisted training policy; no candidate written")
    tr, va = stratified_split(
        y,
        args.seed,
        policy.min_per_class,
    )

    # Train only the head.
    # Preserve pretrained output dimensions and base logits.

    head = torch.nn.Linear(
        X.shape[1],
        len(labels),
    )

    with torch.no_grad():
        head.weight.copy_(w0)
        head.bias.copy_(b0)

    baseline = metrics(
        head,
        X,
        y,
        va,
    )

    optimizer = torch.optim.AdamW(
        head.parameters(),
        lr=args.lr,
        weight_decay=0.0,
    )

    for epoch in range(args.epochs):

        head.train()

        for offset in range(
            0,
            len(tr),
            args.batch_size,
        ):

            ids_batch = tr[
                offset:offset + args.batch_size
            ]

            logits = head(
                X[ids_batch]
            )

            loss = torch.nn.functional.cross_entropy(
                logits,
                y[ids_batch],
            )

            penalty = (
                ((head.weight - w0) ** 2).mean()
                + ((head.bias - b0) ** 2).mean()
            )

            loss = loss + args.anchor * penalty

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

        print(
            "epoch",
            epoch + 1,
            "train_loss",
            round(float(loss.detach()), 5),
        )

    head.eval()

    updated = metrics(
        head,
        X,
        y,
        va,
    )

    print(
        "BASELINE HOLDOUT:",
        baseline,
    )

    print(
        "CANDIDATE HOLDOUT:",
        updated,
    )

    if (
        updated["cross_entropy"] > baseline["cross_entropy"]
        or updated["accuracy"] < baseline["accuracy"]
    ):
        raise RuntimeError(
            "Candidate worse on holdout: "
            "checkpoint rejected"
        )

    if (
        not torch.isfinite(head.weight).all()
        or not torch.isfinite(head.bias).all()
    ):
        raise RuntimeError(
            "Non-finite checkpoint rejected"
        )

    directory = STAGING / f"job_{args.job_id}"

    directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    file = directory / (
        f"candidate_{args.modality}_head.pt"
    )

    if file.exists():
        raise RuntimeError(
            "Candidate already exists; will not overwrite"
        )

    tmp = directory / (
        f".candidate_{args.modality}_head.tmp"
    )

    torch.save(
        {
            "weight": head.weight.detach().clone(),
            "bias": head.bias.detach().clone(),
        },
        tmp,
    )

    os.replace(
        tmp,
        file,
    )

    report = {
        "job_id": args.job_id,
        "initial_head_source": training_parent,
        "user_id": args.user_id,
        "modality": args.modality,
        "training_policy": policy.snapshot(),
        "candidate": str(file),
        "mapped_labels": dict(actual),
        "train_n": len(tr),
        "val_n": len(va),
        "baseline": baseline,
        "candidate_result": updated,
        "trained_ids": len(ids),
        "note": (
            "Not promoted. Validation is small; "
            "use independent real-world test before deployment."
        ),
    }

    report_file = directory / (
        f"candidate_{args.modality}_report.json"
    )

    report_file.write_text(
        json.dumps(
            report,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        "CANDIDATE ONLY:",
        file,
    )

    print(
        "REPORT:",
        report_file,
    )

    print(
        "No live weights or DB statuses changed."
    )


# ============================================================
# CLI
# ============================================================

def main():

    p = argparse.ArgumentParser()

    p.add_argument(
        "action",
        choices=["inspect", "train"],
    )

    p.add_argument(
        "--job-id",
        type=int,
        required=True,
    )

    p.add_argument(
        "--user-id",
        type=int,
        required=True,
    )

    p.add_argument(
        "--modality",
        choices=["audio", "vision"],
        default="audio",
    )

    p.add_argument(
        "--device",
        choices=["cpu", "cuda"],
        default="cpu",
    )

    p.add_argument(
        "--stable-vision-as-normal",
        action="store_true",
        help=(
            "Experimental ambiguous mapping; "
            "avoid without review"
        ),
    )

    p.add_argument(
        "--epochs",
        type=int,
        default=5,
    )

    p.add_argument(
        "--batch-size",
        type=int,
        default=4,
    )

    p.add_argument(
        "--lr",
        type=float,
        default=1e-4,
    )

    p.add_argument(
        "--anchor",
        type=float,
        default=0.1,
    )

    p.add_argument(
        "--max-audio-seconds",
        type=float,
        default=10.0,
    )

    p.add_argument(
        "--seed",
        type=int,
        default=17,
    )

    args = p.parse_args()

    if (
        args.job_id < 1
        or args.user_id < 1
        or not (1 <= args.epochs <= 30)
        or not (1 <= args.batch_size <= 32)
        or not (0 < args.lr <= 1e-2)
    ):
        p.error(
            "Invalid training parameters"
        )

    job = get_job(args.job_id, args.user_id, db_engine=engine)
    modalities, policy = job_spec(job)
    if modalities is None:
        # Preserve the manual opt-in flag for legacy jobs.
        policy = TrainingPolicy(policy.min_per_class, args.stable_vision_as_normal)
    elif args.action == "train" and args.modality not in modalities:
        p.error("Requested modality is not authorized by this job")
    rows = get_rows(args.job_id, args.user_id)

    if args.action == "inspect":
        inspect(
            rows,
            policy.stable_vision_as_normal,
        )
    else:
        train(
            args,
            rows,
            policy,
        )


if __name__ == "__main__":
    main()
