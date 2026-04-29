import { formatUnix } from "../../lib/stellar.js";
import { downloadResponsesCsv } from "../utils/exportResponses.js";
import Section from "./Section.jsx";

export default function ResponsesSection({ survey, responses, onReload, onTip, wallet }) {
    const hasResponses = Array.isArray(responses) && responses.length > 0;
    return (
        <Section title="Responses" tag={`${responses ? responses.length : "—"} total`}>
            <div className="row" style={{ marginBottom: "0.75rem" }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={onReload}>Reload</button>
                <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => downloadResponsesCsv(survey, responses)}
                    disabled={!hasResponses}
                    title={hasResponses ? "Download all responses as CSV" : "No responses to export"}
                >
                    ⬇ Export CSV
                </button>
            </div>

            {!responses && <p className="hint">Loading responses…</p>}
            {responses && responses.length === 0 && <p className="hint">No responses yet. Share the link to invite people.</p>}

            {responses && responses.length > 0 && (
                <div className="responses-stack">
                    {responses.map((entry, idx) => {
                        const isSelf = wallet?.publicKey === entry.respondent;
                        return (
                            <article key={`${entry.respondent}-${idx}`} className="response-card">
                                <header className="response-head">
                                    <div className="response-id">
                                        <span className="response-num">#{idx + 1}</span>
                                        <span className="mono small">{entry.respondent}</span>
                                    </div>
                                    <div className="response-meta">
                                        <span className="hint">{formatUnix(entry.submitted_at)}</span>
                                        {!isSelf && (
                                            <button type="button" className="btn btn-xs btn-primary" onClick={() => onTip(entry.respondent)}>
                                                Tip XLM
                                            </button>
                                        )}
                                    </div>
                                </header>
                                <ol className="qa-list">
                                    {survey.questions.map((q, qi) => (
                                        <li key={qi} className="qa-item">
                                            <span className="qa-q"><span className="q-num">Q{qi + 1}</span> {q}</span>
                                            <span className="qa-a">{entry.answers[qi] ?? <em>—</em>}</span>
                                        </li>
                                    ))}
                                </ol>
                            </article>
                        );
                    })}
                </div>
            )}
        </Section>
    );
}
