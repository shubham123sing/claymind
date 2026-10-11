# Quest test checklist (Phase 10)

What only a real Quest 3 / 3S can tell us. About 20 minutes. Open the public
link in **Quest Browser** with `?debug` at the end (shows the frame-time HUD;
press nothing else), sitting at a real table.

Write down for each line: OK / problem (what you saw).

## 1. Start (first five minutes)
- [ ] The page loads; "Start in mixed reality" enters passthrough.
- [ ] The clay lump sits on your **real table** (not floating, not inside it).
- [ ] The tutorial card appears above the clay and is easy to read.
- [ ] Follow it to the end. Time shown at the end: ______ (target: under 2 minutes).

## 2. Hands
- [ ] Pinch and pull the clay: it stretches smoothly, no jitter.
- [ ] Point a finger into it: it dents. Open palm on it: it smooths.
- [ ] Left palm up: the menu opens; poking buttons with the right index works every time.
- [ ] Colour picker and material ring: pokes select the right button.

## 3. Physics
- [ ] Bring to life: the object flies to your right hand. Turn the hand over: it drops.
- [ ] Pinch an object to pick it up, throw it gently: it lands and sounds like its material.
- [ ] Pinch at an object **out of reach** (distance grab): it follows the ray.
- [ ] Make it glass and drop it from 30 cm onto the table: it breaks.
- [ ] Play Kit: knock the dominoes over; they fall in a chain.

## 4. Room
- [ ] Pin an object near the table edge. Exit and reload the page: it is back in the same spot.
- [ ] If not in the same spot: Library -> "Re-place pinned". Was it right then? ______
- [ ] Pour Play Kit pebbles into a pinned cup: they stay inside.

## 5. Frame time (HUD, top of view)
- [ ] Sculpting: frame ______ ms (target <= 13.9 ms for 72 fps).
- [ ] 4 creations + Play Kit on the table: frame ______ ms.
- [ ] Any stutter when bringing to life? ______

## 6. Settings
- [ ] Settings -> Left-handed: the left hand catches; the right palm opens the menu.
- [ ] Settings -> One-handed menu: the menu floats beside the clay; one hand can use it.
- [ ] Settings -> High contrast, Reduced motion: readable, nothing bobs.

## 7. Comfort
- [ ] The view never moves or shakes on its own.
- [ ] Nothing flashes.

Send the filled list (and a screenshot of the HUD if you can). Every "problem" becomes a Phase 10 bug fix before the 13 Nov freeze.
