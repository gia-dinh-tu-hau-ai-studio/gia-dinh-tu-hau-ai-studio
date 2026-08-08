from pathlib import Path
import sys

from PIL import Image
from rembg import new_session, remove


def main() -> None:
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    destination.mkdir(parents=True, exist_ok=True)
    frames = sorted(source.glob("*.png"))
    if not frames:
        raise RuntimeError(f"No RP015 source frames found in {source}")
    session = new_session("u2net_human_seg")
    for index, frame in enumerate(frames, start=1):
        with Image.open(frame) as image:
            foreground = remove(
                image.convert("RGBA"),
                session=session,
                alpha_matting=False,
            )
            foreground.save(destination / frame.name, "PNG")
        if index == 1 or index % 12 == 0 or index == len(frames):
            print(f"RP015_BACKGROUND_REMOVAL_PROGRESS {index}/{len(frames)}", flush=True)


if __name__ == "__main__":
    main()
