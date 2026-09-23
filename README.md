# US Football Scores

NFL and NCAA college football scores and schedules for OpenClaw. This is American football, not soccer.

## Usage

Call `football_score` with no arguments for NFL and college FBS scoreboards for ESPN's current week. Optional parameters:

- `leagues`: `["NFL", "NCAAF"]`, or either individually.
- `date`: `YYYY-MM-DD` for a specific day's games.
- `collegeGroup`: `fbs` (default), `fcs`, or `all`.
- `action`: `matches` (default), `fixtures` (upcoming only), or `all`.

Games include teams, scores, status, period, clock, kickoff time, venue, and broadcasts when available. Upcoming scores are null, not misleading zeroes. College coverage is whatever the provider returns for the selected group; an empty scoreboard is not an error.

## Data source

Read-only HTTPS requests to ESPN's public scoreboard endpoints at site.api.espn.com. No account, payment, or API key is required. These unofficial endpoints have no guaranteed availability or latency. Responses are cached for 60 seconds; errors are reported per league and never replaced by fabricated scores. Old soccer configuration is accepted for upgrade compatibility but ignored. No stored soccer token is used or transmitted.

## Dashboard

The built-in session:report dashboard card displays a timestamped snapshot. It does not refresh automatically. Ask the assistant to refresh scores. A native auto-refresh widget remains separate follow-up work.

## Install and verify

Requires Node 20+ and OpenClaw with plugin-sdk/tool-plugin. No third-party runtime dependencies. Run `node --test index.test.js`, `openclaw plugins validate --root .`, then package with `openclaw plugins pack --root . --out us-football-score.tgz --json`.

## License

MIT
