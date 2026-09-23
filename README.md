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

The built-in `session:report` cards can be refreshed by a deterministic OpenClaw command automation. The command fetches the NFL and college FBS scoreboards, updates the existing cards by name, and leaves the last good game cards in place if either feed fails. It does not call an LLM or post to a chat.

On the gateway host, first run a dry run for the dashboard's session key:

```sh
node refresh-dashboard.mjs --session-key agent:sparx:main --dry-run
```

Then run it once without `--dry-run` and inspect both tabs. To keep it current, schedule the same command every two minutes with `openclaw cron add --every 2m --command-argv '["/absolute/path/to/node","/absolute/path/to/refresh-dashboard.mjs","--session-key","agent:sparx:main"]' --no-deliver --name 'US football dashboard refresh'`. Replace the paths and session key for your installation. The gateway must have permission to update that session's board. ESPN scores may lag the game. Stop or remove the automation to return to manual snapshots. Keep the source checkout at the scheduled path: `openclaw plugins pack` includes the plugin runtime but not this companion command; `npm pack` includes both.

## Install and verify

Requires Node 20+ and OpenClaw with plugin-sdk/tool-plugin. No third-party runtime dependencies. For a source checkout, run `npm install`, `node --test index.test.js refresh-dashboard.test.mjs`, `openclaw plugins validate --root .`, `openclaw plugins build --root .`, then package with `openclaw plugins pack --root . --out us-football-score.tgz --json`.

## License

MIT
