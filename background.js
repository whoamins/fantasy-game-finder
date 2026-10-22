// background.js (MV3 service worker)
// Fetches the scoreboard for the requested sport (NBA / NFL / NHL) from ESPN's
// public API and returns a trimmed list of games. Kept deliberately "dumb":
// it knows nothing about rosters or team normalization -- the content script
// does the matching per sport.

const ESPN_PATH = {
  nba: "basketball/nba",
  nfl: "football/nfl",
  nhl: "hockey/nhl",
  ncaaf: "football/college-football"
};

const CACHE_MS = 2 * 60 * 1000; // re-fetch at most every 2 minutes
const cache = {}; // sport -> { ts, dateKey, games }

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ESPN scoreboard can be pinned with ?dates=YYYYMMDD (local date).
function espnDateParam() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseScoreboard(json) {
  const events = (json && json.events) || [];
  return events.map((ev) => {
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const competitors = comp.competitors || [];
    const side = (homeAway) => {
      const c = competitors.find((x) => x.homeAway === homeAway) || {};
      const team = c.team || {};
      return {
        abbr: team.abbreviation || "",
        name: team.displayName || team.shortDisplayName || team.name || "",
        short: team.shortDisplayName || "",
        loc: team.location || "",
        score: c.score != null ? String(c.score) : ""
      };
    };
    const status = (ev.status && ev.status.type) || {};
    return {
      id: ev.id,
      date: ev.date || "",
      home: side("home"),
      away: side("away"),
      state: status.state || "pre", // pre | in | post
      detail: status.shortDetail || status.detail || ""
    };
  });
}

async function getGames(sport, force) {
  const path = ESPN_PATH[sport];
  if (!path) throw new Error(`Unknown sport: ${sport}`);
  const now = Date.now();
  const key = todayKey();
  const c = cache[sport];
  if (!force && c && c.games && c.dateKey === key && now - c.ts < CACHE_MS) {
    return { games: c.games, cached: true };
  }

  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${espnDateParam()}`;
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`ESPN API ${res.status}`);
  const json = await res.json();
  const games = parseScoreboard(json);
  cache[sport] = { ts: now, dateKey: key, games };
  return { games, cached: false };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "getGames") {
    getGames(msg.sport || "nba", msg.force)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true; // async response
  }
  return false;
});

// Toolbar button toggles the overlay on the active tab.
chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: "toggleOverlay" }).catch(() => {});
  }
});
