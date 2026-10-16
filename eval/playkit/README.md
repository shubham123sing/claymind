# Game agent eval

`cases.json` holds the test kits and requests (known games, the player's own rules, "I don't
know the rules", surprise me, rules the Game Spec cannot express, nonsense, unsafe requests) and
what each should give.

Re-run (real calls to the free models; about 25 minutes because of the free budgets):

```bash
cd server && .venv/Scripts/python -m agents.run
```

```bash
cd client && CLAYMIND_EVAL=1 npx vitest run tests/eval/playkit-eval.test.ts
```

It writes `results.json` here and the summary to `docs/EVAL_REPORT.md`.
`CLAYMIND_EVAL_PACE` (ms between cases, default 40000) and `CLAYMIND_AGENTS` (backend URL) can be set.
