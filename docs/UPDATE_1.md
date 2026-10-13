# CLAYMIND UPDATE 1: clean menu, opt-in Library, export for other developers, phone AR fix, push to GitHub

Adds to `docs/PLAN.md` (V4 still wins for everything not mentioned here). Same working rules: ONE step at a time, run and test after each step, report in <= 8 lines (works / broken / frame time / what changed / next), then wait for approval. Keep the app runnable. No new features outside this file (ideas go to `IDEAS.md`). Hands-only on Quest, seated, no camera shake.

## Goals
1. All tools go into a menu so the screen/view is clean.
2. A creation is not saved to the Library automatically. The user chooses Add to Library. In the Library the user can use, download and delete items.
3. Library items are real 3D assets other developers can download and use in their own games (standard GLB).
4. Phone AR mode does not work well. Diagnose first, then fix.
5. Commit and push to GitHub at the end of every step.

## Step 0: diagnose phone AR (no feature work yet)
- `navigator.xr.isSessionSupported('immersive-ar')` on the test phone (Android Chrome + ARCore); phone/Chrome version. iPhone Safari has no WebXR: phone AR is Android only; iPhone gets the plain 3D view.
- Session features: `hit-test`; `dom-overlay` with `{root: overlayElement}`; `local-floor` or `local`; render loop on `session.requestAnimationFrame`.
- Placement through a hit-test reticle (tap to place on a detected plane), or a fixed point?
- Input through XR `select*` events and screen touch / pointer events as fallback. No hands in phone AR: one finger sculpts via a ray from the touch point; two fingers rotate/scale the object view, not the world.
- Phone frame time (fps), render scale, pixel ratio (cap about 1.5-2).
- Console errors and screenshots (`chrome://inspect`). Fix only the root cause found, in the same step, then test again on the phone.

## Step 1: menu instead of loose tools
- One small round menu button (bottom-left on phone/desktop overlay; on Quest the palm-up wrist menu). Tools hidden by default.
- Groups (big targets, one tap): Sculpt (add piece, smooth, push/pull, undo/redo), Look (material, color, paint/eraser, brush size), Build (join/separate, pin/unpin, Play Kit), Library, Settings (reset, left/right swap, reduced motion).
- Only the active tool name + one contextual control stay visible. Menu closes after a choice (except the brush size slider while painting).
- Phone: `dom-overlay` menu inside AR, normal HTML overlay outside AR. Buttons >= 48 px, thumb zone, safe-area insets. Quest: 3D menu, targets >= 3 cm.
- Accept: with the menu closed the view shows only the object, the table/room and the menu button.

## Step 2: opt-in Library
- No auto-save to the Library. Session draft autosaved in IndexedDB (not a Library item; small "Draft" indicator).
- Menu > Add to Library: name (default "Clay 1", "Clay 2"), thumbnail, saves sculpt/voxel data + per-piece material + color + paint + pose + thumbnail + `schemaVersion`. Toast "Added to Library" with Undo.
- Library view: thumbnail grid; actions Use (a copy), Edit, Download, Rename, Delete.
- Delete: confirm ("Delete 'Cup'? This cannot be undone") + 5-second Undo toast. Delete all in Settings with a double confirm.
- Per-browser storage, no accounts. Show storage used. Without IndexedDB: "Library is not available in this mode".
- Accept: making an object does not add it; Add adds exactly one; Use, Rename, Delete (with Undo) work; reload keeps the Library; empty for a new player (plus clearly marked optional samples).

## Step 3: export for other developers (GLB)
- GLB via three.js `GLTFExporter`: one node per piece `piece_<n>_<materialId>`; PBR material per piece; paint as `COLOR_0`; welded, no degenerate triangles, metres, Y-up, origin at base centre; Low / Medium / High triangle budget.
- Root `extras.claymind`: `schemaVersion`, `pieces[{id, materialId, massKg, density, friction, restitution}]`, `totalMassKg`, `centerOfMass`.
- Download project (`.claymind.json`) and Import (schema-validated, about 10 MB limit).
- Blob + `<a download>`; Web Share API on phones; check Quest Browser downloads (else Copy link / QR); record in `docs/KNOWN_LIMITS.md`.
- Licence choice CC0 / no licence -> `asset.copyright`. No third-party assets in exports unless their licence allows it (`docs/CREDITS.md`).
- Tests: GLB round trip keeps piece count and bounding box within 1 mm; validates in `gltf-validator` / a viewer.
- Accept: 3 pieces (steel, wood, glass) with paint open in a glTF viewer or Blender with right colours and 3 named nodes.

## Step 4: phone AR polish
- Tap to place on a plane (reticle), sculpt by touch. One finger = current tool; two-finger pinch/rotate = scale/rotate the object; long press = grab and move.
- Menu works in AR; readable in daylight.
- No AR: plain 3D view with orbit controls and a one-line message.
- Accept on a real Android phone: start AR, place, sculpt, material and colour from the menu, Add to Library, Download a GLB, without leaving AR.

## Step 5: GitHub
- Branch `update-1-menu-library-export`, a commit per step. Update `README.md` and `docs/KNOWN_LIMITS.md`. Push the branch, never force-push, never commit `.env`, keys or large binaries. Open a PR; merge only after the user confirms, then redeploy and give the link.
- Final report: works, broken, frame time on phone and Quest, the link, branch/PR.

## Step 6: iPhone and phone input (honest scope)
- No WebXR on iOS, no hands on Android phones: phones use touch; Quest stays hands-only.
- iPhone / no WebXR: plain 3D view with the same menu and touch tools; Library and GLB download work; note "Full hands-on mode needs a Meta Quest."
- Download USDZ (`USDZExporter`, poly limit, piece colours) + "View in your room" via `<a rel="ar">` (AR Quick Look). Test on a real iPhone; record results; drop it if it fails.
- Optional (max half a day): MediaPipe camera hands as a menu pointer only, behind a flag if not clearly good.
- Accept on a real iPhone: open, 3D view, touch sculpt, menu, Add to Library, GLB download, AR Quick Look.
