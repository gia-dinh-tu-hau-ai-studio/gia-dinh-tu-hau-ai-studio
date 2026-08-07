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
    for frame in frames:
        with Image.open(frame) as image:
            foreground = remove(
                image.convert("RGBA"),
                session=session,
                alpha_matting=True,
                alpha_matting_foreground_threshold=240,
                alpha_matting_background_threshold=10,
                alpha_matting_erode_size=8,
            )
            foreground.save(destination / frame.name, "PNG")


if __name__ == "__main__":
    main()
