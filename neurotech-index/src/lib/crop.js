/**
 * crop.js — where a cropped picture's window sits, so the subject stays in it.
 *
 * Every card picture fills its frame (see objectFitOf in image.js), which means
 * `object-fit: cover`: the picture is scaled until it covers the frame, and the
 * overflow is cut. `object-position` is what decides which part is cut.
 *
 * This is the geometry behind scripts/set-image-focus.js. It is pure and lives
 * here rather than in the script so it can be tested without reaching for the
 * network, and so the rule the pipeline writes and the rule the browser applies
 * are stated in one place.
 */

/**
 * The share of each axis that survives a cover-crop into `frame`.
 * The axis that does not overflow keeps all of itself.
 */
export function keptFraction(w, h, frame) {
  if (!w || !h) return { x: 1, y: 1 }
  const r = (w / h) / frame
  return r >= 1 ? { x: 1 / r, y: 1 } : { x: 1, y: r }
}

/**
 * The object-position, along one axis, that best holds a subject spanning
 * [a, b] when only `frac` of that axis is visible.
 *
 * At position p the window spans [p·(1−frac), p·(1−frac) + frac] in picture
 * coordinates. A subject's CENTRE alone cannot answer this: a subject centred
 * at 50% running 15%–85% does not fit a window keeping 48%, and no position
 * saves it, while a subject running 55%–90% fits that window easily and is
 * cut in half by the default centre. The extent is what decides.
 *
 * Fits: return the middle of the range of positions that hold all of it.
 * Does not fit: centre the window on the subject and lose the edges evenly.
 */
export function positionFor(a, b, frac) {
  if (!(frac > 0) || frac >= 1) return 0.5
  const over = 1 - frac
  const clamp = v => Math.min(1, Math.max(0, v))
  const centred = () => clamp(((a + b) / 2 - frac / 2) / over)
  if (b - a <= frac) {
    const lo = clamp((b - frac) / over)   // far enough right to include b
    const hi = clamp(a / over)            // far enough left to include a
    return lo <= hi ? (lo + hi) / 2 : centred()
  }
  return centred()
}

/** The object-position for a picture, as whole percentages. */
export function focusFor(box, w, h, frame) {
  const frac = keptFraction(w, h, frame)
  return {
    x: Math.round(positionFor(box.left, box.right, frac.x) * 100),
    y: Math.round(positionFor(box.top, box.bottom, frac.y) * 100),
  }
}

/**
 * The frame a picture has to survive.
 *
 * Cards are 4:3 and 16:9. 4:3 keeps less of a wide picture and 16:9 keeps less
 * of a tall one, so each picture is positioned for whichever of the two crops
 * it harder — then it holds in either.
 */
export const frameFor = (w, h) => ((w && h && (w / h) >= 4 / 3) ? 4 / 3 : 16 / 9)
