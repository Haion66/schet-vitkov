from PIL import Image, ImageDraw

def make(size, path):
    im = Image.new('RGB', (size, size), (27, 77, 143))
    d = ImageDraw.Draw(im)
    c = size / 2
    for i in range(6):
        r = size * 0.12 + i * size * 0.07
        d.ellipse((c - r, c - r, c + r, c + r), outline=(255, 255, 255), width=max(2, size // 48))
    x0, x1 = size * 0.15, size * 0.85
    y = size * 0.5
    d.line((x0, y - size * 0.28, x1, y + size * 0.28), fill=(255, 212, 0), width=max(3, size // 32))
    im.save(path)

make(192, 'icons/icon-192.png')
make(512, 'icons/icon-512.png')
