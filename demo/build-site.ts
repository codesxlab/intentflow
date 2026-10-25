/**
 * Builds the static demo for GitHub Pages into site/:
 *   - bundles demo/browser.ts (mock provider + approval queue, runs in the page)
 *   - adds a "Measured results" table from evals/published/*.json
 *
 *   npm run site
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

interface Summary {
  cases: number;
  actionMatch: number;
  fullMatch: number;
}

interface Report extends Summary {
  date: string;
  provider: string;
  model: string;
  byLang: Record<string, Summary>;
  usage?: { calls: number; inputTokens: number; outputTokens: number };
  costUsd?: number;
}

const root = new URL("../", import.meta.url);
const out = new URL("site/", root);
const published = new URL("evals/published/", root);
const REPO = "https://github.com/codesxlab/intentflow";
const LANGS: Record<string, string> = { en: "English", tr: "Turkish", de: "German" };

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function resultsSection(): string {
  let files: string[] = [];
  try {
    files = readdirSync(published).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return "";
  }
  if (files.length === 0) return "";

  const reports = files.map((file) => ({ file, report: JSON.parse(readFileSync(new URL(file, published), "utf8")) as Report }));
  const langs = [...new Set(reports.flatMap(({ report }) => Object.keys(report.byLang)))];

  const head = ["Provider · model", "Date", ...langs.map((l) => LANGS[l] ?? l), "All", "Tokens / case", "Data"]
    .map((h) => `<th>${escape(h)}</th>`)
    .join("");
  const rows = reports
    .map(({ file, report }) => {
      const perLang = langs.map((l) => {
        const s = report.byLang[l];
        return `<td class="num">${s ? `${pct(s.fullMatch)} <span class="meta">(${pct(s.actionMatch)})</span>` : "–"}</td>`;
      });
      const tokens = report.usage && report.usage.calls > 0
        ? `${Math.round(report.usage.inputTokens / report.cases)} in · ${Math.round(report.usage.outputTokens / report.cases)} out`
        : "–";
      return [
        `<td>${escape(report.provider)} · <code>${escape(report.model)}</code></td>`,
        `<td>${escape(report.date.slice(0, 10))}</td>`,
        ...perLang,
        `<td class="num"><strong>${pct(report.fullMatch)}</strong> <span class="meta">(${pct(report.actionMatch)})</span></td>`,
        `<td class="num">${tokens}</td>`,
        `<td><a href="${REPO}/blob/main/evals/published/${encodeURIComponent(file)}">JSON</a></td>`,
      ].join("");
    })
    .map((cells) => `<tr>${cells}</tr>`)
    .join("\n");

  const total = reports[0]!.report.cases;
  return `<section class="results" aria-labelledby="results-title">
  <h2 id="results-title">3 · Measured results</h2>
  <p class="lead">The eval suite (<a href="${REPO}/blob/main/evals/cases.json">${total} requests</a> in ${langs.map((l) => LANGS[l] ?? l).join(", ")}) checks whether the provider picks the right action and fills the parameters a reviewer would expect. Cells show full match (action + parameters), with action accuracy in brackets.</p>
  <div class="table-wrap"><table>
    <thead><tr>${head}</tr></thead>
    <tbody>
${rows}
    </tbody>
  </table></div>
  <p class="meta">The mock provider is a keyword baseline that only knows English. Every number comes from <code>npm run eval</code>; the raw results, including each model output, are linked.</p>
</section>`;
}

mkdirSync(out, { recursive: true });

await build({
  entryPoints: [new URL("demo/browser.ts", root).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  outfile: new URL("app.js", out).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  logLevel: "warning",
});

const page = readFileSync(new URL("demo/index.html", root), "utf8")
  // Load the in-page "API" before the page script runs.
  .replace("<script>", '<script src="app.js"></script>\n<script>')
  .replace("<!-- results -->", resultsSection());

writeFileSync(new URL("index.html", out), page);
writeFileSync(new URL(".nojekyll", out), "");
console.log(`site built → ${new URL(".", out).pathname}`);
