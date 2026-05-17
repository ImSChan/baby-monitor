import subprocess
from pathlib import Path


def convert_audio_to_wav(
    input_audio_path: str,
    output_audio_path: str,
) -> str | None:
    output_path = Path(output_audio_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    command = [
        'ffmpeg',
        '-y',
        '-i',
        input_audio_path,
        '-acodec',
        'pcm_s16le',
        '-ar',
        '16000',
        '-ac',
        '1',
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
