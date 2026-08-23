---
name: refresh-home-images
description: The daily picture review for the NeuroBase home page. Empties the review queue by looking at each candidate photograph, records the verdicts and the subject boxes, sources pictures for the stories that have none, binds each picture to its story permanently, and picks a lead that differs from yesterday's. Use when asked to refresh, review or fix the home page images, when the daily image routine fires, or when verify-homepage reports frames without photographs.
---

# The daily home page picture review

You are the reviewer. The pipeline finds candidate pictures and does arithmetic;
**you are the only thing in this system that looks at an image**, and nothing
reaches the home page without your verdict.

There is no model API in this pipeline and there must not be one. Every script
under `neurotech-index/scripts/` reads your decisions out of
`src/data/image-review.json` and treats an unreviewed picture as a rejection.
That is the safety property: a picture cannot reach the page by being fetched,
only by being looked at. Do not add an API call to close the gap — the gap is
the design.

Work from `neurotech-index/`.

## The five rules the home page holds

Everything below serves these. When a judgement call is close, decide by asking
which answer keeps a rule intact.

1. **No photograph appears beside two different stories, ever** — not on one
   page and not eleven months apart. Enforced by `src/data/image-ledger.json`.
2. **The lead story, and so the lead picture, changes every day.**
3. **A picture must be of the story it sits on** — this paper's own figure,
   this outlet's own photograph of this story, this group's own photograph. A
   photograph of the technology in general is not allowed on the home page any
   more, however well labelled.
4. **The picture is credited, minimally, one click away** — the story page
   (`/item/:id`) carries a one-line source credit linking to the file.
5. **The picture is high resolution** — it clears the frame it lands in at a 2x
   device pixel ratio (`STORY_MIN_W` in `src/lib/image.js`).

## The run

### 1. Fill the queue

```bash
node --env-file-if-exists=.env scripts/source-story-images.js --limit=120
```

Dry run, deliberately: it finds candidates for every home-page story that has
no usable picture, and queues everything nobody has ruled on. It also re-asks
about pictures already stored — "it already has one" is exactly the condition
under which nobody looks, and that is how two bad pictures sat on the front
page until August.

### 2. Look at what is waiting

```bash
node scripts/review-queue.js
node scripts/review-queue.js --fetch --out=<scratchpad>/review --limit=25
```

`--fetch` writes the files and a `manifest.json` naming each one, with the
story it was queued for. **Read every image file.** Do not rule on a URL, a
filename, or a guess — a filename that says `implant.jpg` is not evidence, and
this is the one step that cannot be shortcut.

### 3. Rule on each one

Write an array of decisions and apply it:

```bash
node scripts/review-queue.js --apply=<scratchpad>/decisions.json
```

```json
[{ "url": "...", "photo": true, "single": true, "safe": true, "depicts": true,
   "box": { "left": 0.28, "top": 0.25, "right": 0.88, "bottom": 0.92 },
   "note": "why, in one sentence" }]
```

All four must be true for a picture to be publishable. Record a "no" as
carefully as a "yes": a recorded rejection is what stops the same picture
coming back round every night.

- **photo** — a photograph, micrograph or scan of real subject matter. No to a
  chart, schematic, montage diagram, patent drawing, logo, wordmark, 3D render
  or screenshot. A card already carries a data figure; a second diagram adds
  nothing, and a legend is unreadable at 250 pixels.
- **single** — one uninterrupted image. No to a grid of lettered panels, and no
  to burned-in text: a broadcast frame-grab with a chyron, a station logo and a
  sponsor bar is somebody else's branding and somebody else's advert.
- **safe** — a general news page could run it beside a headline unwarned. No to
  exposed tissue, surgery in progress, open wounds, cadavers.
- **depicts** — it is a picture **of the story it was queued for**, whose title
  is in the manifest. This is the one that is easy to wave through and the one
  rule 3 turns on. A journal's masthead art is a real, safe, single photograph
  and has nothing to do with the paper it was queued for. If the headline
  describes a particular person, nobody in the picture may contradict it.
- **box** — the subject's EXTENT, as fractions, on a publishable picture. Not a
  centre point: `src/lib/crop.js` needs an extent to guarantee the subject
  survives the crop rather than merely sits near the middle of it. Box a
  person's head and torso, not their feet. Omit it and the picture is centred.

### 4. Apply, bind, verify

```bash
node --env-file-if-exists=.env scripts/source-story-images.js --commit --limit=120
node --env-file-if-exists=.env scripts/set-image-focus.js --commit
node --env-file-if-exists=.env node_modules/vite-node/vite-node.mjs scripts/bind-home-images.js --commit
node --env-file-if-exists=.env node_modules/vite-node/vite-node.mjs scripts/verify-homepage.js
```

`bind-home-images` is the step that writes down which picture is which story's
and which story leads today. It composes the page through the page's own code,
so what it records is what a reader sees.

### 5. Commit

Commit `src/data/image-review.json`, `src/data/image-ledger.json`,
`src/data/image-focus.json` and any changed data files. The ledger is the only
record of what has been spent and what led yesterday: drop it and the same
pictures get handed out again and the lead stops rotating.

## What a good day looks like

Most frames showing a data figure is **normal and correct**, not a failure. The
supply of pictures that are genuinely of their story is thin: roughly half the
feed arrives as Google News wrapper URLs that have no photograph of their own,
and a recent paper is usually not in PMC yet, so it has no figure anyone may
publish. A card showing the record's own numbers claims only what the record
says. Do not fix a thin page by relaxing `depicts`.

Two things are real failures, and `verify-homepage.js` names both: a picture
that is not of the story it sits on, and the lead not having changed.
