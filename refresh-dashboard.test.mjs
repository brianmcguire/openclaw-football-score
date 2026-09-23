import {test} from "node:test";
import assert from "node:assert/strict";
import {planRefresh} from "./refresh-dashboard.mjs";

const game = (id, state = "in") => ({
  id, date: "2026-09-22T00:15:00Z", state, live: state === "in", completed: state === "post",
  status: "In Progress", detail: "2nd", home: {name: "Home", abbreviation: "HOM", score: 14, rank: null},
  away: {name: "Away", abbreviation: "AWY", score: 0, rank: null}, venue: "Stadium", broadcasts: ["ESPN"],
});
const board = {
  tabs: [{tabId: "us-football-nfl"}, {tabId: "us-football-college"}],
  widgets: [{name: "us-football-nfl-old", tabId: "us-football-nfl", position: 1},
    {name: "unrelated-widget", tabId: "us-football-nfl", position: 2},
    {name: "us-football-ncaaf-summary", tabId: "us-football-college", position: 0,
      props: {blocks: [{type: "text", text: "old"}, {type: "metrics", items: [{label: "Live", value: "1"}]}]}}],
};

test("replaces only managed game cards and builds current scoreboards", () => {
  const plan = planRefresh(board, {leagues: {
    NFL: {games: [game("new")], fetchedAt: "2026-09-22T01:00:00Z"},
    NCAAF: {games: [], fetchedAt: "2026-09-22T01:00:00Z"},
  }});
  assert.deepEqual(plan.removes, [{kind: "widget_remove", name: "us-football-nfl-old"}]);
  assert.equal(plan.puts.find((widget) => widget.name === "us-football-nfl-new").props.blocks[1].items[1].value, "14");
  assert.ok(!plan.removes.some((op) => op.name === "unrelated-widget"));
  assert.deepEqual(plan.moves.filter((op) => op.tabId === "us-football-nfl").map((op) => op.name), ["us-football-nfl-new", "us-football-nfl-summary"]);
  assert.equal(plan.errors.length, 0);
});

test("upstream error preserves games and prior metrics", () => {
  const plan = planRefresh(board, {generatedAt: "2026-09-22T01:00:00Z", leagues: {
    NFL: {error: "ESPN HTTP 503"}, NCAAF: {error: "ESPN HTTP 503"},
  }});
  assert.deepEqual(plan.removes, []);
  assert.equal(plan.puts.find((widget) => widget.name === "us-football-ncaaf-summary").props.blocks[1].items[0].value, "1");
  assert.equal(plan.errors.length, 2);
});

test("an unchanged board only moves rewritten summaries back to the top", () => {
  const scores = {leagues: {
    NFL: {games: [game("new")], fetchedAt: "2026-09-22T01:00:00Z"},
    NCAAF: {games: [], fetchedAt: "2026-09-22T01:00:00Z"},
  }};
  const initial = planRefresh(board, scores);
  const settled = {tabs: board.tabs, widgets: initial.puts.map((widget) => ({...widget, props: widget.props}))};
  const next = planRefresh(settled, scores);
  assert.equal(next.puts.length, 0);
  assert.deepEqual(next.moves, []);
  scores.leagues.NFL.fetchedAt = "2026-09-22T01:02:00Z";
  const timed = planRefresh(settled, scores);
  assert.deepEqual(timed.moves, [{kind: "widget_move", name: "us-football-nfl-summary", tabId: "us-football-nfl", position: 0}]);
});
