"""card-sheet.py — draw the home page's cards as a reader sees them.

    python3 scripts/card-sheet.py cards.json out.png

`cards.json` is the list scraped from the rendered page: section, headline,
image URL, credit. Each cell is the image cropped exactly as the card crops it,
with the headline under it, so a person can check picture against headline
without trusting a screenshot of a browser pane that goes stale on scroll.
"""
import io
import json
import sys
import textwrap
import urllib.request

from PIL import Image, ImageDraw

cards = json.load(open(sys.argv[1]))
out = sys.argv[2] if len(sys.argv) > 2 else 'card-sheet.png'

CELL_W, CELL_H, PAD, TEXT_H, COLS = 300, 225, 12, 60, 4
UA = {'User-Agent': 'NeuroBase/1.0 (+https://neurobase-live.vercel.app)'}

shown = [c for c in cards if c.get('src')]
rows = (len(shown) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * (CELL_W + PAD) + PAD, rows * (CELL_H + TEXT_H + PAD) + PAD), 'white')
draw = ImageDraw.Draw(sheet)

for n, card in enumerate(shown):
    x = PAD + (n % COLS) * (CELL_W + PAD)
    y = PAD + (n // COLS) * (CELL_H + TEXT_H + PAD)
    try:
        req = urllib.request.Request(card['src'], headers=UA)
        with urllib.request.urlopen(req, timeout=30) as resp:
            im = Image.open(io.BytesIO(resp.read())).convert('RGB')
        target = CELL_W / CELL_H
        w, h = im.size
        if w / h > target:
            nw = int(h * target)
            im = im.crop(((w - nw) // 2, 0, (w + nw) // 2, h))
        else:
            nh = int(w / target)
            im = im.crop((0, (h - nh) // 2, w, (h + nh) // 2))
        sheet.paste(im.resize((CELL_W, CELL_H)), (x, y))
    except Exception as err:                                   # noqa: BLE001
        draw.rectangle([x, y, x + CELL_W, y + CELL_H], fill='#eee')
        draw.text((x + 8, y + 8), f'failed: {err}'[:40], fill='red')
    draw.text((x + 2, y + CELL_H + 4), f"[{card['section']}]", fill='#0B5FA6')
    text = textwrap.fill(card['headline'], 46)
    draw.text((x + 2, y + CELL_H + 16), text[:150], fill='black')
    if card.get('credit'):
        draw.text((x + 2, y + CELL_H + 48), card['credit'][:46], fill='#888')

sheet.save(out)
print(f'{len(shown)} cards → {out}')
