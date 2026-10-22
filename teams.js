// teams.js
// Shared team normalization for NBA, NFL, and NHL. Loaded first in the content
// script via the manifest; everything is attached to globalThis.
//
// Both sides of a match -- the player's team scraped off the fantasy page, and
// the two teams in each ESPN game -- are normalized within the SAME sport. As
// long as both normalize to the same canonical code, the exact spelling a
// platform uses (GS vs GSW, WSH vs WAS, JAX vs JAC, ...) doesn't matter.
//
// Normalization is sport-scoped because abbreviations/nicknames collide across
// leagues (e.g. "Panthers" = CAR in NFL but FLA in NHL; "Jets" = NYJ vs WPG).

(function () {
  // Each entry: [canonicalCode, fullName, nickname, [extra abbrev aliases], city?]
  const DATA = {
    nba: [
      ["ATL", "Atlanta Hawks", "Hawks", ["ATL"], "atlanta"],
      ["BOS", "Boston Celtics", "Celtics", ["BOS"], "boston"],
      ["BKN", "Brooklyn Nets", "Nets", ["BKN", "BRK", "NJN"], "brooklyn"],
      ["CHA", "Charlotte Hornets", "Hornets", ["CHA", "CHO"], "charlotte"],
      ["CHI", "Chicago Bulls", "Bulls", ["CHI"], null],
      ["CLE", "Cleveland Cavaliers", "Cavaliers", ["CLE", "CAVS"], "cleveland"],
      ["DAL", "Dallas Mavericks", "Mavericks", ["DAL", "MAVS"], null],
      ["DEN", "Denver Nuggets", "Nuggets", ["DEN"], "denver"],
      ["DET", "Detroit Pistons", "Pistons", ["DET"], null],
      ["GSW", "Golden State Warriors", "Warriors", ["GSW", "GS", "GST"], "golden state"],
      ["HOU", "Houston Rockets", "Rockets", ["HOU"], null],
      ["IND", "Indiana Pacers", "Pacers", ["IND"], "indiana"],
      ["LAC", "LA Clippers", "Clippers", ["LAC"], null],
      ["LAL", "Los Angeles Lakers", "Lakers", ["LAL"], null],
      ["MEM", "Memphis Grizzlies", "Grizzlies", ["MEM"], "memphis"],
      ["MIA", "Miami Heat", "Heat", ["MIA"], null],
      ["MIL", "Milwaukee Bucks", "Bucks", ["MIL"], "milwaukee"],
      ["MIN", "Minnesota Timberwolves", "Timberwolves", ["MIN", "WOLVES"], null],
      ["NOP", "New Orleans Pelicans", "Pelicans", ["NOP", "NO", "NOR", "NOLA"], null],
      ["NYK", "New York Knicks", "Knicks", ["NYK", "NY"], null],
      ["OKC", "Oklahoma City Thunder", "Thunder", ["OKC"], "oklahoma city"],
      ["ORL", "Orlando Magic", "Magic", ["ORL"], "orlando"],
      ["PHI", "Philadelphia 76ers", "76ers", ["PHI", "PHL", "SIXERS"], null],
      ["PHX", "Phoenix Suns", "Suns", ["PHX", "PHO", "PHE"], "phoenix"],
      ["POR", "Portland Trail Blazers", "Trail Blazers", ["POR", "BLAZERS", "TRAILBLAZERS"], "portland"],
      ["SAC", "Sacramento Kings", "Kings", ["SAC"], "sacramento"],
      ["SAS", "San Antonio Spurs", "Spurs", ["SAS", "SA", "SAN"], "san antonio"],
      ["TOR", "Toronto Raptors", "Raptors", ["TOR", "RAPS"], null],
      ["UTA", "Utah Jazz", "Jazz", ["UTA", "UTAH"], null],
      ["WAS", "Washington Wizards", "Wizards", ["WAS", "WSH", "WIZ"], null]
    ],
    nfl: [
      ["ARI", "Arizona Cardinals", "Cardinals", ["ARI", "ARZ"], "arizona"],
      ["ATL", "Atlanta Falcons", "Falcons", ["ATL"], "atlanta"],
      ["BAL", "Baltimore Ravens", "Ravens", ["BAL", "BLT"], "baltimore"],
      ["BUF", "Buffalo Bills", "Bills", ["BUF"], "buffalo"],
      ["CAR", "Carolina Panthers", "Panthers", ["CAR"], "carolina"],
      ["CHI", "Chicago Bears", "Bears", ["CHI"], null],
      ["CIN", "Cincinnati Bengals", "Bengals", ["CIN"], "cincinnati"],
      ["CLE", "Cleveland Browns", "Browns", ["CLE", "CLV"], "cleveland"],
      ["DAL", "Dallas Cowboys", "Cowboys", ["DAL"], null],
      ["DEN", "Denver Broncos", "Broncos", ["DEN"], "denver"],
      ["DET", "Detroit Lions", "Lions", ["DET"], null],
      ["GB", "Green Bay Packers", "Packers", ["GB", "GNB"], "green bay"],
      ["HOU", "Houston Texans", "Texans", ["HOU", "HST"], null],
      ["IND", "Indianapolis Colts", "Colts", ["IND"], "indianapolis"],
      ["JAX", "Jacksonville Jaguars", "Jaguars", ["JAX", "JAC"], "jacksonville"],
      ["KC", "Kansas City Chiefs", "Chiefs", ["KC", "KAN"], "kansas city"],
      ["LV", "Las Vegas Raiders", "Raiders", ["LV", "LVR", "OAK", "LAS"], "las vegas"],
      ["LAC", "Los Angeles Chargers", "Chargers", ["LAC", "SD", "SDG"], null],
      ["LAR", "Los Angeles Rams", "Rams", ["LAR", "STL", "RAM"], null],
      ["MIA", "Miami Dolphins", "Dolphins", ["MIA"], null],
      ["MIN", "Minnesota Vikings", "Vikings", ["MIN"], null],
      ["NE", "New England Patriots", "Patriots", ["NE", "NWE"], "new england"],
      ["NO", "New Orleans Saints", "Saints", ["NO", "NOR"], null],
      ["NYG", "New York Giants", "Giants", ["NYG"], null],
      ["NYJ", "New York Jets", "Jets", ["NYJ"], null],
      ["PHI", "Philadelphia Eagles", "Eagles", ["PHI"], null],
      ["PIT", "Pittsburgh Steelers", "Steelers", ["PIT"], "pittsburgh"],
      ["SF", "San Francisco 49ers", "49ers", ["SF", "SFO", "NINERS"], "san francisco"],
      ["SEA", "Seattle Seahawks", "Seahawks", ["SEA"], "seattle"],
      ["TB", "Tampa Bay Buccaneers", "Buccaneers", ["TB", "TAM", "TBB", "BUCS"], null],
      ["TEN", "Tennessee Titans", "Titans", ["TEN"], "tennessee"],
      ["WAS", "Washington Commanders", "Commanders", ["WAS", "WSH", "WFT"], null]
    ],
    nhl: [
      ["ANA", "Anaheim Ducks", "Ducks", ["ANA"], "anaheim"],
      ["BOS", "Boston Bruins", "Bruins", ["BOS"], null],
      ["BUF", "Buffalo Sabres", "Sabres", ["BUF"], null],
      ["CGY", "Calgary Flames", "Flames", ["CGY", "CAL"], "calgary"],
      ["CAR", "Carolina Hurricanes", "Hurricanes", ["CAR", "CAN"], null],
      ["CHI", "Chicago Blackhawks", "Blackhawks", ["CHI"], null],
      ["COL", "Colorado Avalanche", "Avalanche", ["COL"], "colorado"],
      ["CBJ", "Columbus Blue Jackets", "Blue Jackets", ["CBJ", "CLB"], "columbus"],
      ["DAL", "Dallas Stars", "Stars", ["DAL"], null],
      ["DET", "Detroit Red Wings", "Red Wings", ["DET"], null],
      ["EDM", "Edmonton Oilers", "Oilers", ["EDM"], "edmonton"],
      ["FLA", "Florida Panthers", "Panthers", ["FLA", "FLO"], null],
      ["LAK", "Los Angeles Kings", "Kings", ["LAK", "LA"], null],
      ["MIN", "Minnesota Wild", "Wild", ["MIN"], null],
      ["MTL", "Montreal Canadiens", "Canadiens", ["MTL", "MON"], "montreal"],
      ["NSH", "Nashville Predators", "Predators", ["NSH", "NAS"], "nashville"],
      ["NJD", "New Jersey Devils", "Devils", ["NJD", "NJ"], "new jersey"],
      ["NYI", "New York Islanders", "Islanders", ["NYI"], null],
      ["NYR", "New York Rangers", "Rangers", ["NYR"], null],
      ["OTT", "Ottawa Senators", "Senators", ["OTT"], "ottawa"],
      ["PHI", "Philadelphia Flyers", "Flyers", ["PHI"], null],
      ["PIT", "Pittsburgh Penguins", "Penguins", ["PIT"], null],
      ["SJS", "San Jose Sharks", "Sharks", ["SJS", "SJ"], "san jose"],
      ["SEA", "Seattle Kraken", "Kraken", ["SEA"], null],
      ["STL", "St. Louis Blues", "Blues", ["STL"], "st louis"],
      ["TBL", "Tampa Bay Lightning", "Lightning", ["TBL", "TB", "TBA"], null],
      ["TOR", "Toronto Maple Leafs", "Maple Leafs", ["TOR", "TORONTO"], null],
      ["VAN", "Vancouver Canucks", "Canucks", ["VAN"], "vancouver"],
      ["VGK", "Vegas Golden Knights", "Golden Knights", ["VGK", "VEG", "LVK"], null],
      ["WSH", "Washington Capitals", "Capitals", ["WSH", "WAS"], null],
      ["WPG", "Winnipeg Jets", "Jets", ["WPG", "WIN"], "winnipeg"],
      ["UTA", "Utah Hockey Club", "Mammoth", ["UTA", "UTAH", "ARI", "ARIZONA"], null]
    ]
  };

  const LOOKUPS = {}; // sport -> Map(aliasLower -> canonicalCode)
  for (const sport of Object.keys(DATA)) {
    const map = new Map();
    const put = (key, code) => {
      if (!key) return;
      const k = String(key).trim().toLowerCase();
      if (k) map.set(k, code);
    };
    for (const [code, full, nick, aliases, city] of DATA[sport]) {
      put(code, code);
      put(full, code);
      put(nick, code);
      if (city) put(city, code);
      for (const a of aliases) put(a, code);
    }
    LOOKUPS[sport] = map;
  }

  // Direct normalization of a single token or name, within one sport.
  function fghNormalizeTeam(sport, input) {
    if (!input) return null;
    const map = LOOKUPS[sport];
    if (!map) return null;
    const s = String(input).trim().toLowerCase().replace(/\./g, "");
    if (map.has(s)) return map.get(s);
    const cleaned = s.replace(/\(.*?\)/g, "").trim();
    if (cleaned && map.has(cleaned)) return map.get(cleaned);
    return null;
  }

  // Scan a blob of text (e.g. a whole roster row) for the first token that
  // resolves to a team in the given sport. Used by the roster scraper.
  function fghFindTeamInText(sport, text) {
    if (!text || !DATA[sport]) return null;
    const tokens = text.match(/\b[A-Za-z]{2,13}\b/g) || [];
    for (const tok of tokens) {
      const code = fghNormalizeTeam(sport, tok);
      if (code) return code;
    }
    const lower = text.toLowerCase();
    for (const [, full, nick, , city] of DATA[sport]) {
      if (nick.includes(" ") && lower.includes(nick.toLowerCase())) return fghNormalizeTeam(sport, nick);
      if (lower.includes(full.toLowerCase())) return fghNormalizeTeam(sport, full);
      if (city && city.includes(" ") && lower.includes(city)) return fghNormalizeTeam(sport, city);
    }
    return null;
  }

  // All supported sports (used for storage keys / iteration). NCAAF has no
  // hardcoded map -- college teams are matched dynamically against the ESPN
  // scoreboard instead (see content.js), so it is excluded from content-based
  // auto-detection below.
  globalThis.FGH_SPORTS = ["nba", "nfl", "nhl", "ncaaf"];
  globalThis.FGH_DETECT_SPORTS = ["nba", "nfl", "nhl"];
  globalThis.fghHasMap = (sport) => Object.prototype.hasOwnProperty.call(DATA, sport);
  globalThis.fghNormalizeTeam = fghNormalizeTeam;
  globalThis.fghFindTeamInText = fghFindTeamInText;
})();
