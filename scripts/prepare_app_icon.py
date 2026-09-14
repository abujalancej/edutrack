import argparse
from pathlib import Path

from PIL import Image, ImageFilter


def main() -> None:
    parser = argparse.ArgumentParser(description='Prepara el icono multiplataforma de EduTrack.')
    parser.add_argument('source', type=Path)
    parser.add_argument('mask', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--platform-dir', type=Path)
    args = parser.parse_args()
    source_path, mask_path, output_path = args.source, args.mask, args.output
    source = Image.open(source_path).convert('RGBA')
    extracted = Image.open(mask_path).convert('RGBA')
    if source.size != extracted.size:
        raise SystemExit('La imagen original y la máscara deben tener el mismo tamaño.')

    alpha = extracted.getchannel('A').point(lambda value: 255 if value >= 128 else 0)
    alpha = alpha.filter(ImageFilter.MedianFilter(7)).filter(ImageFilter.GaussianBlur(0.65))
    source.putalpha(alpha)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    source.save(output_path, optimize=True)
    if args.platform_dir:
        args.platform_dir.mkdir(parents=True, exist_ok=True)
        source.resize((1024, 1024), Image.Resampling.LANCZOS).save(args.platform_dir / 'icon.icns', format='ICNS')
        source.save(args.platform_dir / 'icon.ico', format='ICO', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == '__main__':
    main()
