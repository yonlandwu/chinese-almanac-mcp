/**
 * scoring.test.ts — cross-validation against test-vectors.json
 * exported from the Python engine (scripts/export_test_vectors.py).
 * Every vector must match 100%; a single mismatch fails the build.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  gzIndex, siLiSiJue, isYangGongJi, isSanniangSha, isShiEDaBai,
  patronRelation, resolveEvent, zodiacFromBirthDate, zodiacFromYearGzCn,
} from "./scoring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// vectors live in <repo>/scripts/test-vectors.json — resolve relative to the
// COMPILED file location (dist-test/ or dist/), walking up to repo root
function findVectors(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, "scripts", "test-vectors.json");
    if (readFileSync !== undefined) {
      try {
        readFileSync(candidate, "utf-8");
        return candidate;
      } catch {
        /* keep walking up */
      }
    }
    dir = dirname(dir);
  }
  throw new Error("test-vectors.json not found from " + startDir);
}
const vec = JSON.parse(readFileSync(findVectors(__dirname), "utf-8"));

let pass = 0, fail = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; failures.push(`${name}: expected ${e}, got ${a}`); }
}

// 1. gz_index — all 120 combos
for (const v of vec.gz_index) {
  check(`gz_index(${v.in.join(",")})`, gzIndex(v.in[0], v.in[1]), v.out);
}

// 2. si_li_si_jue — boundaries across 2 years
for (const v of vec.si_li_si_jue) {
  const [dateStr, terms] = v.in;
  check(`si_li_si_jue(${dateStr})`, siLiSiJue(dateStr, terms), v.out);
}

// 3. fixed days
for (const v of vec.fixed_days) {
  if (v.kind === "yangongji") {
    check(`yangongji(${v.in.join(",")})`, isYangGongJi(v.in[0], v.in[1]), v.out);
  } else if (v.kind === "sanniang") {
    check(`sanniang(${v.in[0]})`, isSanniangSha(v.in[0], true), v.out);
    check(`sanniang-off(${v.in[0]})`, isSanniangSha(v.in[0], false), false);
  } else if (v.kind === "shiedabai") {
    check(`shiedabai(${v.in[0]})`, isShiEDaBai(v.in[0]), v.out);
  }
}
// null ganzhi must not veto
check("shiedabai(null)", isShiEDaBai(null), false);

// 4. patron relations
for (const v of vec.relations) {
  const r = patronRelation(v.rel);
  const expected = v.out;
  if (expected === "veto") check(`rel(${v.rel})`, r.action, "veto");
  else if (expected === "fuyin") check(`rel(${v.rel})`, r.action, "fuyin");
  else if (typeof expected === "number" && expected > 0) {
    check(`rel(${v.rel})`, r.action, "bonus");
    check(`rel(${v.rel}).points`, r.points, expected);
  } else {
    check(`rel(${v.rel})`, r.action, "none");
  }
}

// 5. event resolution
for (const v of vec.resolve_event) {
  const p = resolveEvent(v.in);
  check(`resolve(${v.in})`, p ? p.key : null, v.out);
}

// 6. zodiac derivation (offline path — deterministic)
const zodiacCases: Array<[string, string]> = [
  ["1990-05-20", "horse"], ["1985-06-15", "ox"], ["1988-08-08", "dragon"],
  ["1984-02-05", "rat"],   ["1984-02-01", "pig"], // 立春 boundary: before Feb 4 → previous year
  ["2000-01-01", "rabbit"], // 1999 己卯, before lichun
];
for (const [birth, slug] of zodiacCases) {
  check(`zodiac(${birth})`, zodiacFromBirthDate(birth), slug);
}
// API year_gz_cn path
check("zodiacFromYearGzCn(丙午)", zodiacFromYearGzCn("丙午"), "horse");
check("zodiacFromYearGzCn(Bing Wu)", zodiacFromYearGzCn("Bing Wu"), null);

// ─── report ────────────────────────────────────────────────────────
console.log(`\npass=${pass} fail=${fail}`);
if (fail > 0) {
  console.error("FAILURES:\n" + failures.map(f => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
console.log("✓ TS scoring module matches Python engine 100%");
