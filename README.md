<!-- TODO before submitting: replace GITHUB-OWNER with the GitHub username that owns this repository, so the rank/reward badges point at the submitted repo. -->
# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/GITHUB-OWNER/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/GITHUB-OWNER/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: every pre-token protocol in DefiLlama's index, ranked by an implied value calibrated from the market's own live-token multiples, with a concrete farm plan for each. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## The model (radar-2)

The starter's flat multiple (TVL x 0.25 for every protocol) ignores what the market already tells us: live-token protocols trade at very different multiples of TVL by category. This entry calibrates from the snapshot itself:

- **Category multiple**: for each category, the median market-cap/TVL ratio of its live-token protocols, shrunk toward the global median (prior strength 6) so a category with one or two live tokens cannot set a wild multiple. Categories with no live token use the global median.
- **Relative growth**: seven-day TVL change measured against the category's median week, clamped, so a protocol that held flat while its category fell scores as growing.
- **Maturity**: a saturating age curve — longer running with no token, up to two years, counts for more.
- **Chain breadth**: a small log-scaled factor for protocols live on more chains.

`implied = TVL x category_multiple x growth x maturity x chains`. No protocol name is ever special-cased; the same function scores every row. The dashboard's Model tab shows the full calibration table and a sandbox that re-ranks the board under changed constants.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22.18+ (or 24/26), standard library only, no network. Reads the sealed snapshot, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. Two runs write identical bytes.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
