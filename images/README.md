# images

Photos shown in the gallery on the landing page.

Currently wired up in `index.html`:

| File | Size | Frame |
|---|---|---|
| `IMG_3716.jpg` | 1170×863 (landscape) | full-width, 4:3 |
| `IMG_3738.JPG` | 512×911 (portrait) | half-width, 4:5 |
| `IMG_3860.jpg` | 674×911 (portrait) | half-width, 4:5 |

**Adding another:** copy a `<figure class="polaroid">` block in `index.html` and point
`src` at the new file. Landscape shots should get `class="polaroid wide"` on the figure
and `class="frame ratio-wide"` on the frame so they span the row instead of being cropped
to a stamp.

**Filenames are case-sensitive on Linux** — `IMG_3738.JPG` has an uppercase extension and
the `src` matches exactly. This works on the AWS box but would silently 404 if the case
ever drifts.

Photos are cropped with `object-position: center 30%`, biased toward the upper part of the
frame so faces survive the crop. Adjust in `css/style.css` if a shot sits wrong.

Frames fall back to a dashed "photo missing" placeholder if a file isn't found, so a bad
path degrades gracefully instead of showing a broken image.
