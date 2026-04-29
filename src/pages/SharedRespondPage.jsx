import { useMemo } from "react";
import { stroopsToXlm, formatUnix } from "../../lib/stellar.js";
import { nowTs } from "../utils/constants.js";
import Stat from "../components/Stat.jsx";

export default function SharedRespondPage({ state, surveyId, wallet, answers, onSetAnswer, onConnect, onDisconnect, onSubmit, onExit, connecting, submitting, disabled }) {
    const { loading, survey, hasResponded: alreadyResponded, submitted } = state;
    const flags = useMemo(() => {
        if (!survey) return { expired: false, closed: false, full: false, blocking: false };
        const expired = survey.end_time < nowTs();
        const closed = survey.status !== "Active";
        const full = survey.max_responses > 0 && survey.response_count >= survey.max_responses;
        return { expired, closed, full, blocking: expired || closed || full };
    }, [survey]);
    const { expired, closed, full, blocking } = flags;
    const canRespond = wallet && !alreadyResponded && !blocking && !submitted;

    return (
        <div className="shared-page">
            <div className="grain" aria-hidden="true" />

            <header className="shared-header">
                <button type="button" className="shared-brand" onClick={onExit} title="Open Survex">
                    <span className="brand-mark">SX</span>
                    <span className="brand-text">
                        <strong>Survex</strong>
                        <span>Soroban · Testnet</span>
                    </span>
                </button>

                <div className="shared-header-right">
                    {wallet ? (
                        <>
                            <span className="pill pill-on">
                                <span className="pill-dot" />
                                {wallet.publicKey.slice(0, 6)}…{wallet.publicKey.slice(-4)}
                            </span>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={onDisconnect} disabled={disabled}>Disconnect</button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className={`btn btn-primary btn-sm ${connecting ? "is-loading" : ""}`}
                            onClick={onConnect}
                            disabled={disabled}
                        >
                            Connect Freighter
                        </button>
                    )}
                </div>
            </header>

            <main className="shared-main">
                {loading && (
                    <div className="shared-card empty-state">
                        <div className="loader-row">
                            <span className="loader-dot" />
                            <span className="loader-dot" />
                            <span className="loader-dot" />
                        </div>
                        <p>Loading survey…</p>
                    </div>
                )}

                {!loading && !survey && (
                    <div className="shared-card empty-state">
                        <span className="empty-icon">∅</span>
                        <h3>Survey not found</h3>
                        <p>The survey <span className="mono small">{surveyId}</span> doesn't exist on this contract — the link may be incorrect or for a different deployment.</p>
                        <button type="button" className="btn btn-outline" onClick={onExit}>Browse all surveys</button>
                    </div>
                )}

                {survey && (
                    <article className="shared-card">
                        <span className="shared-tag">SURVEY · {survey.id}</span>
                        <h1 className="shared-title">{survey.title}</h1>
                        {survey.description && <p className="shared-desc">{survey.description}</p>}

                        <div className="shared-meta">
                            <Stat label="Questions" value={survey.question_count} />
                            <Stat label="Responses" value={`${survey.response_count}${survey.max_responses ? ` / ${survey.max_responses}` : ""}`} />
                            <Stat label="Reward" value={`${stroopsToXlm(survey.reward_per_response)} XLM`} />
                            <Stat label="Closes" value={`${formatUnix(survey.end_time)}`} small />
                        </div>

                        {submitted && (
                            <div className="shared-success">
                                <span className="shared-success-icon">✓</span>
                                <h2>Thanks for your response!</h2>
                                <p>Your answers were recorded on-chain.</p>
                                <button type="button" className="btn btn-outline" onClick={onExit}>Browse other surveys</button>
                            </div>
                        )}

                        {!submitted && blocking && (
                            <div className="shared-blocking">
                                <span className="shared-blocking-icon">⛔</span>
                                <h2>
                                    {expired && "This survey has ended"}
                                    {!expired && full && "Response cap reached"}
                                    {!expired && !full && closed && `This survey is ${survey.status.toLowerCase()}`}
                                </h2>
                                <p>Responses are no longer being accepted. Reach out to the creator if you think this is a mistake.</p>
                                <button type="button" className="btn btn-outline" onClick={onExit}>Browse other surveys</button>
                            </div>
                        )}

                        {!submitted && !blocking && !wallet && (
                            <div className="shared-cta">
                                <span className="shared-cta-eyebrow">Step 1 of 2</span>
                                <h2>Connect your wallet to respond</h2>
                                <p>Your wallet address signs your submission. We never store your secret key — Freighter does the signing locally.</p>
                                <button
                                    type="button"
                                    className={`btn btn-primary btn-lg ${connecting ? "is-loading" : ""}`}
                                    onClick={onConnect}
                                    disabled={disabled}
                                >
                                    Connect Freighter
                                </button>
                                <p className="hint" style={{ marginTop: "0.85rem" }}>
                                    Don't have Freighter? <a href="https://www.freighter.app/" target="_blank" rel="noreferrer" className="link-btn">Install it ↗</a>
                                </p>
                            </div>
                        )}

                        {!submitted && !blocking && wallet && alreadyResponded && (
                            <div className="shared-already">
                                <span className="shared-success-icon">✓</span>
                                <h2>You've already responded</h2>
                                <p>The contract has your previous response on file. Each address can submit only once per survey.</p>
                                <button type="button" className="btn btn-outline" onClick={onExit}>Browse other surveys</button>
                            </div>
                        )}

                        {canRespond && (
                            <div className="shared-form">
                                <div className="shared-form-head">
                                    <span className="shared-cta-eyebrow">Step 2 of 2</span>
                                    <h2>Your Answers</h2>
                                </div>

                                <div className="answers-stack">
                                    {survey.questions.map((q, i) => (
                                        <div className="answer-row" key={i}>
                                            <label><span className="q-num">Q{i + 1}</span> {q}</label>
                                            <textarea
                                                rows={2}
                                                value={answers[i] || ""}
                                                onChange={(e) => onSetAnswer(i, e.target.value)}
                                                placeholder="Your answer…"
                                            />
                                        </div>
                                    ))}
                                </div>

                                <div className="shared-form-foot">
                                    <button
                                        type="button"
                                        className={`btn btn-primary btn-lg ${submitting ? "is-loading" : ""}`}
                                        onClick={onSubmit}
                                        disabled={disabled}
                                    >
                                        Submit Response
                                    </button>
                                    <span className="hint">
                                        Submitting signs a Soroban transaction with your wallet. Network fees are paid in XLM.
                                    </span>
                                </div>
                            </div>
                        )}
                    </article>
                )}

                <div className="shared-foot">
                    <button type="button" className="link-btn" onClick={onExit}>← Open the full Survex app</button>
                </div>
            </main>
        </div>
    );
}
