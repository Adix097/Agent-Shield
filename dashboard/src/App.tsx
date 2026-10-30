import { useEffect, useState } from "react";

const API_URL = "http://localhost:5001";

type Summary = {
  cases: number;
  withoutShieldReachedAgentTextView: number;
  withoutShieldReachedAgentHtmlView: number;
  withShieldSurvived: number;
  hiddenCases: number;
  hiddenSurvived: number;
  visibleCases: number;
  visibleSurvived: number;
  survivors: string[];
  cleanPageOk: boolean;
  gateMalicious: number;
  gateBlocked: number;
  gateLegit: number;
  gateLegitInterrupted: number;
  gateNotCaught: string[];
};

type GateRow = {
  name: string;
  malicious: boolean;
  blocked: boolean;
  knownGap: boolean;
};

type Results = {
  summary: Summary | null;
  gateEval: GateRow[] | null;
};

type Progress = { done: number; total: number; label: string };

const formatPercent = (value: number, total: number) =>
  total ? `${((value / total) * 100).toFixed(1)}%` : "—";

const Metric = ({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) => (
  <article className="panel metric">
    <div className="metric-label">{label}</div>
    <div className={`metric-value ${tone}`}>{value}</div>
  </article>
);

function App() {
  const [results, setResults] = useState<Results | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Loading results");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/api/results`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load results.");
        return response.json();
      })
      .then((data) => {
        setResults(data);
        setStatus("Results loaded");
      })
      .catch((reason: Error) => {
        setError(reason.message);
        setStatus("Run failed");
      });
  }, []);

  const runEvaluation = (name: "shield-eval" | "baseline" | "gate-eval") => {
    setRunning(true);
    setError("");
    setProgress({ done: 0, total: 0, label: "Starting evaluation…" });
    setStatus("Evaluation running");

    const source = new EventSource(`${API_URL}/api/run/${name}`);
    source.addEventListener("progress", (event: MessageEvent<string>) => {
      setProgress(JSON.parse(event.data) as Progress);
    });
    source.addEventListener("done", (event: MessageEvent<string>) => {
      setResults(JSON.parse(event.data) as Results);
      setProgress(null);
      setRunning(false);
      setStatus("Results updated");
      source.close();
    });
    source.addEventListener("error", (event: MessageEvent<string>) => {
      if (event.data) {
        setError((JSON.parse(event.data) as { message: string }).message);
      }
      setProgress(null);
      setRunning(false);
      setStatus("Run failed");
      source.close();
    });
  };

  const summary = results?.summary;
  const survivors = [
    ...(summary?.survivors ?? []),
    ...(summary?.gateNotCaught ?? []),
  ];

  return (
    <main>
      <header>
        <div>
          <div className="eyebrow">Agent Shield / Control room</div>
          <h1>See the shield hold the line.</h1>
          <p className="intro">
            Run deterministic benchmarks, watch each case move through the
            pipeline, and inspect the evidence behind every headline number.
          </p>
        </div>
        <div className={`status ${running ? "busy" : ""}`}>{status}</div>
      </header>

      <section className="panel controls" aria-label="Run evaluations">
        <button disabled={running} onClick={() => runEvaluation("shield-eval")}>
          Run Shield Eval
        </button>
        <button disabled={running} onClick={() => runEvaluation("baseline")}>
          Run Baseline
        </button>
        <button disabled={running} onClick={() => runEvaluation("gate-eval")}>
          Run Gate Eval
        </button>
      </section>

      {progress && (
        <section className="panel progress-wrap" aria-live="polite">
          <div className="progress-head">
            <strong>{progress.label}</strong>
            <span>
              {progress.done} / {progress.total || "…"}
            </span>
          </div>
          <div className="track">
            <div
              className="bar"
              style={{
                width: progress.total
                  ? `${Math.min(100, (progress.done / progress.total) * 100)}%`
                  : "0%",
              }}
            />
          </div>
        </section>
      )}

      {error && <div className="error">{error}</div>}

      <section className="section">
        <div className="section-title">
          <h2>Benchmark snapshot</h2>
          <span className="section-note">
            from <code>results/summary.json</code>
          </span>
        </div>
        {summary ? (
          <div className="metrics">
            <Metric label="Shielded cases" value={summary.cases} tone="good" />
            <Metric
              label="Survived with shield"
              value={`${summary.withShieldSurvived} · ${formatPercent(summary.withShieldSurvived, summary.cases)}`}
              tone={summary.withShieldSurvived ? "warn" : "good"}
            />
            <Metric
              label="Hidden attacks stopped"
              value={`${summary.hiddenCases - summary.hiddenSurvived} · ${formatPercent(summary.hiddenCases - summary.hiddenSurvived, summary.hiddenCases)}`}
              tone="good"
            />
            <Metric
              label="Malicious sends blocked"
              value={`${summary.gateBlocked}/${summary.gateMalicious} · ${formatPercent(summary.gateBlocked, summary.gateMalicious)}`}
              tone={summary.gateBlocked === summary.gateMalicious ? "good" : "warn"}
            />
          </div>
        ) : (
          <div className="panel empty-card">No results found on disk yet.</div>
        )}
      </section>

      <section className="section grid">
        <div className="panel card">
          <div className="section-title">
            <h2>Shield coverage</h2>
            <span className="section-note">lower survival is better</span>
          </div>
          {summary && (
            <table>
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>Result</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Without shield · text view</td>
                  <td>
                    {summary.withoutShieldReachedAgentTextView}/{summary.cases}
                  </td>
                  <td>
                    {formatPercent(
                      summary.withoutShieldReachedAgentTextView,
                      summary.cases,
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Without shield · HTML view</td>
                  <td>
                    {summary.withoutShieldReachedAgentHtmlView}/{summary.cases}
                  </td>
                  <td>
                    {formatPercent(
                      summary.withoutShieldReachedAgentHtmlView,
                      summary.cases,
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Survived with shield</td>
                  <td>
                    {summary.withShieldSurvived}/{summary.cases}
                  </td>
                  <td>{formatPercent(summary.withShieldSurvived, summary.cases)}</td>
                </tr>
                <tr>
                  <td>Hidden-from-human survived</td>
                  <td>
                    {summary.hiddenSurvived}/{summary.hiddenCases}
                  </td>
                  <td>{formatPercent(summary.hiddenSurvived, summary.hiddenCases)}</td>
                </tr>
                <tr>
                  <td>Clean page preserved</td>
                  <td colSpan={2}>
                    <span className={`pill ${summary.cleanPageOk ? "pass" : "fail"}`}>
                      {summary.cleanPageOk ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="panel card">
          <div className="section-title">
            <h2>Email gate</h2>
            <span className="section-note">approval boundary results</span>
          </div>
          {results?.gateEval ? (
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Type</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {results.gateEval.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>
                      <span className={`pill ${row.malicious ? "fail" : "pass"}`}>
                        {row.malicious ? "attack" : "legit"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`pill ${row.blocked ? "pass" : row.malicious ? "gap" : "pass"}`}
                      >
                        {row.blocked ? "blocked" : row.malicious ? "not caught" : "allowed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Run Gate Eval to see each scenario.</div>
          )}
        </div>
      </section>

      <section className="section panel card">
        <div className="section-title">
          <h2>Known survivors & gaps</h2>
          <span className="section-note">reported, never hidden</span>
        </div>
        {survivors.length ? (
          <div className="survivors">
            {survivors.map((survivor) => (
              <span className="survivor" key={survivor}>
                {survivor}
              </span>
            ))}
          </div>
        ) : (
          <span className="pill pass">No known survivors</span>
        )}
      </section>

      <footer>
        Agent Shield is a research/demo project. These measurements cover the
        included fixtures, not every possible attack.
      </footer>
    </main>
  );
}

export default App;
