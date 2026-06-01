import subprocess
from pathlib import Path


def extract_audio_from_video(
    video_path: str,
    output_audio_path: str,
) -> str | None:
    output_path = Path(output_audio_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    command = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(output_path),
    ]

    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if result.returncode != 0 or not output_path.exists():
        return None

    return str(output_path)


def extract_frames_from_video(
    video_path: str,
    output_frames_dir: str,
    frame_rate: float = 1.0,
    max_frames: int = 20,
    max_width: int = 640,
) -> list[str]:
    frames_dir = Path(output_frames_dir)
    frames_dir.mkdir(parents=True, exist_ok=True)

    output_pattern = str(frames_dir / "frame_%05d.jpg")

    vf_filter = f"fps={frame_rate},scale='min({max_width},iw)':-2"

    command = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vf",
        vf_filter,
        "-frames:v",
        str(max_frames),
        output_pattern,
    ]

    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if result.returncode != 0:
        return []

    return sorted(str(path) for path in frames_dir.glob("frame_*.jpg"))
