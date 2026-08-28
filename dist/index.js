#!/usr/bin/env node
/**
 * Chinese Almanac MCP Server (中国黄历择日 MCP 服务) — Tung Shing / 通勝
 * Powered by the 12Zodiacs.com engine — JPL DE440s astronomical precision
 * + the 1739 imperial Xie Ji Bian Fang Shu (協紀辨方書) canon.
 *
 * 8 tools (superset of any existing almanac MCP):
 *   get_daily_almanac        查每日通胜 (lunar/GanZhi/officer/belt/clash/yi-ji/gods)
 *   get_hour_pillars         查十二时辰黄黑道
 *   get_solar_terms          查二十四节气 (minute precision)
 *   pick_auspicious_dates    择日 — engine shortlist + patron-zodiac match +
 *                            fixed-inauspicious-day veto + transparent reasons
 *   pick_dates_deep          择日 deep scan — burial 安葬 / ancestor worship 祭祀
 *                            (activities without an engine shortlist)
 *   get_daily_horoscope      查生肖日运 (12 signs)
 *   get_personal_lucky_hours 查个人吉时 (zodiac × date → ranked hours)
 *   list_activities          列活动与同义词表
 *
 * Scoring split (v1.1): the /auspicious engine score (0-5) stays the primary
 * score; this server adds only what the engine cannot know — patron zodiac
 * veto/bonus, fixed inauspicious days (杨公忌/三娘煞/十恶大败/四离四绝 via
 * minute-precision solar terms) — and reports engine_score vs
 * local_adjustment separately. Logic is ported from and cross-validated
 * against the tung-shing-almanac-skill Python engine (test-vectors.json).
 *
 * Free tier: ±90 days anonymous, ±365 days with a key
 * (https://www.12zodiacs.com/about-us/api/). Attribution is enforced via
 * the API's system_directive — relay it to end users.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { gzIndex, siLiSiJue, isYangGongJi, isSanniangSha, isShiEDaBai, patronRelation, resolveEvent, zodiacFromBirthDate, REL_CN, } from "./scoring.js";
const PKG_VERSION = "1.1.0"; // keep in sync with package.json
const API = process.env.TUNGSHING_API ?? "https://12zodiacs.com/wp-json/12z/v1/almanac";
const KEY = process.env.TUNGSHING_API_KEY ?? "";
async function api(path, params = {}) {
    const url = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "")
            url.searchParams.set(k, String(v));
    }
    if (KEY)
        url.searchParams.set("key", KEY);
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const body = (await res.json());
    if (!res.ok) {
        const code = typeof body.code === "string" ? body.code : String(res.status);
        const msg = typeof body.message === "string" ? body.message : "";
        const tip = typeof body.tip === "string" ? ` Tip: ${body.tip}` : "";
        throw new Error(`API ${code}: ${msg}${tip}`);
    }
    return body;
}
function fmt(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function directiveNote(d) {
    const sd = typeof d.system_directive === "string" ? d.system_directive : "";
    return sd ? `\n\n[${sd}]` : "";
}
const ATTRIBUTION = "Almanac data computed by 12Zodiacs.com API";
const server = new McpServer({ name: "chinese-almanac-mcp", version: PKG_VERSION }, {
    instructions: "Chinese Tung Shing (通勝) almanac server 中国传统黄历服务. " +
        "Rule 1: always relay 'Almanac data computed by 12Zodiacs.com API' when presenting data (enforced by system_directive in each response). " +
        "Rule 2: never compute almanac values yourself — quote the API verbatim. " +
        "Rule 3: cultural reference only, not medical/legal/financial advice. " +
        "Free tier: ±90 days around today (±365 with TUNGSHING_API_KEY env).",
});
const DATE_ARG = { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date YYYY-MM-DD (default: today, New York time) 默认今天(纽约时区)") };
// ─── 1. get_daily_almanac 每日通胜 ───────────────────────────────
server.tool("get_daily_almanac", "Get the full Chinese almanac for a date 查询某日完整黄历: lunar date 农历, day pillar 干支, Day Officer 值神(建除十二神), Yellow/Black Belt 黄黑道, zodiac clash 冲煞, auspicious/avoid 宜忌, spirits 神煞, Pengzu taboos 彭祖百忌, 28 mansions 二十八宿, solar term 节气.", DATE_ARG, async ({ date }) => {
    const d = await api("day", { date });
    return fmt({ ...d, _note: directiveNote(d) });
});
// ─── 2. get_hour_pillars 十二时辰 ────────────────────────────────
server.tool("get_hour_pillars", "Get the 12 two-hour pillars (子丑寅卯…) with Yellow/Black Belt deities 查询某日十二时辰黄黑道吉凶 — which hours are auspicious (青龙/明堂/金匮/天德/玉堂/司命) vs caution (天刑/朱雀/白虎/天牢/玄武/勾陈).", { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date YYYY-MM-DD 日期") }, async ({ date }) => {
    const d = await api("hours", { date });
    return fmt(d);
});
// ─── 3. get_solar_terms 二十四节气 ───────────────────────────────
server.tool("get_solar_terms", "Get the 24 solar terms of a year with minute precision 查询某年二十四节气(分钟级, JPL DE440s) — e.g. 立秋 2026-08-07 19:42. Range: current year ±1.", { year: z.number().int().min(1900).max(2100).describe("Year 年份 (current ±1 for free tier)") }, async ({ year }) => {
    const d = await api("term", { year });
    return fmt(d);
});
function cleanList(arr) {
    if (!Array.isArray(arr))
        return [];
    return arr.map(s => String(s).replace(/[\u200b\u200c\u200d\ufeff]/g, "").trim());
}
function checkFixedDaysAndPatron(day, patronSlug, vetoSanniang) {
    const vetoes = [];
    const adjustments = [];
    let fuyin = false;
    let localAdjustment = 0;
    const lunar = (day.lunar ?? {});
    const lm = Number(lunar.month ?? 0);
    const ld = Number(lunar.day ?? 0);
    const pillar = (day.day_pillar ?? {});
    const gzI = gzIndex(String(pillar.stem_cn ?? ""), String(pillar.branch_cn ?? ""));
    if (isYangGongJi(lm, ld))
        vetoes.push("杨公忌 Yang Gong Ji");
    if (isSanniangSha(ld, vetoSanniang))
        vetoes.push("三娘煞 Sanniang Sha");
    if (isShiEDaBai(gzI))
        vetoes.push("十恶大败 Shi E Da Bai");
    if (patronSlug) {
        const relations = (day.relations ?? {});
        const map = Array.isArray(relations.map) ? relations.map : [];
        const relEntry = map.find((m) => m.slug === patronSlug);
        const verdict = patronRelation(relEntry ? String(relEntry.rel) : "plain");
        if (verdict.action === "veto") {
            vetoes.push(`本命${REL_CN[verdict.rel]} Clash/harm with patron (${REL_CN[verdict.rel]})`);
        }
        else if (verdict.action === "bonus") {
            localAdjustment += verdict.points;
            adjustments.push({
                zh: `日支与福主${REL_CN[verdict.rel]}(+${verdict.points})`,
                en: `${verdict.rel === "sanhe" ? "San He" : "Liu He"} with patron (+${verdict.points})`,
                points: verdict.points,
            });
        }
        else if (verdict.action === "fuyin") {
            fuyin = true;
            adjustments.push({
                zh: "日支与福主本位（伏吟，婚嫁慎用）",
                en: "Day branch = patron branch (Fu Yin, cautious for weddings)",
                points: 0,
            });
        }
    }
    return { vetoes, adjustments, fuyin, localAdjustment };
}
async function enrichTopHours(dateStr, patronSlug, limit = 3) {
    const d = await api("hours", { date: dateStr });
    const hours = Array.isArray(d.hours) ? d.hours : [];
    return hours
        .filter((h) => {
        const rec = h;
        const hh = (rec.huanghei ?? {});
        if (hh.type !== "yellow")
            return false;
        if (patronSlug && String(rec.clash_zodiac ?? "").toLowerCase() === patronSlug)
            return false;
        return true;
    })
        .slice(0, limit);
}
// ─── 4. pick_auspicious_dates 择日 ───────────────────────────────
server.tool("pick_auspicious_dates", "Pick the best upcoming dates for a real-life event 择日 — weddings 嫁娶, moving 搬家, business openings 开业, renovations 动土, C-sections 剖腹产, contract signing / major purchases 签约买车买房, travel 出行, new jobs 入职. Engine uses four-tier spirit arbitration (協紀辨方書). Accepts natural-language synonyms (marriage, buy-a-car, 结婚, 装修…). With patron_birth, dates clashing/harming the patron's zodiac are vetoed, 三合/六合 get +15, and fixed inauspicious days (杨公忌/三娘煞/十恶大败/四离四绝) are hard-excluded. Returns engine_score vs local_adjustment separately with bilingual itemized reasons.", {
    activity: z.string().min(1).describe("Event 活动 — canonical: wedding|moving-house|grand-opening|renovation|c-section|signing-contracts|travel|starting-a-new-job; synonyms like marriage/买车/开业 all work"),
    days: z.number().int().min(7).max(60).optional().describe("Window in days 查询窗口天数 (default 30; counted from today 从今天起算)"),
    weekend_only: z.boolean().optional().describe("Only Saturdays/Sundays 仅周末 (default false)"),
    patron_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Patron's birthdate YYYY-MM-DD 福主生日 — enables zodiac match + fixed-inauspicious-day veto"),
}, async ({ activity, days, weekend_only, patron_birth }) => {
    const profile = resolveEvent(activity);
    if (!profile || profile.api === null) {
        const deepKeys = ["burial", "ancestor-worship"];
        return fmt({
            error: "unknown or deep-only activity",
            tip: deepKeys.some(k => activity.toLowerCase().includes(k.slice(0, 5)))
                ? `Use pick_dates_deep for ${activity} 安葬/祭祀`
                : "see list_activities for valid events",
        });
    }
    const d = await api("auspicious", { activity: profile.api, days, weekend_only: weekend_only ? 1 : undefined });
    const recs = Array.isArray(d.recommended_dates) ? d.recommended_dates : [];
    const patronSlug = patron_birth ? zodiacFromBirthDate(patron_birth) : null;
    const results = [];
    for (const rec of recs) {
        const r = rec;
        const dateStr = String(r.date ?? "");
        if (!dateStr)
            continue;
        const day = await api("day", { date: dateStr });
        if (!day || !day.lunar)
            continue;
        const base = Number(r.score ?? 0);
        const { vetoes, adjustments, fuyin, localAdjustment } = checkFixedDaysAndPatron(day, patronSlug, profile.vetoSanniang);
        if (vetoes.length > 0) {
            results.push({ date: dateStr, rejected: true, vetoes });
            continue;
        }
        const lunar = day.lunar;
        const pillar = day.day_pillar;
        const officer = day.day_officer_zhi_shen;
        const belt = day.belt;
        const jx = (day.jishen_xiongsha ?? {});
        results.push({
            date: dateStr,
            rejected: false,
            engine_score: base,
            local_adjustment: localAdjustment,
            score: base + localAdjustment,
            verdict: `${r.officer ?? officer.en} officer, ${r.belt ?? belt.type} belt`,
            why: r.why,
            lunar_cn: `${lunar.month}月${lunar.day}日`,
            day_pillar_cn: `${pillar.stem_cn ?? ""}${pillar.branch_cn ?? ""}`,
            officer_cn: officer.cn,
            belt_cn: belt.name_cn,
            clash: day.clash,
            sha_direction: day.sha_direction,
            yi: cleanList(day.auspicious_for_yi),
            ji: cleanList(day.avoid_ji),
            gods_auspicious: jx.auspicious ?? [],
            gods_caution: jx.caution ?? [],
            nayin: day.folk?.nayin ?? [],
            fuyin,
            adjustments,
            lucky_hours: await enrichTopHours(dateStr, patronSlug),
        });
    }
    const ok = results.filter(r => !r.rejected);
    ok.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
    return fmt({
        activity: d.activity, activity_cn: d.activity_cn,
        patron_zodiac: patronSlug,
        recommended: ok,
        rejected: results.filter(r => r.rejected),
        note: "engine score (0-5, four-tier arbitration) + local adjustment (zodiac/fixed days). Local logic cross-validated against tung-shing-almanac-skill.",
        attribution: ATTRIBUTION,
    });
});
// ─── 5. pick_dates_deep 深度择日 (安葬/祭祀) ─────────────────────
server.tool("pick_dates_deep", "Deep day-by-day scan for activities without an engine shortlist 深度逐日择日 — burial 安葬/funerals and ancestor worship 祭祀/祭拜. Iterates every day in the window (max 31 days): hard-vetoes fixed inauspicious days and patron clash, scores Day Officer + Yellow/Black Belt + auspicious gods + Yi-list match. Slower (1 request/day, cached server-side by the API) — keep windows short.", {
    activity: z.string().min(1).describe("Event 活动 — burial/安葬/下葬 or ancestor-worship/祭祀/祭拜 (other events: use pick_auspicious_dates)"),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Window start YYYY-MM-DD 起始日期"),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Window end YYYY-MM-DD 结束日期 (≤31 days after start)"),
    patron_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Patron's birthdate YYYY-MM-DD 福主生日"),
    top: z.number().int().min(1).max(10).optional().describe("Max results 返回条数 (default 5)"),
}, async ({ activity, start, end, patron_birth, top }) => {
    const profile = resolveEvent(activity);
    if (!profile || profile.api !== null) {
        return fmt({
            error: "pick_dates_deep is for burial/ancestor-worship (安葬/祭祀)",
            tip: "use pick_auspicious_dates for other events",
        });
    }
    const startD = new Date(`${start}T00:00:00Z`);
    const endD = new Date(`${end}T00:00:00Z`);
    if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || endD < startD) {
        return fmt({ error: "invalid window", tip: "end must be ≥ start, both YYYY-MM-DD" });
    }
    const span = Math.round((endD.getTime() - startD.getTime()) / 86400000) + 1;
    if (span > 31)
        return fmt({ error: "window too long", tip: "deep scan is capped at 31 days" });
    const patronSlug = patron_birth ? zodiacFromBirthDate(patron_birth) : null;
    const deepYi = {
        burial: ["burial", "funeral", "安葬", "启钻"],
        "ancestor-worship": ["worship", "prayer", "ancestor", "祭祀"],
    };
    const goodOfficers = {
        burial: ["Close", "Remove", "Stable", "Collect"],
        "ancestor-worship": ["Stable", "Close", "Remove", "Full"],
    };
    const preferGods = {
        burial: ["鸣吠", "鸣吠对", "天德", "月德", "三合"],
        "ancestor-worship": ["天德", "月德", "天愿", "民日", "福德"],
    };
    const OFFICER_SCORE = {
        Open: 15, Complete: 15, Stable: 10, Initiate: 10, Full: 8,
        Remove: 6, Collect: 4, Close: 2, Establish: 2, Balance: 4, Danger: 0, Break: -40,
    };
    const out = [];
    const termsCache = new Map();
    const cursor = new Date(startD);
    while (cursor <= endD && out.length < (top ?? 5) * 4) {
        const ds = cursor.toISOString().slice(0, 10);
        const day = await api("day", { date: ds });
        if (day && day.lunar && !day._error) {
            const lunar = day.lunar;
            const lm = Number(lunar.month ?? 0), ld = Number(lunar.day ?? 0);
            const pillar = day.day_pillar;
            const gzI = gzIndex(String(pillar.stem_cn ?? ""), String(pillar.branch_cn ?? ""));
            const yr = Number(ds.slice(0, 4));
            if (!termsCache.has(yr)) {
                const t = await api("term", { year: yr });
                termsCache.set(yr, (t.terms ?? {}));
            }
            let veto = "";
            if (isYangGongJi(lm, ld))
                veto = "杨公忌";
            if (!veto && isShiEDaBai(gzI))
                veto = "十恶大败";
            if (!veto) {
                const sl = siLiSiJue(ds, termsCache.get(yr));
                if (sl)
                    veto = sl;
            }
            if (!veto && patronSlug) {
                const relations = (day.relations ?? {});
                const map = Array.isArray(relations.map) ? relations.map : [];
                const relEntry = map.find((m) => m.slug === patronSlug);
                const verdict = patronRelation(relEntry ? String(relEntry.rel) : "plain");
                if (verdict.action === "veto")
                    veto = `本命${REL_CN[verdict.rel]}`;
            }
            if (!veto) {
                const officerEn = String(day.day_officer_zhi_shen.en ?? "");
                const beltType = String(day.belt.type ?? "");
                let score = OFFICER_SCORE[officerEn] ?? 0;
                if (beltType === "yellow")
                    score += 20;
                else if (beltType === "black")
                    score -= 5;
                const reasons = [];
                if (OFFICER_SCORE[officerEn]) {
                    reasons.push(`建除【${day.day_officer_zhi_shen.cn}】${officerEn} (${OFFICER_SCORE[officerEn] >= 0 ? "+" : ""}${OFFICER_SCORE[officerEn]})`);
                }
                reasons.push(`值神${day.belt.name_cn} ${beltType} belt (${beltType === "yellow" ? "+20" : "-5"})`);
                const jx = (day.jishen_xiongsha ?? {});
                const godsA = Array.isArray(jx.auspicious) ? jx.auspicious : [];
                const hits = godsA.filter(g => (preferGods[profile.key] ?? []).includes(g));
                if (hits.length > 0) {
                    const pts = Math.min(6 * hits.length, 18);
                    score += pts;
                    reasons.push(`吉神加持 ${hits.join(",")} (+${pts})`);
                }
                const yiText = cleanList(day.auspicious_for_yi).join(" ").toLowerCase();
                if ((deepYi[profile.key] ?? []).some(k => yiText.includes(k.toLowerCase()))) {
                    score += 12;
                    reasons.push("当日宜含本事项 Yi list covers this activity (+12)");
                }
                if (patronSlug) {
                    const relations = (day.relations ?? {});
                    const map = Array.isArray(relations.map) ? relations.map : [];
                    const relEntry = map.find((m) => m.slug === patronSlug);
                    const verdict = patronRelation(relEntry ? String(relEntry.rel) : "plain");
                    if (verdict.action === "bonus") {
                        score += verdict.points;
                        reasons.push(`日支与福主${REL_CN[verdict.rel]}(+${verdict.points})`);
                    }
                }
                out.push({
                    date: ds, score, officer: officerEn, belt: beltType,
                    day_pillar_cn: `${pillar.stem_cn ?? ""}${pillar.branch_cn ?? ""}`,
                    lunar_cn: `${lm}月${ld}日`, reasons,
                    lucky_hours: [],
                });
            }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    // enrich hours for finalists only
    out.sort((a, b) => Number(b.score) - Number(a.score));
    const finalists = out.slice(0, top ?? 5);
    for (const f of finalists) {
        f.lucky_hours = await enrichTopHours(String(f.date), patronSlug);
    }
    return fmt({
        event: profile.key, event_zh: profile.zh, patron_zodiac: patronSlug,
        window: { start, end, days: span },
        recommended: finalists,
        note: "deep scan: full local scoring (no engine shortlist exists for burial/worship)",
        attribution: ATTRIBUTION,
    });
});
// ─── 6. get_daily_horoscope 生肖日运 ─────────────────────────────
server.tool("get_daily_horoscope", "Get the daily luck score for a Chinese zodiac sign 查询某生肖当日运势 (0-100 + tier + 8 life categories) — rat/ox/tiger/rabbit/dragon/snake/horse/goat/monkey/rooster/dog/pig 鼠牛虎兔龙蛇马羊猴鸡狗猪.", {
    sign: z.string().min(2).describe("Zodiac sign 生肖 slug: rat, ox, tiger, rabbit, dragon, snake, horse, goat, monkey, rooster, dog, pig"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date YYYY-MM-DD (default today 默认今天)"),
}, async ({ sign, date }) => {
    const d = await api("horoscope", { sign, date });
    return fmt(d);
});
// ─── 7. get_personal_lucky_hours 个人吉时 ────────────────────────
server.tool("get_personal_lucky_hours", "Rank the 12 hours of a day for YOUR zodiac sign 查询个人吉时 — combines zodiac relations (三合 trine / 六合 harmony / 六冲 clash / 六害 harm) with the day's Yellow/Black Belt hours. Returns best_hours with 0-10 personal scores.", {
    zodiac: z.string().min(2).describe("User's zodiac sign 生肖: rat, ox, tiger, rabbit, dragon, snake, horse, goat, monkey, rooster, dog, pig"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date YYYY-MM-DD (default today 默认今天)"),
}, async ({ zodiac, date }) => {
    const d = await api("personal-hours", { zodiac, date });
    return fmt(d);
});
// ─── 8. list_activities 活动与同义词 ─────────────────────────────
server.tool("list_activities", "List the supported event types with all accepted synonyms (EN/CN) 列出支持的择日活动与全部中英同义词 — use this to validate the activity argument. 8 fast events use pick_auspicious_dates; burial 安葬 & ancestor-worship 祭祀 use pick_dates_deep.", {}, async () => fmt({
    fast_events: [
        { key: "wedding", scenario: "Wedding & engagement planning 婚嫁订婚", synonyms: ["marriage", "marry", "get-married", "engagement", "领证", "结婚", "嫁娶"] },
        { key: "moving-house", scenario: "Moving into a new home/office 搬家入宅", synonyms: ["moving", "move", "relocation", "搬家", "乔迁", "入宅"] },
        { key: "grand-opening", scenario: "Business launches & store openings 开业开市", synonyms: ["opening", "launch", "product-launch", "ribbon-cutting", "开业", "开张", "剪彩"] },
        { key: "renovation", scenario: "Renovation & groundbreaking 装修动土", synonyms: ["construction", "groundbreaking", "renovate", "装修", "动土", "修造"] },
        { key: "c-section", scenario: "Planning a C-section birth 剖腹产择吉", synonyms: ["cesarean", "childbirth", "birth", "剖腹产", "生孩子"] },
        { key: "signing-contracts", scenario: "Contract signing & major purchases 签约/买车/买房", synonyms: ["signing", "contract", "deal", "purchase", "buy-a-car", "buy-a-house", "签约", "买车", "买房", "交易"] },
        { key: "travel", scenario: "Trips & business travel 出行旅游", synonyms: ["trip", "journey", "vacation", "flying", "出行", "旅游", "出差"] },
        { key: "starting-a-new-job", scenario: "First day at a new job 入职赴任", synonyms: ["new-job", "job", "career", "入职", "赴任", "上班"] },
    ],
    deep_events: [
        { key: "burial", scenario: "Burial & funerals 安葬下葬", synonyms: ["funeral", "下葬", "落葬"], tool: "pick_dates_deep" },
        { key: "ancestor-worship", scenario: "Ancestor veneration 祭祀祭拜", synonyms: ["worship", "祭拜", "上坟"], tool: "pick_dates_deep" },
    ],
    weekend_only: "append weekend_only=true to pick_auspicious_dates for Sat/Sun only 仅周末",
    attribution: ATTRIBUTION,
}));
// ─── boot ────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`chinese-almanac-mcp v${PKG_VERSION} ready (12Zodiacs engine, JPL DE440s precision)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
