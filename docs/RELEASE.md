# Release rehearsal and final deploy (V6 Stage D)

The build must stay up until 11 Dec. GitHub Pages publishes `master` on every push
(`.github/workflows/pages.yml`: typecheck, unit tests, build). The game agent and rooms use the
free Render backend (`claymind-agents.onrender.com`), kept warm by `.github/workflows/keep-warm.yml`;
the game works without it.

## Rehearsal (before the freeze, 13 Nov)
1. Local release preview: `cd client && npm run build`, then the full e2e
   (`npx --prefix client playwright test -c qa/e2e/playwright.config.ts xr-e2e`), the autosave test
   and the smoke test (`... smoke`). All must pass.
2. Preview deploy: push the stage branch and open its PR; merge to `master` only when the PR's
   checks are green. Pages then builds the exact merged commit.
3. Smoke test the published copy:
   `QA_URL=https://shubham123sing.github.io/claymind/ npx --prefix client playwright test -c qa/e2e/playwright.config.ts smoke`
   (loads clean, nothing from outside hosts but the backend, names its build, loads with the
   backend unreachable, Enter VR gives an immersive VR session in the emulator).
4. Open the site, Settings -> About: the build id must be the merged commit (first 7 characters).
5. `docs/QUEST_TEST.md` on a Quest if one is available; otherwise say "not verified on a Quest".

## Rollback
Never force-push. Revert the bad merge on `master` (`git revert -m 1 <merge>`), push, and Pages
republishes the previous build. Tags: `pre-v5` (before V5); tag `pre-v6` on the current `master`
before merging the first V6 stage.

## Freeze (13 Nov) to 11 Dec
- No merges to `master` after the freeze except a fix for a broken live build.
- The demo video is recorded from the exact published build (its id in Settings -> About).
- Keys: the Groq key lives only in `server/.env` and on Render; nothing secret is in the repo.
