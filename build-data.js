#!/usr/bin/env node
/* Scrapes 2026 World Cup group standings + match results from Wikipedia
   and writes data.json in the shape the tracker page expects.
   Zero dependencies (Node 18+ global fetch). */

const UA = { headers: { "User-Agent": "wc2026-tracker (github actions; static site data build)" } };
const raw = title =>
  fetch(`https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`, UA)
    .then(r => { if (!r.ok) throw new Error(`${title}: HTTP ${r.status}`); return r.text(); });

// FIFA 3-letter code -> [display name, flag emoji]
const TEAM = {
  MEX:["Mexico","🇲🇽"], RSA:["South Africa","🇿🇦"], KOR:["South Korea","🇰🇷"], CZE:["Czechia","🇨🇿"],
  SUI:["Switzerland","🇨🇭"], CAN:["Canada","🇨🇦"], BIH:["Bosnia & Herz.","🇧🇦"], QAT:["Qatar","🇶🇦"],
  BRA:["Brazil","🇧🇷"], MAR:["Morocco","🇲🇦"], SCO:["Scotland","🏴󠁧󠁢󠁳󠁣󠁴󠁿"], HAI:["Haiti","🇭🇹"],
  USA:["USA","🇺🇸"], AUS:["Australia","🇦🇺"], PAR:["Paraguay","🇵🇾"], TUR:["Türkiye","🇹🇷"],
  GER:["Germany","🇩🇪"], CIV:["Ivory Coast","🇨🇮"], ECU:["Ecuador","🇪🇨"], CUW:["Curaçao","🇨🇼"],
  NED:["Netherlands","🇳🇱"], JPN:["Japan","🇯🇵"], SWE:["Sweden","🇸🇪"], TUN:["Tunisia","🇹🇳"],
  EGY:["Egypt","🇪🇬"], IRN:["Iran","🇮🇷"], BEL:["Belgium","🇧🇪"], NZL:["New Zealand","🇳🇿"],
  ESP:["Spain","🇪🇸"], CPV:["Cape Verde","🇨🇻"], URU:["Uruguay","🇺🇾"], KSA:["Saudi Arabia","🇸🇦"],
  FRA:["France","🇫🇷"], NOR:["Norway","🇳🇴"], SEN:["Senegal","🇸🇳"], IRQ:["Iraq","🇮🇶"],
  ARG:["Argentina","🇦🇷"], AUT:["Austria","🇦🇹"], ALG:["Algeria","🇩🇿"], JOR:["Jordan","🇯🇴"],
  COL:["Colombia","🇨🇴"], POR:["Portugal","🇵🇹"], COD:["DR Congo","🇨🇩"], UZB:["Uzbekistan","🇺🇿"],
  ENG:["England","🏴󠁧󠁢󠁥󠁮󠁧󠁿"], GHA:["Ghana","🇬🇭"], CRO:["Croatia","🇭🇷"], PAN:["Panama","🇵🇦"],
};
const nameOf = c => (TEAM[c] ? TEAM[c][0] : c);
const GROUPS = "ABCDEFGHIJKL".split("");

// pull a numeric field like  win_MEX=3  from a group's template block
const field = (block, key, code) => {
  const m = block.match(new RegExp(`${key}_${code}\\s*=\\s*(\\d+)`));
  return m ? parseInt(m[1], 10) : 0;
};

async function buildStandings() {
  const tpl = await raw("Template:2026 FIFA World Cup group tables");
  const out = {};
  for (let i = 0; i < GROUPS.length; i++) {
    const g = GROUPS[i];
    const start = tpl.indexOf(`|Group ${g}=`);
    const next = i + 1 < GROUPS.length ? tpl.indexOf(`|Group ${GROUPS[i + 1]}=`) : tpl.length;
    const block = tpl.slice(start, next < 0 ? tpl.length : next);
    const orderM = block.match(/team_order\s*=\s*([^\n]+)/);
    if (!orderM) throw new Error(`no team_order for Group ${g}`);
    const codes = orderM[1].split(",").map(s => s.trim()).filter(Boolean);
    out[g] = codes.map(c => {
      if (!TEAM[c]) console.error(`WARN unknown team code: ${c}`);
      return [nameOf(c), field(block, "win", c), field(block, "draw", c),
              field(block, "loss", c), field(block, "gf", c), field(block, "ga", c)];
    });
  }
  return out;
}

// parse a group page's match boxes -> results (played) + fixtures (unplayed)
const MATCH_RE =
  /\|team1=\{\{#invoke:flag\|fb-rt\|(\w+)\}\}[\s\S]*?\|score=\{\{score link\|[^\n}]*?\|([^\n}|]+)\}\}[\s\S]*?\|team2=\{\{#invoke:flag\|fb\|(\w+)\}\}/g;
const DATE_RE = /\|date=\{\{Start date\|(\d{4})\|(\d{1,2})\|(\d{1,2})/;  // {{Start date|Y|M|D}}
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

async function buildGroupMatches(g) {
  const page = await raw(`2026 FIFA World Cup Group ${g}`);
  const results = [], fixtures = [];
  let m;
  MATCH_RE.lastIndex = 0;
  while ((m = MATCH_RE.exec(page))) {
    const [whole, c1, scoreRaw, c2] = m;
    const score = scoreRaw.trim();
    const played = /^\d+\s*[–-]\s*\d+$/.test(score);
    if (played) {
      const [a, b] = score.split(/[–-]/).map(s => parseInt(s.trim(), 10));
      results.push([nameOf(c1), nameOf(c2), a, b]);
    } else {
      // try to grab a date from within this match block for the label
      // date appears just before team1 in the football box; take nearest preceding one
      const before = page.slice(Math.max(0, m.index - 800), m.index);
      const dms = [...before.matchAll(/\|date=\{\{Start date\|(\d{4})\|(\d{1,2})\|(\d{1,2})/g)];
      const dm = dms.length ? dms[dms.length - 1] : null;
      const label = dm ? `${MON[parseInt(dm[2], 10) - 1]} ${parseInt(dm[3], 10)}` : "to play";
      fixtures.push([nameOf(c1), nameOf(c2), label]);
    }
  }
  return { results, fixtures };
}

(async () => {
  const standings = await buildStandings();
  const groups = [];
  for (const g of GROUPS) {
    const teams = standings[g];
    const live = teams.some(t => t[1] + t[2] + t[3] < 3); // any team with <3 played
    const grp = { id: g, live, teams };
    if (live) {
      const { results, fixtures } = await buildGroupMatches(g);
      grp.results = results;
      grp.fixtures = fixtures;
    }
    groups.push(grp);
  }
  const data = { updated: new Date().toISOString(), groups };
  process.stdout.write(JSON.stringify(data, null, 1));
})().catch(e => { console.error("BUILD FAILED:", e.message); process.exit(1); });
