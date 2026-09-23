import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const leagues = {NFL: {path:"nfl",name:"NFL"}, NCAAF: {path:"college-football",name:"College Football (FBS)"}};
export function compactMatch(event) {
  const c=event.competitions?.[0] ?? {}, status=c.status ?? event.status ?? {};
  const team=side=>{
    const t=c.competitors?.find(t=>t.homeAway===side);
    return {name:t?.team?.displayName ?? "TBD",abbreviation:t?.team?.abbreviation ?? "TBD",score:status.type?.state==="pre" ? null : (t?.score == null ? null : Number(t.score)),rank:t?.curatedRank?.current <= 25 ? t.curatedRank.current : null};
  };
  return {id:event.id,date:event.date,name:event.name,status:status.type?.description ?? "Unknown",detail:status.type?.shortDetail ?? "",state:status.type?.state ?? "unknown",live:status.type?.state==="in",completed:status.type?.completed===true,period:status.period ?? null,clock:status.displayClock ?? null,home:team("home"),away:team("away"),venue:c.venue?.fullName ?? null,broadcasts:(c.broadcasts ?? []).flatMap(b=>b.names ?? [])};
}
const cache=new Map();
export async function getScores(params={}, cfg={}, fetcher=fetch) {
  const action=params.action ?? "matches";
  if(!["matches","fixtures","all"].includes(action)) throw new Error("Use matches, fixtures, or all for NFL/college football scoreboards.");
  const codes=[...new Set((params.leagues?.length ? params.leagues : ["NFL","NCAAF"]).map(c=>String(c).toUpperCase()))];
  if(codes.length>2 || codes.some(c=>!leagues[c])) throw new Error("Supported leagues: NFL and NCAAF (college football).");
  if(params.date && (!/^\d{4}-\d{2}-\d{2}$/.test(params.date) || !Number.isFinite(Date.parse(params.date)) || new Date(params.date).toISOString().slice(0,10)!==params.date)) throw new Error("date must be a valid YYYY-MM-DD date.");
  const collegeGroup=params.collegeGroup ?? "fbs";
  if(!["fbs","fcs","all"].includes(collegeGroup)) throw new Error("collegeGroup must be fbs, fcs, or all.");
  const out={generatedAt:new Date().toISOString(),source:"ESPN public scoreboard (unofficial)",note:"Without date, returns the provider's current scoreboard week. Scores may be delayed.",leagues:{}};
  for(const code of codes) {
    const entry={name:code==="NCAAF" ? `College Football (${collegeGroup.toUpperCase()})` : "NFL"}; out.leagues[code]=entry;
    const query=new URLSearchParams({limit:"1000"});
    if(params.date) query.set("dates",params.date.replaceAll("-",""));
    if(code==="NCAAF") query.set("groups",collegeGroup==="fbs"?"80":collegeGroup==="fcs"?"81":"90");
    const url=`https://site.api.espn.com/apis/site/v2/sports/football/${leagues[code].path}/scoreboard?${query}`;
    try {
      let saved=fetcher===fetch ? cache.get(url) : null;
      if(!saved || Date.now()-saved.time>=60000) {
        const response=await fetcher(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(15000)});
        if(!response.ok) throw new Error(`ESPN HTTP ${response.status}`);
        const data=await response.json();
        if(!Array.isArray(data.events)) throw new Error("ESPN returned an invalid scoreboard");
        saved={time:Date.now(),data};
        if(fetcher===fetch) {if(cache.size>=32) cache.delete(cache.keys().next().value);cache.set(url,saved);}
      }
      entry.fetchedAt=new Date(saved.time).toISOString();
      const matches=saved.data.events.map(compactMatch).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      entry.games=action==="fixtures" ? matches.filter(m=>m.state==="pre") : matches;
      entry.live=matches.filter(m=>m.live);entry.recent=matches.filter(m=>m.completed);entry.fixtures=matches.filter(m=>m.state==="pre");
      entry.season=saved.data.season;entry.week=saved.data.week;
    } catch(e) {entry.error=e.message.startsWith("ESPN") ? e.message : "Scoreboard request failed; retry shortly.";}
  }
  return out;
}
export async function getApPoll(fetcher=fetch) {
  const response=await fetcher("https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings",{headers:{Accept:"application/json"},signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`ESPN rankings HTTP ${response.status}`);
  const data=await response.json();
  const poll=data.rankings?.find(r=>r.type==="ap" && r.name==="AP Top 25");
  if(!poll || !Array.isArray(poll.ranks) || poll.ranks.length!==25) throw new Error("ESPN returned an incomplete AP Top 25 poll");
  const rankings=poll.ranks.map(rank=>({
    rank:rank.current,
    team:rank.team?.location ?? rank.team?.name ?? "Unknown",
    record:rank.recordSummary ?? "—",
    points:rank.points,
    previous:rank.previous ?? null,
    change:rank.previous > 0 ? rank.previous-rank.current : null,
  })).sort((a,b)=>a.rank-b.rank);
  if(rankings.some((rank,index)=>rank.rank!==index+1)) throw new Error("ESPN returned invalid AP poll ranks");
  return {name:poll.name,headline:poll.headline,pollDate:poll.date,season:poll.season?.year ?? null,
    week:Number(poll.headline?.match(/Week (\d+)/)?.[1]) || null,
    fetchedAt:new Date().toISOString(),source:"ESPN AP Top 25 (unofficial feed)",rankings};
}
// Retain the old config shape for upgrade compatibility only; no credential is read or sent.
const configSchema={type:"object",properties:{apiKey:{},leagues:{type:"array",items:{type:"string"}}},additionalProperties:false};
export default defineToolPlugin({id:"football-score",name:"US Football Scores",description:"NFL and NCAA college football scores and schedules from ESPN; no API key required.",configSchema,
 tools:tool=>[
  tool({name:"football_score",label:"US Football Scores",description:"Get American football scores: NFL and NCAA college football, NOT soccer. Defaults to both NFL and college FBS for the current scoreboard week. Optional date and FCS/all college coverage. ESPN public feed; may be delayed.",parameters:{type:"object",additionalProperties:false,properties:{action:{type:"string",enum:["matches","fixtures","all"]},leagues:{type:"array",minItems:1,maxItems:2,items:{type:"string",enum:["NFL","NCAAF"]}},date:{type:"string",description:"Optional YYYY-MM-DD; omit for current scoreboard week."},collegeGroup:{type:"string",enum:["fbs","fcs","all"]}}},execute:(params,config)=>getScores(params,config)}),
  tool({name:"football_ap_poll",label:"College Football AP Top 25",description:"Get the latest weekly AP Top 25 college football poll, including rank, team, record, points, and movement. ESPN public feed; may be delayed.",parameters:{type:"object",additionalProperties:false,properties:{}},execute:()=>getApPoll()}),
 ]
});
