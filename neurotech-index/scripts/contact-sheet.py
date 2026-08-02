"""contact-sheet.py — lay the reviewed pool out as one sheet, for a human to judge.

    python3 scripts/contact-sheet.py [out.png]

A vision model is a filter, not an editor: it drops a clean product photograph
as "not the subject" one run and passes a four-panel surgical figure the next.
The pool is small and it is reused across the whole site, so it is worth a
person looking at all of it at once. Each cell is drawn at the shape a card
crops to, so what the sheet shows is what a reader gets.
"""
import io
import json
import os
import sys
import urllib.request

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POOL = os.path.join(ROOT, 'src', 'data', 'class-images.json')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'contact-sheet.png')

CELL_W, CELL_H, PAD, LABEL_H, COLS = 320, 240, 10, 22, 5
UA = {'User-Agent': 'NeuroBase/1.0 (+https://neurobase-live.vercel.app)'}

with open(POOL) as fh:
    pool = json.load(fh)

cells = [(cid, i) for cid, c in pool.items() for i in c['images']]
rows = (len(cells) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * (CELL_W + PAD) + PAD, rows * (CELL_H + LABEL_H + PAD) + PAD), 'white')
draw = ImageDraw.Draw(sheet)

for n, (cid, img) in enumerate(cells):
    x = PAD + (n % COLS) * (CELL_W + PAD)
    y = PAD + (n // COLS) * (CELL_H + LABEL_H + PAD)
    try:
        req = urllib.request.Request(img['url'], headers=UA)
        with urllib.request.urlopen(req, timeout=30) as resp:
            im = Image.open(io.BytesIO(resp.read())).convert('RGB')
        # Centre-crop to the card's shape, which is what the page does.
        target = CELL_W / CELL_H
        w, h = im.size
        if w / h > target:
            new_w = int(h * target)
            im = im.crop(((w - new_w) // 2, 0, (w + new_w) // 2, h))
        else:
            new_h = int(w / target)
            im = im.crop((0, (h - new_h) // 2, w, (h + new_h) // 2))
        sheet.paste(im.resize((CELL_W, CELL_H)), (x, y))
    except Exception as err:                                  # noqa: BLE001
        draw.rectangle([x, y, x + CELL_W, y + CELL_H], fill='#eee')
        draw.text((x + 8, y + 8), f'failed: {err}'[:40], fill='red')
    name = str(img.get('classTitle') or img['url'].rsplit('/', 1)[-1]).replace('File:', '')
    draw.text((x + 2, y + CELL_H + 4), f'{n}. {cid} — {name[:44]}', fill='black')

sheet.save(OUT)
print(f'{len(cells)} pictures → {OUT}')
