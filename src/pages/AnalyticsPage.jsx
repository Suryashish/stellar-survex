import { useMemo } from "react";
import { stroopsToXlm, formatUnix, formatRelative } from "../../lib/stellar.js";
import { truncate } from "../utils/constants.js";
import Section from "../components/Section.jsx";
import Field from "../components/Field.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Stat from "../components/Stat.jsx";

export default function AnalyticsPage({ wallet, scope, onSetScope, mySurveys, allIds, surveys, responses, selectedId, onSelect, check, onSetCheck, loading, onCheckHasResponded, onShare, onTip, onReloadResponses, onRefresh, totalCount, busyAction, disabled }) {
    const list = useMemo(() => {
        if (scope === "mine") return mySurveys;
        return allIds.map((id) => surveys[id]).filter(Boolean);
    }, [scope, mySurveys, allIds, surveys]);

    const selected = selectedId ? surveys[selectedId] : null;
    const responseList = selectedId ? responses[selectedId] : null;

    return (
        <div className="analytics-grid">
            <aside className="analytics-list card">
                <div className="panel-head">
                    <h2>Surveys</h2>
                    <button type="button" className="btn btn-outline btn-sm" onClick={onRefresh} disabled={disabled}>Refresh</button>
                </div>
                <div className="scope-tabs">
                    <button
                        type="button"
                        className={`scope-tab ${scope === "mine" ? "scope-active" : ""}`}
                        onClick={() => onSetScope("mine")}
                        disabled={!wallet}
                    >
                        My Surveys{wallet && ` (${mySurveys.length})`}
                    </button>
                    <button
                        type="button"
                        className={`scope-tab ${scope === "all" ? "scope-active" : ""}`}
                        onClick={() => onSetScope("all")}
                    >
                        All ({allIds.length})
                    </button>
                </div>

                {!wallet && scope === "mine" ? (
                    <p className="hint">Connect Freighter to see surveys you've created.</p>
                ) : list.length === 0 ? (
                    <p className="hint">No surveys to show.</p>
                ) : (
                    <ul className="manage-list-ul">
                        {list.map((s) => (
                            <li key={s.id}>
                                <button
                                    type="button"
                                    className={`manage-list-item ${selectedId === s.id ? "is-active" : ""}`}
                                    onClick={() => onSelect(s.id)}
                                >
                                    <div className="manage-list-top">
                                        <span className="survey-id-tag">{s.id}</span>
                                        <StatusPill status={s.status} />
                                    </div>
                                    <span className="manage-list-title">{s.title}</span>
                                    <span className="manage-list-meta">
                                        {s.response_count} responses · ends {formatRelative(s.end_time)}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="analytics-global-stat">
                    <span className="meta-label">Total on-chain</span>
                    <span className="meta-value">{totalCount ?? "—"}</span>
                </div>
            </aside>

            <div className="analytics-detail">
                {!selected ? (
                    <div className="empty-state inset">
                        <span className="empty-icon">←</span>
                        <h3>Pick a survey</h3>
                        <p>Select a survey from the list to load its full analytics.</p>
                    </div>
                ) : (
                    <>
                        <Section title={selected.title} tag={selected.id}>
                            <div className="manage-summary">
                                <StatusPill status={selected.status} />
                                <Stat label="Responses" value={`${selected.response_count}${selected.max_responses ? ` / ${selected.max_responses}` : ""}`} />
                                <Stat label="Questions" value={selected.question_count} />
                                <Stat label="Reward" value={`${stroopsToXlm(selected.reward_per_response)} XLM`} />
                                <Stat label="Created" value={formatUnix(selected.created_at)} small />
                                <Stat label="Closes" value={`${formatUnix(selected.end_time)} · ${formatRelative(selected.end_time)}`} small />
                            </div>
                            <p className="manage-desc">{selected.description || <em>No description</em>}</p>
                            <div className="row wrap">
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShare(selected.id)}>↗ Share Link</button>
                                <button type="button" className="btn btn-outline btn-sm" onClick={onReloadResponses}>Reload Responses</button>
                            </div>
                        </Section>

                        <div className="analytics-stats-row">
                            <div className={`big-card ${check.accepting === true ? "big-on" : check.accepting === false ? "big-off" : "big-neutral"}`}>
                                <span className="big-stat-label">Accepting Responses</span>
                                <span className="big-stat-value">
                                    {check.accepting === null ? "—" : check.accepting ? "Yes" : "No"}
                                </span>
                                <span className="hint">
                                    {check.accepting === true && "Active and within window"}
                                    {check.accepting === false && "Closed, paused, expired or full"}
                                </span>
                            </div>
                            <div className="big-card big-neutral">
                                <span className="big-stat-label">Response Count</span>
                                <span className="big-stat-value">{selected.response_count}</span>
                                {selected.max_responses > 0 && (
                                    <div className="progress-wrap">
                                        <div
                                            className="progress-fill"
                                            style={{ width: `${Math.min(100, (selected.response_count / selected.max_responses) * 100)}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="big-card big-neutral">
                                <span className="big-stat-label">Questions</span>
                                <span className="big-stat-value">{selected.question_count}</span>
                                <span className="hint">Total questions on-chain</span>
                            </div>
                        </div>

                        <Section title="Has Responded?" tag="dedup_check">
                            <p className="hint" style={{ marginBottom: "0.6rem" }}>
                                Check whether a specific address has already submitted a response to this survey.
                            </p>
                            <div className="grid-2">
                                <Field
                                    label="Address"
                                    value={check.respondent}
                                    onChange={(e) => onSetCheck((prev) => ({ ...prev, respondent: e.target.value }))}
                                    placeholder={wallet ? "Defaults to your connected wallet" : "G..."}
                                />
                            </div>
                            <div className="row wrap">
                                <button
                                    type="button"
                                    className={`btn btn-outline ${busyAction === "hasResp" ? "is-loading" : ""}`}
                                    onClick={() => onCheckHasResponded()}
                                    disabled={disabled}
                                >
                                    Check
                                </button>
                                {wallet && (
                                    <button
                                        type="button"
                                        className="btn btn-ghost"
                                        onClick={() => onCheckHasResponded(wallet.publicKey)}
                                        disabled={disabled}
                                    >
                                        Check Me
                                    </button>
                                )}
                            </div>
                            {check.hasResponded != null && (
                                <div className={`bool-stat ${check.hasResponded ? "bool-yes" : "bool-no"}`} style={{ marginTop: "0.85rem" }}>
                                    <span className="bool-icon">{check.hasResponded ? "✓" : "✗"}</span>
                                    <span className="bool-label">{truncate(check.respondent, 8, 8)}</span>
                                    <span className="bool-value">{check.hasResponded ? "Already responded" : "Not yet"}</span>
                                </div>
                            )}
                        </Section>

                        <Section title="Questions" tag={`${selected.question_count} total`}>
                            <ol className="questions-list">
                                {selected.questions.map((q, i) => (
                                    <li key={i}><span className="q-num">Q{i + 1}</span><span>{q}</span></li>
                                ))}
                            </ol>
                        </Section>

                        <Section title="All Responses" tag={`${responseList ? responseList.length : "—"} entries`}>
                            {loading && <p className="hint">Loading…</p>}
                            {!loading && (!responseList || responseList.length === 0) && (
                                <p className="hint">No responses yet. Share the link to invite people.</p>
                            )}
                            {responseList && responseList.length > 0 && (
                                <div className="responses-stack">
                                    {responseList.map((entry, idx) => {
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
                                                        {!isSelf && wallet && (
                                                            <button type="button" className="btn btn-xs btn-primary" onClick={() => onTip(entry.respondent, selected.id)}>
                                                                Tip XLM
                                                            </button>
                                                        )}
                                                    </div>
                                                </header>
                                                <ol className="qa-list">
                                                    {selected.questions.map((q, qi) => (
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
                    </>
                )}
            </div>
        </div>
    );
}
