/**
 * scoring.ts — transparent auspicious-day scoring, ported from the
 * tung-shing-almanac-skill Python engine (scripts/pick.py, v2.2).
 *
 * Correctness contract: every function here is validated against
 * test-vectors.json exported from the Python implementation
 * (scripts/export_test_vectors.py). Run `npm test` to cross-validate.
 *
 * Scoring split (matches Python v2.1+):
 *   - The /auspicious engine score (0-5, four-tier arbitration) IS the
 *     primary score. This module adds ONLY what the engine cannot know:
 *     fixed inauspicious days (hard veto), patron-zodiac relations
 *     (chong/hai veto, sanhe/liuhe +15, fuyin note), and reasons.
 */

// ─── JiaZi (六十甲子) indexing ──────────────────────────────────────
// 0-based sexagenary index via CRT: n % 10 === stem, n % 12 === branch.
// (The naive (stem*6+branch)%60 formula is WRONG — see pick.py history.)

const GAN = "甲乙丙丁戊己庚辛壬癸";
const ZHI = "子丑寅卯辰巳午未申酉戌亥";
const ANIMALS = ["rat", "ox", "tiger", "rabbit", "dragon", "snake",
  "horse", "goat", "monkey", "rooster", "dog", "pig"] as const;
export type ZodiacSlug = typeof ANIMALS[number];
const ANIMALS_CN = "鼠牛虎兔龙蛇马羊猴鸡狗猪";

export function gzIndex(stemCn: string, branchCn: string): number | null {
  const a = GAN.indexOf(stemCn);
  const b = ZHI.indexOf(branchCn);
  if (a < 0 || b < 0) return null;
  for (let n = 0; n < 60; n++) {
    if (n % 10 === a && n % 12 === b) return n;
  }
  return null; // odd parity mismatch — impossible GanZhi combo
}

// ─── Fixed inauspicious days (hard veto) ───────────────────────────

// 杨公十三忌 (lunar month, day), month 1-12
const YANGONGJI_LUNAR: ReadonlySet<string> = new Set([
  "1,13", "2,11", "3,9", "4,7", "5,5", "6,3",
  "7,1", "7,29", "8,27", "9,25", "10,23", "11,21", "12,19",
]);
// 三娘煞 (lunar day)
const SANNIANG_LUNAR_DAY: ReadonlySet<number> = new Set([3, 7, 13, 18, 22, 27]);
// 十恶大败 (day JiaZi index): 甲辰40 乙巳41 丙申32 丁亥23 戊戌34
//                              己丑25 庚辰16 辛巳17 壬申8 癸亥59
const SHIEDABAI_GZ: ReadonlySet<number> = new Set([40, 41, 32, 23, 34, 25, 16, 17, 8, 59]);

export function isYangGongJi(lunarMonth: number, lunarDay: number): boolean {
  return YANGONGJI_LUNAR.has(`${lunarMonth},${lunarDay}`);
}
export function isSanniangSha(lunarDay: number, eventVetoSanniang: boolean): boolean {
  return eventVetoSanniang && SANNIANG_LUNAR_DAY.has(lunarDay);
}
export function isShiEDaBai(dayGzIndex: number | null): boolean {
  return dayGzIndex !== null && SHIEDABAI_GZ.has(dayGzIndex);
}

// 四离 (day before 二分二至) & 四绝 (day before 四立).
// terms: per-year map from GET /term — { key: { date: "YYYY-MM-DD", ... } }.
// NEVER merge term maps across years (keys collide: qiufen exists every year).
const SI_LI = new Set(["chunfen", "xiazhi", "qiufen", "dongzhi"]);
const SI_JUE = new Set(["lichun", "lixia", "liqiu", "lidong"]);

export function siLiSiJue(
  dateStr: string,
  terms: Record<string, { date?: string } | undefined>
): "四离" | "四绝" | null {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const next = d.toISOString().slice(0, 10);
  for (const [key, val] of Object.entries(terms)) {
    if (!val?.date || val.date !== next) continue;
    if (SI_LI.has(key)) return "四离";
    if (SI_JUE.has(key)) return "四绝";
  }
  return null;
}

// ─── Patron zodiac relations ───────────────────────────────────────

export interface RelationVerdict {
  action: "veto" | "bonus" | "fuyin" | "none";
  points: number; // 15 for sanhe/liuhe, else 0
  rel: string;
}

export function patronRelation(rel: string | undefined): RelationVerdict {
  switch (rel) {
    case "chong":
    case "hai":
      return { action: "veto", points: 0, rel };
    case "sanhe":
    case "liuhe":
      return { action: "bonus", points: 15, rel };
    case "self":
      return { action: "fuyin", points: 0, rel };
    default:
      return { action: "none", points: 0, rel: rel ?? "plain" };
  }
}

export function zodiacFromYearGzCn(yearGzCn: string): ZodiacSlug | null {
  if (yearGzCn.length < 2) return null;
  const i = ZHI.indexOf(yearGzCn[1]);
  return i >= 0 ? ANIMALS[i] : null;
}

// Offline fallback: year GanZhi from the 1984 甲子 cycle, 立春 (Feb 4) boundary.
export function zodiacFromBirthDate(birth: string): ZodiacSlug | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth);
  if (!m) return null;
  const year = Number(m[1]);
  const beforeLichun = Number(m[2]) < 2 || (Number(m[2]) === 2 && Number(m[3]) < 4);
  const gzYear = year - (beforeLichun ? 1 : 0);
  const idx = ((gzYear - 1984) % 60 + 60) % 60;
  return ANIMALS[idx % 12];
}

// ─── Event profiles (aliases + veto flags) ────────────────────────

export interface EventProfile {
  key: string;
  zh: string;
  aliases: string[];
  api: string | null; // null → deep scan only
  vetoSanniang: boolean;
}

export const PROFILES: EventProfile[] = [
  { key: "wedding", zh: "婚嫁", aliases: ["marriage", "结婚", "嫁娶", "领证", "婚"], api: "wedding", vetoSanniang: true },
  { key: "moving-house", zh: "入宅", aliases: ["moving", "搬家", "乔迁", "入宅", "移徙"], api: "moving-house", vetoSanniang: false },
  { key: "grand-opening", zh: "开业", aliases: ["opening", "launch", "开业", "开市", "剪彩"], api: "grand-opening", vetoSanniang: false },
  { key: "renovation", zh: "装修动土", aliases: ["renovation", "装修", "动土", "修造"], api: "renovation", vetoSanniang: false },
  { key: "signing-contracts", zh: "签约交易", aliases: ["signing", "contract", "签约", "交易", "买车", "买房"], api: "signing-contracts", vetoSanniang: false },
  { key: "travel", zh: "出行", aliases: ["trip", "travel", "出行", "旅游", "出差"], api: "travel", vetoSanniang: false },
  { key: "starting-a-new-job", zh: "入职赴任", aliases: ["new-job", "job", "入职", "赴任", "上任"], api: "starting-a-new-job", vetoSanniang: false },
  { key: "c-section", zh: "剖腹产", aliases: ["cesarean", "childbirth", "剖腹产", "生子"], api: "c-section", vetoSanniang: false },
  { key: "burial", zh: "安葬", aliases: ["funeral", "下葬", "安葬", "落葬"], api: null, vetoSanniang: false },
  { key: "ancestor-worship", zh: "祭祀", aliases: ["worship", "祭祀", "祭拜", "上坟"], api: null, vetoSanniang: false },
];

export function resolveEvent(raw: string): EventProfile | null {
  const r = raw.trim().toLowerCase();
  return PROFILES.find(p => r === p.key || r === p.zh || p.aliases.includes(r)) ?? null;
}

export const SANHE_LIUHE_SCORE = 15;
export const REL_CN: Record<string, string> = {
  chong: "冲", sanhe: "三合", liuhe: "六合", hai: "害", self: "本位", plain: "平",
};
