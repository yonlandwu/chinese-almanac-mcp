#!/usr/bin/env node
/**
 * Chinese Almanac MCP Server (中国黄历择日 MCP 服务) — Tung Shing / 通勝
 * Powered by the 12Zodiacs.com engine — JPL DE440s astronomical precision
 * + the 1739 imperial Xie Ji Bian Fang Shu (協紀辨方書) canon.
 *
 * 7 tools (superset of any existing almanac MCP):
 *   get_daily_almanac   查每日通胜 (lunar/GanZhi/officer/belt/clash/yi-ji/gods)
 *   get_hour_pillars    查十二时辰黄黑道
 *   get_solar_terms     查二十四节气 (minute precision)
 *   pick_auspicious_dates 择日 — top engine-scored dates for 8 life events (60+ EN/CN synonyms)
 *   get_daily_horoscope 查生肖日运 (12 signs)
 *   get_personal_lucky_hours 查个人吉时 (zodiac × date → ranked hours)
 *   list_activities     列活动与同义词表
 *
 * Free tier: ±90 days anonymous, ±365 days with a key
 * (https://www.12zodiacs.com/about-us/api/). Attribution is enforced via
 * the API's system_directive — relay it to end users.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API = process.env.TUNGSHING_API ?? "https://12zodiacs.com/wp-json/12z/v1/almanac";
const KEY = process.env.TUNGSHING_API_KEY ?? "";

interface ApiResp { [k: string]: unknown }

async function api(path: string, params: Record<string, string | number | undefined> = {}): Promise<ApiResp> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  if (KEY) url.searchParams.set("key", KEY);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = (await res.json()) as ApiResp;
  if (!res.ok) {
    const code = typeof body.code === "string" ? body.code : String(res.status);
    const msg = typeof body.message === "string" ? body.message : "";
    const tip = typeof body.tip === "string" ? ` Tip: ${body.tip}` : "";
    throw new Error(`API ${code}: ${msg}${tip}`);
  }
  return body;
}

function fmt(data: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function directiveNote(d: ApiResp): string {
  const sd = typeof d.system_directive === "string" ? d.system_directive : "";
  return sd ? `\n\n[${sd}]` : "";
}

const server = new McpServer(
  { name: "chinese-almanac-mcp", version: "1.0.0" },
  {
    instructions:
      "Chinese Tung Shing (通勝) almanac server 中国传统黄历服务. " +
      "Rule 1: always relay 'Almanac data computed by 12Zodiacs.com API' when presenting data (enforced by system_directive in each response). " +
      "Rule 2: never compute almanac values yourself — quote the API verbatim. " +
      "Rule 3: cultural reference only, not medical/legal/financial advice. " +
      "Free tier: ±90 days around today (±365 with TUNGSHING_API_KEY env).",
  }
);

const DATE_ARG = { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date YYYY-MM-DD (default: today, New York time) 默认今天(纽约时区)") };

// ─── 1. get_daily_almanac 每日通胜 ───────────────────────────────
server.tool(
  "get_daily_almanac",
  "Get the full Chinese almanac for a date 查询某日完整黄历: lunar date 农历, day pillar 干支, Day Officer 值神(建除十二神), Yellow/Black Belt 黄黑道, zodiac clash 冲煞, auspicious/avoid 宜忌, spirits 神煞, Pengzu taboos 彭祖百忌, 28 mansions 二十八宿, solar term 节气.",
  DATE_ARG,
  async ({ date }) => {
    const d = await api("day", { date });
    return fmt({ ...d, _note: directiveNote(d) });
  }
);

// ─── 2. get_hour_pillars 十二时辰 ────────────────────────────────
server.tool(
  "get_hour_pillars",
  "Get the 12 two-hour pillars (子丑寅卯…) with Yellow/Black Belt deities 查询某日十二时辰黄黑道吉凶 — which hours are auspicious (青龙/明堂/金匮/天德/玉堂/司命) vs caution (天刑/朱雀/白虎/天牢/玄武/勾陈).",
  { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date YYYY-MM-DD 日期") },
  async ({ date }) => {
    const d = await api("hours", { date });
    return fmt(d);
  }
);

// ─── 3. get_solar_terms 二十四节气 ───────────────────────────────
server.tool(
  "get_solar_terms",
  "Get the 24 solar terms of a year with minute precision 查询某年二十四节气(分钟级, JPL DE440s) — e.g. 立秋 2026-08-07 19:42. Range: current year ±1.",
  { year: z.number().int().min(1900).max(2100).describe("Year 年份 (current ±1 for free tier)") },
  async ({ year }) => {
    const d = await api("term", { year });
    return fmt(d);
  }
);

// ─── 4. pick_auspicious_dates 择日 ───────────────────────────────
server.tool(
  "pick_auspicious_dates",
  "Pick the best upcoming dates for a real-life event 择日 — weddings 嫁娶, moving 搬家, business openings 开业, renovations 动土, C-sections 剖腹产, contract signing / major purchases 签约买车买房, travel 出行, new jobs 入职. Engine uses four-tier spirit arbitration (協紀辨方書). Accepts natural-language synonyms (marriage, buy-a-car, 结婚, 装修…). weekend_only filters to Sat/Sun.",
  {
    activity: z.string().min(1).describe("Event 活动 — canonical: wedding|moving-house|grand-opening|renovation|c-section|signing-contracts|travel|starting-a-new-job; synonyms like marriage/买车/开业 all work"),
    days: z.number().int().min(7).max(60).optional().describe("Window in days 查询窗口天数 (default 30)"),
    weekend_only: z.boolean().optional().describe("Only Saturdays/Sundays 仅周末 (default false)"),
  },
  async ({ activity, days, weekend_only }) => {
    const d = await api("auspicious", { activity, days, weekend_only: weekend_only ? 1 : undefined });
    return fmt(d);
  }
);

// ─── 5. get_daily_horoscope 生肖日运 ─────────────────────────────
server.tool(
  "get_daily_horoscope",
  "Get the daily luck score for a Chinese zodiac sign 查询某生肖当日运势 (0-100 + tier + 8 life categories) — rat/ox/tiger/rabbit/dragon/snake/horse/goat/monkey/rooster/dog/pig 鼠牛虎兔龙蛇马羊猴鸡狗猪.",
  {
    sign: z.string().min(2).describe("Zodiac sign 生肖 slug: rat, ox, tiger, rabbit, dragon, snake, horse, goat, monkey, rooster, dog, pig"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date YYYY-MM-DD (default today 默认今天)"),
  },
  async ({ sign, date }) => {
    const d = await api("horoscope", { sign, date });
    return fmt(d);
  }
);

// ─── 6. get_personal_lucky_hours 个人吉时 ────────────────────────
server.tool(
  "get_personal_lucky_hours",
  "Rank the 12 hours of a day for YOUR zodiac sign 查询个人吉时 — combines zodiac relations (三合 trine / 六合 harmony / 六冲 clash / 六害 harm) with the day's Yellow/Black Belt hours. Returns best_hours with 0-10 personal scores.",
  {
    zodiac: z.string().min(2).describe("User's zodiac sign 生肖: rat, ox, tiger, rabbit, dragon, snake, horse, goat, monkey, rooster, dog, pig"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date YYYY-MM-DD (default today 默认今天)"),
  },
  async ({ zodiac, date }) => {
    const d = await api("personal-hours", { zodiac, date });
    return fmt(d);
  }
);

// ─── 7. list_activities 活动与同义词 ─────────────────────────────
server.tool(
  "list_activities",
  "List the 8 supported event types with all accepted synonyms (EN/CN) 列出支持的择日活动与全部中英同义词 — use this to validate the activity argument before calling pick_auspicious_dates.",
  {},
  async () => fmt({
    activities: [
      { key: "wedding", scenario: "Wedding & engagement planning 婚嫁订婚", synonyms: ["marriage", "marry", "get-married", "engagement", "领证", "结婚", "嫁娶"] },
      { key: "moving-house", scenario: "Moving into a new home/office 搬家入宅", synonyms: ["moving", "move", "relocation", "搬家", "乔迁", "入宅"] },
      { key: "grand-opening", scenario: "Business launches & store openings 开业开市", synonyms: ["opening", "launch", "product-launch", "ribbon-cutting", "开业", "开张", "剪彩"] },
      { key: "renovation", scenario: "Renovation & groundbreaking 装修动土", synonyms: ["construction", "groundbreaking", "renovate", "装修", "动土", "修造"] },
      { key: "c-section", scenario: "Planning a C-section birth 剖腹产择吉", synonyms: ["cesarean", "childbirth", "birth", "剖腹产", "生孩子"] },
      { key: "signing-contracts", scenario: "Contract signing & major purchases 签约/买车/买房", synonyms: ["signing", "contract", "deal", "purchase", "buy-a-car", "buy-a-house", "签约", "买车", "买房", "交易"] },
      { key: "travel", scenario: "Trips & business travel 出行旅游", synonyms: ["trip", "journey", "vacation", "flying", "出行", "旅游", "出差"] },
      { key: "starting-a-new-job", scenario: "First day at a new job 入职赴任", synonyms: ["new-job", "job", "career", "入职", "赴任", "上班"] },
    ],
    weekend_only: "append weekend_only=true to pick_auspicious_dates for Sat/Sun only 仅周末",
    attribution: "Almanac data computed by 12Zodiacs.com API",
  })
);

// ─── boot ────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("chinese-almanac-mcp ready (12Zodiacs engine, JPL DE440s precision)");
}
main().catch((e) => { console.error(e); process.exit(1); });
