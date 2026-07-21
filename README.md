# Sticker peel

A die-cut sticker you actually peel. Drag from any edge and a vertex shader curls the
sheet around a cylinder, showing the paper backing underneath. Pull past three quarters
and it comes away in your cursor, swinging with the weight of it. Click to lay it back
down anywhere. Grab it by the middle instead and you just slide it around.

**[Live demo →](https://lingkan-wang.github.io/sticker-peel/)**

## Interactions

| Where you press | What happens |
|---|---|
| Hover the sticker | `Peel me from any corner` fades in; cursor shows `grab` on the edge band, `move` in the middle |
| Edge band, drag | Peels. The curl line stays perpendicular to the drag and follows it along the shortest arc |
| Past 75% | Detaches and sticks to the cursor, trailing with inertia and swinging when flung sideways |
| Click while held | Lays back down flat, wherever you dropped it |
| Middle, drag | Slides the whole sticker, 1:1, no curl |
| Outside the sticker | Nothing |

A sticker lying flat casts no shadow at all — the shadow is driven purely by how far the
sheet has left the surface.

## How it is put together

```
src/peel-state.js       peel maths — direction slerp, progress, spring-back
src/sticker-machine.js  mode machine — attached / peeling / held / placing / dragging
src/shaders.js          GLSL — cylindrical curl, double-sided paper backing
src/sticker-texture.js  canvas-drawn fallback sticker + PNG loader
src/main.js             three.js scene, state → uniforms, pointer wiring, rAF
tools/cutout.py         cuts a photographed die-cut sticker out to a transparent PNG
```

The two maths modules are pure — no DOM, no three.js — so they carry the test suite.
`main.js` only maps the machine's fields onto mesh transform, uniforms and the shadow;
it holds no mode logic of its own.

The curl caps at π and continues along a straight tangent. Capping at 2π looks reasonable
on paper but `sin(2π) = 0`, so every vertex past the cap collapses onto the fold line —
more than half the peel range renders as a flattened sliver.

## Running it

```sh
npm install
npm test            # 65 unit tests over the two pure modules
npm run dev         # http://localhost:4780
```

No build step. three.js loads from the unpkg ESM CDN.

## Swapping the sticker

Point `STICKER_IMAGE_URL` in `src/sticker-texture.js` at any PNG **with an alpha channel** —
the fragment shader discards low-alpha fragments, which is what cuts the die-cut outline.
Feed it an opaque JPEG and you get a rectangle with the backdrop baked in. Geometry and
shadow rebuild themselves from the image's aspect ratio.

To cut a photographed sticker out yourself:

```sh
python3 tools/cutout.py photo.jpg assets/sticker.png
```

It flood-fills inward from the frame edges keyed on **saturation** rather than colour —
a lit backdrop has a gradient that defeats absolute thresholds, but it stays desaturated
while the die-cut border does not. Needs Pillow only.

## Notes

`docs/superpowers/` holds the design docs and implementation plans this was built from.
