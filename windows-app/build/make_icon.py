from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


SIZE = 1024
root = Path(__file__).resolve().parent

image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

for y in range(SIZE):
    progress = y / (SIZE - 1)
    r = round(35 + 158 * progress)
    g = round(25 + 103 * progress)
    b = round(49 + 77 * progress)
    draw.line((0, y, SIZE, y), fill=(r, g, b, 255))

mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle((32, 32, 992, 992), radius=236, fill=255)
image.putalpha(mask)

glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse((640, 60, 970, 390), fill=(222, 204, 255, 62))
glow = glow.filter(ImageFilter.GaussianBlur(26))
image.alpha_composite(glow)

shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
shadow_draw = ImageDraw.Draw(shadow)
shadow_draw.rounded_rectangle((218, 191, 806, 875), radius=108, fill=(11, 7, 16, 112))
shadow = shadow.filter(ImageFilter.GaussianBlur(30))
image.alpha_composite(shadow)

draw = ImageDraw.Draw(image)
draw.rounded_rectangle((235, 177, 789, 847), radius=98, fill=(252, 249, 252, 255))
draw.rounded_rectangle((291, 233, 733, 791), radius=66, fill=(33, 25, 43, 255))
draw.rounded_rectangle((350, 325, 674, 355), radius=15, fill=(183, 154, 221, 255))
draw.rounded_rectangle((350, 427, 548, 457), radius=15, fill=(231, 216, 248, 255))
draw.rounded_rectangle((350, 529, 674, 559), radius=15, fill=(216, 156, 122, 255))
draw.rounded_rectangle((350, 631, 548, 661), radius=15, fill=(231, 216, 248, 255))
draw.polygon(((609, 437), (702, 512), (609, 587)), fill=(255, 253, 249, 255))

image.putalpha(mask)
image.save(root / "icon.png", optimize=True)
