// background.js (MV3 service worker)
// 1) Fetches the scoreboard for a sport from ESPN's public API (for the content
//    script's matching).
// 2) Runs a daily alarm that counts how many of your rostered players are in
//    games today and shows a "set your lineups" notification.
//
// teams.js gives us fghNormalizeTeam / fghHasMap / FGH_SPORTS for the counting.
importScripts("teams.js");

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

// ---------------------------------------------------------------------------
// Daily "set your lineups" reminder
// ---------------------------------------------------------------------------
const ALARM = "fgh-daily-reminder";
const UI_KEY = "fgh_ui"; // { remind, remindTime, ... } (shared with content.js)
const rosterKey = (sport) => `fgh_roster_${sport}`;

function storageGet(keys) {
  return new Promise((r) => chrome.storage.local.get(keys, r));
}

// Next occurrence (local time) of "HH:MM"; tomorrow if already past today.
function nextFire(hhmm) {
  const [h, m] = String(hhmm || "10:00").split(":").map((n) => parseInt(n, 10));
  const t = new Date();
  t.setHours(isNaN(h) ? 10 : h, isNaN(m) ? 0 : m, 0, 0);
  if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

// Does a scraped roster team refer to this side of a game? Mirrors the
// content script's matching: canonical-code equality for mapped sports, and
// abbr/location/name comparison for map-less sports (NCAAF).
function sideMatch(sport, teamStr, side) {
  if (globalThis.fghHasMap(sport)) {
    const code = globalThis.fghNormalizeTeam(sport, teamStr);
    if (!code) return false;
    const h =
      globalThis.fghNormalizeTeam(sport, side.abbr) ||
      globalThis.fghNormalizeTeam(sport, side.name);
    return code === h;
  }
  const nk = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = nk(teamStr);
  if (!t) return false;
  if (t === nk(side.abbr) || t === nk(side.loc) || t === nk(side.short) || t === nk(side.name)) return true;
  if (t.length >= 4) {
    const d = nk(side.name);
    const l = nk(side.loc);
    if ((d && d.includes(t)) || (l && l.includes(t))) return true;
  }
  return false;
}

async function countForSport(sport) {
  const data = await storageGet(rosterKey(sport));
  const roster = data[rosterKey(sport)] || [];
  if (!roster.length) return 0;
  const { games } = await getGames(sport, false);
  let count = 0;
  for (const p of roster) {
    if (games.some((g) => sideMatch(sport, p.team, g.home) || sideMatch(sport, p.team, g.away))) count++;
  }
  return count;
}

async function runReminder() {
  const ui = (await storageGet(UI_KEY))[UI_KEY] || {};
  if (ui.remind === false) return; // disabled
  let total = 0;
  const parts = [];
  for (const sport of globalThis.FGH_SPORTS) {
    try {
      const c = await countForSport(sport);
      if (c > 0) {
        total += c;
        parts.push(`${sport.toUpperCase()} ${c}`);
      }
    } catch (_) {
      /* ignore one sport's fetch failure */
    }
  }
  if (total <= 0) return; // nothing playing today -> stay quiet
  chrome.notifications.create(`fgh-${Date.now()}`, {
    type: "basic",
    iconUrl: "icon128.png",
    title: "Set your fantasy lineups",
    message: `You have ${total} player${total > 1 ? "s" : ""} in games today (${parts.join(", ")}).`,
    priority: 1
  });
}

async function scheduleReminder() {
  await chrome.alarms.clear(ALARM);
  const ui = (await storageGet(UI_KEY))[UI_KEY] || {};
  if (ui.remind === false) return; // opt-out
  chrome.alarms.create(ALARM, { when: nextFire(ui.remindTime), periodInMinutes: 24 * 60 });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a && a.name === ALARM) runReminder();
});

// Reschedule when the user changes reminder settings in the overlay.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[UI_KEY]) {
    const o = changes[UI_KEY].oldValue || {};
    const n = changes[UI_KEY].newValue || {};
    if (o.remind !== n.remind || o.remindTime !== n.remindTime) scheduleReminder();
  }
});

chrome.runtime.onInstalled.addListener(scheduleReminder);
chrome.runtime.onStartup.addListener(scheduleReminder);
