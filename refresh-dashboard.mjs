import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {getApPoll, getScores} from "./index.js";

const execFileAsync = promisify(execFile);
const boards = {
  NFL: {tabId: "us-football-nfl", prefix: "us-football-nfl-", title: "NFL"},
  NCAAF: {tabId: "us-football-college", prefix: "us-football-ncaaf-", title: "College Football (FBS)"},
};
const maxCards = 8;
const apWidgetName = "college-ap-top-25";

function gameLabel(game) {
  return game.live ? "🔴 LIVE" : game.completed ? "✓ FINAL" : game.state === "pre" ? "UPCOMING" : game.status;
}

function gameProps(game) {
  const teams = ["away", "home"].map((side) => ({
    label: `${game[side].rank ? `#${game[side].rank} ` : ""}${game[side].name}`,
    value: String(game[side].score ?? "—"),
    detail: side === "away" ? "Away" : "Home",
  }));
  const details = [game.date?.replace(/:00\.000Z$/, "Z"), game.venue, ...game.broadcasts].filter(Boolean);
  return {blocks: [
    {type: "text", title: `${gameLabel(game)} • ${game.away.abbreviation} @ ${game.home.abbreviation}`, text: game.detail || game.status},
    {type: "metrics", items: teams},
    {type: "text", text: details.join(" • ") || "ESPN"},
  ]};
}

function summaryProps(league, games, fetchedAt) {
  const text = `Auto-refresh every 2 minutes • Updated ${fetchedAt} • ESPN (unofficial). Scores may be delayed.`;
  return {blocks: [
    {type: "text", title: `${league.title} • Game Center`, text},
    {type: "metrics", items: [
      {label: "Live", value: String(games.filter((game) => game.live).length)},
      {label: "Upcoming", value: String(games.filter((game) => game.state === "pre").length)},
      {label: "Final", value: String(games.filter((game) => game.completed).length)},
    ]},
  ]};
}

function moreProps(games) {
  return {blocks: [{type: "table", title: "More games", columns: ["Away", "Score", "Home", "Status"], rows: games.map((game) => [
    game.away.name,
    `${game.away.score ?? "—"} – ${game.home.score ?? "—"}`,
    game.home.name,
    game.detail || game.status,
  ])}]};
}

export function planRefresh(board, scores) {
  const widgets = board.widgets ?? [];
  const puts = [], removes = [], moves = [], errors = [];
  for (const [code, target] of Object.entries(boards)) {
    if (!board.tabs?.some((tab) => tab.tabId === target.tabId)) {
      errors.push(`${code}: dashboard tab ${target.tabId} is missing`);
      continue;
    }
    const league = scores.leagues?.[code];
    const existing = new Map(widgets.filter((widget) => widget.tabId === target.tabId && widget.name.startsWith(target.prefix)).map((widget) => [widget.name, widget]));
    const summaryName = `${target.prefix}summary`;
    if (!league || league.error) {
      errors.push(`${code}: ${league?.error ?? "scoreboard unavailable"}`);
      const previous = existing.get(summaryName);
      const previousMetrics = previous?.props?.blocks?.find((block) => block.type === "metrics");
      const props = {blocks: [
        {type: "text", title: `${target.title} • Game Center`, text: `Refresh failed ${scores.generatedAt}. Showing the last available scores. ${league?.error ?? "Scoreboard unavailable"}`},
        ...(previousMetrics ? [previousMetrics] : []),
      ]};
      puts.push({name: summaryName, tabId: target.tabId, props, position: 0});
      moves.push({kind: "widget_move", name: summaryName, tabId: target.tabId, position: 0});
      continue;
    }
    const games = [...league.games].sort((a, b) =>
      ({in: 0, pre: 1, post: 2}[a.state] ?? 3) - ({in: 0, pre: 1, post: 2}[b.state] ?? 3)
      || String(a.date).localeCompare(String(b.date)));
    const pollAnchor = code === "NCAAF" ? widgets.find((widget) => widget.tabId === target.tabId && widget.name === apWidgetName) : null;
    const desired = [
      {name: summaryName, tabId: target.tabId, props: summaryProps(target, games, league.fetchedAt), position: 0},
      ...(pollAnchor ? [{name: apWidgetName, tabId: target.tabId, anchor: true}] : []),
      ...games.slice(0, maxCards).map((game, index) => ({name: `${target.prefix}${game.id}`, tabId: target.tabId, props: gameProps(game), position: index + 1 + Number(Boolean(pollAnchor))})),
      ...(games.length > maxCards ? [{name: `${target.prefix}more-${maxCards}`, tabId: target.tabId, props: moreProps(games.slice(maxCards)), position: maxCards + 1 + Number(Boolean(pollAnchor))}] : []),
    ];
    for (const widget of desired) {
      if (widget.anchor) continue;
      const previous = existing.get(widget.name);
      if (!previous || JSON.stringify(previous.props) !== JSON.stringify(widget.props)) puts.push(widget);
    }
    const names = new Set(desired.map((widget) => widget.name));
    for (const name of existing.keys()) if (!names.has(name)) removes.push({kind: "widget_remove", name});
    const currentOrder = [...existing.values(), ...(pollAnchor ? [pollAnchor] : [])]
      .filter((widget) => names.has(widget.name))
      .sort((a, b) => a.position - b.position)
      .map((widget) => widget.name);
    const desiredOrder = desired.map((widget) => widget.name);
    const changedGameCards = desired.some((widget) => !widget.anchor && widget.name !== summaryName && puts.some((put) => put.name === widget.name));
    if (JSON.stringify(currentOrder) !== JSON.stringify(desiredOrder) || changedGameCards || removes.some((op) => op.name.startsWith(target.prefix))) {
      for (const widget of [...desired].reverse()) moves.push({kind: "widget_move", name: widget.name, tabId: widget.tabId, position: 0});
    } else if (puts.some((widget) => widget.name === summaryName)) {
      moves.push({kind: "widget_move", name: summaryName, tabId: target.tabId, position: 0});
    }
  }
  return {puts, removes, moves, errors};
}

async function gateway(method, params) {
  const {stdout} = await execFileAsync(process.env.OPENCLAW_BIN || "openclaw", ["gateway", "call", method, "--params", JSON.stringify(params), "--json", "--timeout", "15000"], {timeout: 20000, maxBuffer: 4 * 1024 * 1024});
  return JSON.parse(stdout);
}

export function apPollProps(poll) {
  const movement = (rank) => rank.change === null ? "New" : rank.change > 0 ? `↑${rank.change}` : rank.change < 0 ? `↓${-rank.change}` : "—";
  return {blocks: [
    {type: "text", title: `AP Top 25${poll.season ? ` • ${poll.season}` : ""}${poll.week ? ` Week ${poll.week}` : ""}`,
      text: `Poll date ${poll.pollDate} • Checked ${poll.fetchedAt} • ESPN (unofficial). Rankings change weekly.`},
    {type: "table", columns: ["#", "Team", "Record", "Points", "Change"], rows: poll.rankings.map((rank) => [
      String(rank.rank), rank.team, rank.record, String(rank.points ?? "—"), movement(rank),
    ])},
  ]};
}

export async function refreshApPoll(sessionKey, dryRun = false) {
  const [board, poll] = await Promise.all([gateway("board.get", {sessionKey}), getApPoll()]);
  const tabId = boards.NCAAF.tabId;
  if (!board.tabs?.some((tab) => tab.tabId === tabId)) throw new Error(`Dashboard tab ${tabId} is missing`);
  const props = apPollProps(poll);
  const previous = board.widgets?.find((widget) => widget.name === apWidgetName);
  const changed = !previous || JSON.stringify(previous.props) !== JSON.stringify(props);
  if (!dryRun && changed) {
    await gateway("board.widget.put", {sessionKey, name: apWidgetName,
      content: {kind: "plugin", pluginKind: "session:report", props},
      placement: {tabId, size: "md"}});
    await gateway("board.update", {sessionKey, ops: [{kind: "widget_move", name: apWidgetName, tabId, position: 1}]});
  }
  return {pollDate: poll.pollDate, week: poll.week, teams: poll.rankings.length, dryRun, updated: changed};
}

export async function refresh(sessionKey, dryRun = false) {
  const [board, scores] = await Promise.all([
    gateway("board.get", {sessionKey}),
    getScores(),
  ]);
  const plan = planRefresh(board, scores);
  if (!dryRun) {
    for (const widget of plan.puts) await gateway("board.widget.put", {
      sessionKey, name: widget.name,
      content: {kind: "plugin", pluginKind: "session:report", props: widget.props},
      placement: {tabId: widget.tabId, size: "md"},
    });
    const ops = [...plan.removes, ...plan.moves];
    if (ops.length) await gateway("board.update", {sessionKey, ops});
  }
  return {at: scores.generatedAt, dryRun, updated: plan.puts.length, removed: plan.removes.length, moved: plan.moves.length, errors: plan.errors};
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const keyIndex = process.argv.indexOf("--session-key");
  const sessionKey = keyIndex < 0 ? null : process.argv[keyIndex + 1];
  if (!sessionKey || sessionKey.startsWith("--")) {
    console.error("Usage: node refresh-dashboard.mjs --session-key <session-key> [--dry-run] [--ap-poll]");
    process.exitCode = 2;
  } else {
    try {
      const result = process.argv.includes("--ap-poll")
        ? await refreshApPoll(sessionKey, process.argv.includes("--dry-run"))
        : await refresh(sessionKey, process.argv.includes("--dry-run"));
      console.log(JSON.stringify(result));
      if (result.errors?.length) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
