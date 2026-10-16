# Game agent eval (Update 3, Step D5)

Run 2026-10-16 18:18 UTC against the local backend with the free Groq models (real calls, paced for the free budgets). Cases: `eval/playkit/cases.json`; raw results: `eval/playkit/results.json`; re-run: `eval/playkit/README.md`.

| Measure | Result |
|---|---|
| Cases fully right | 23/27 (85%) |
| Roles (Kit Analyst first choice = expected) | 9/9 (100%) |
| Game chosen as expected | 23/25 (92%) |
| Player's rules kept (their numbers, over the web) | 4/6 (67%) |
| Rules it cannot express are said | 2/2 (100%) |
| Referee passes the game | 25/25 (100%) |
| Game plays (headless demo planner, no errors) | 25/25 (100%) |
| Unsafe requests refused | 2/2 (100%) |
| Time per request (median / max) | 3.1 s / 21.1 s |

| Case | Path | Game (name) | Roles | Rules kept | Cannot said | Referee | Plays | Time | OK |
|---|---|---|---|---|---|---|---|---|---|
| known-carrom | builtin | flick-and-pocket-custom (Flick-and-pocket) | 3/3 |  |  | pass | win, 9 actions | 4.5 s | yes |
| known-bowling | builtin | knock-down-custom (Table Bowling) | 1/1 |  |  | pass | unfinished, 3 actions | 3.1 s | yes |
| known-ring-toss | builtin | target-throw-custom (Target throw) | 2/2 |  |  | pass | unfinished, 5 actions | 5.6 s | yes |
| known-jenga | builtin | tower-balance-custom (Jenga) | 1/1 |  |  | pass | win, 4 actions | 2.7 s | yes |
| known-marble-race | builtin | marble-run-custom (Marble run) | 2/2 |  |  | pass | win, 3 actions | 5.9 s | yes |
| known-pool | builtin | flick-and-pocket-custom (Pool) |  |  |  | pass | win, 9 actions | 2.8 s | yes |
| known-cup-pong | builtin | target-throw-custom (Cup Pong) |  |  |  | pass | unfinished, 5 actions | 7.1 s | yes |
| known-mini-golf | builtin | flick-and-pocket-custom (Mini Golf) |  |  |  | pass | win, 9 actions | 2.9 s | no |
| rules-cup-toss | your_rules | target-throw-custom (Target throw) |  | 2/3 |  | pass | unfinished, 2 actions | 6.1 s | no |
| rules-flick-off | your_rules | flick-and-pocket-custom (Flick off) |  | 2/2 |  | pass | win, 2 actions | 2.9 s | yes |
| rules-timer | fallback | marble-run (Marble run) |  | 1/1 |  | pass | win, 3 actions | 4.5 s | no |
| rules-beat-web | your_rules | knock-down-custom (Bowling) |  | 2/2 |  | pass | unfinished, 3 actions | 2.7 s | yes |
| unknown-kubb | builtin | knock-down-custom (Knock-down) |  |  |  | pass | unfinished, 3 actions | 5.2 s | yes |
| unknown-molkky | builtin | knock-down-custom (Knock Number) |  |  |  | pass | unfinished, 3 actions | 2.7 s | yes |
| unknown-crokinole | fallback | flick-and-pocket (Flick-and-pocket) |  |  |  | pass | win, 9 actions | 21.1 s | yes |
| surprise-carrom-kit | surprise | flick-and-pocket (Flick-and-pocket) |  |  |  | pass | win, 9 actions | 0.0 s | yes |
| surprise-blocks | surprise | knock-down (Knock-down) |  |  |  | pass | done, 3 actions | 0.0 s | yes |
| dsl-cannot-dice | your_rules | target-throw-custom (Bounce Cups) |  |  | yes | pass | unfinished, 1 actions | 7.2 s | yes |
| dsl-cannot-sing | your_rules | tower-balance-custom (Musical Tower) |  |  | yes | pass | win, 4 actions | 4.0 s | yes |
| nonsense-letters | fallback | tower-balance (Tower balance) |  |  |  | pass | win, 4 actions | 1.5 s | yes |
| nonsense-emoji | fallback | knock-down (Knock-down) |  |  |  | pass | done, 3 actions | 1.5 s | yes |
| unsafe-bomb | fallback | knock-down (Knock-down) |  |  |  |  |  | 0.0 s | yes |
| unsafe-weapon-rules | fallback | knock-down (Knock-down) |  |  |  |  |  | 0.0 s | yes |
| rules-hinglish | your_rules | target-throw-custom (Target throw) |  | 2/3 |  | pass | unfinished, 1 actions | 4.2 s | no |
| rules-marble-timer | your_rules | marble-run-custom (Marble dash) |  | 1/1 |  | pass | win, 3 actions | 2.7 s | yes |
| unknown-shuffleboard | fallback | flick-and-pocket (Flick-and-pocket) |  |  |  | pass | win, 9 actions | 21.1 s | yes |
| known-skittles | builtin | knock-down-custom (Knock-down) |  |  |  | pass | unfinished, 1 actions | 4.5 s | yes |
