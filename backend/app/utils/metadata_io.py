import json
import os
import tempfile
from pathlib import Path


def atomic_write_metadata(
    path: str | Path,
    metadata: dict,
) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=".metadata_",
            suffix=".tmp",
            delete=False,
        ) as temp:
            temp_path = Path(temp.name)

            json.dump(
                metadata,
                temp,
                ensure_ascii=False,
                indent=2,
            )

            temp.flush()
            os.fsync(temp.fileno())

        os.replace(temp_path, path)

    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)