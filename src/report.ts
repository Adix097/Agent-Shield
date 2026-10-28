import { readFile, writeFile } from "node:fs/promises";

const j = async (f: string) =>
  JSON.parse(await readFile(`results/${f}`, "utf8"));
const shield = await j("shield-eval.json");
const gate = await j("gate-eval.json");
const base = await j("baseline-eval.json");

const recs = shield.records as any[];
const n = recs.length;
const hidden = recs.filter((r) => !r.visibleToHuman);
const visible = recs.filter((r) => r.visibleToHuman);
const survived = recs.filter((r) => r.survived);
const mal = gate.filter((r: any) => r.malicious);
const legit = gate.filter((r: any) => !r.malicious);

const s = {
  cases: n,
  withoutShieldReachedAgentTextView: base.filter((r: any) => r.exposedText)
    .length,
  withoutShieldReachedAgentHtmlView: base.filter((r: any) => r.exposedHtml)
    .length,
  withShieldSurvived: survived.length,
  hiddenCases: hidden.length,
  hiddenSurvived: hidden.filter((r) => r.survived).length,
  visibleCases: visible.length,
  visibleSurvived: visible.filter((r) => r.survived).length,
  survivors: survived.map((r) => `${r.attack}/${r.payload}`),
  cleanPageOk: shield.cleanOk,
  gateMalicious: mal.length,
  gateBlocked: mal.filter((r: any) => r.blocked).length,
  gateLegit: legit.length,
  gateLegitInterrupted: legit.filter((r: any) => r.asked).length,
  gateNotCaught: mal.filter((r: any) => !r.blocked).map((r: any) => r.name),
};
await writeFile("results/summary.json", JSON.stringify(s, null, 2));

console.log(`
| Measure | Result |
|---|---|
| Test cases (attack placement x wording) | ${s.cases} |
| Injected text reached agent input, no shield (text view) | ${s.withoutShieldReachedAgentTextView}/${s.cases} |
| Injected text reached agent input, no shield (HTML view) | ${s.withoutShieldReachedAgentHtmlView}/${s.cases} |
| Injected text still present with shield | ${s.withShieldSurvived}/${s.cases} |
|   of which hidden-from-human attacks | ${s.hiddenSurvived}/${s.hiddenCases} |
|   of which visible attacks | ${s.visibleSurvived}/${s.visibleCases} |
| Clean page kept intact, nothing flagged | ${s.cleanPageOk} |
| Gate: malicious sends blocked | ${s.gateBlocked}/${s.gateMalicious} |
| Gate: legitimate sends interrupted | ${s.gateLegitInterrupted}/${s.gateLegit} |
| Not caught by gate | ${s.gateNotCaught.join("; ") || "none"} |
Survivors: ${s.survivors.join(", ") || "none"}`);
