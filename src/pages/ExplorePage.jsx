import { stroopsToXlm, formatUnix, formatRelative } from "../../lib/stellar.js";
import { truncate } from "../utils/constants.js";
import StatusPill from "../components/StatusPill.jsx";
import Stat from "../components/Stat.jsx";

export default function ExplorePage({ ids, surveys, responses, loading, onRefresh, onExpand, onCollapse, onRespond, onManage, onShare, onTip, onLoadResponses, wallet, expanded, visibilityById, viewersById, coAdminsById }) {
    const visibleIds = ids.filter((id) => {
        const s = surveys[id];
        if (!s) return true; // skeleton — keep so layout doesn't pop
        const isPriv = !!visibilityById?.[id];
        if (!isPriv) return true;
        if (!wallet) return false;
        if (s.creator === wallet.publicKey) return true;
        if ((coAdminsById?.[id] || []).includes(wallet.publicKey)) return true;
        if ((viewersById?.[id] || []).includes(wallet.publicKey)) return true;
        return false;
    });
    const hiddenCount = ids.length - visibleIds.length;

    return (
        <div className="explore">
            <div className="explore-head">
                <div>
                    <h2>All Surveys</h2>
                    <p>
                        Click any survey to expand. Tap Share to copy a public link.
                        {hiddenCount > 0 && <> · <span className="hint">{hiddenCount} private survey{hiddenCount === 1 ? "" : "s"} hidden</span></>}
                    </p>
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={onRefresh} disabled={loading}>
                    {loading ? "Loading…" : "Refresh"}
                </button>
            </div>

            {loading && ids.length === 0 && (
                <div className="empty-state">
                    <div className="loader-row">
                        <span className="loader-dot" />
                        <span className="loader-dot" />
                        <span className="loader-dot" />
                    </div>
                    <p>Loading surveys from chain…</p>
                </div>
            )}

            {!loading && ids.length === 0 && (
                <div className="empty-state">
                    <span className="empty-icon">∅</span>
                    <h3>No surveys yet</h3>
                    <p>Be the first — head to <strong>01 / Create</strong>.</p>
                </div>
            )}

            <div className="survey-grid">
                {visibleIds.map((id) => {
                    const s = surveys[id];
                    const isExpanded = expanded === id;
                    const list = responses[id];
                    const isCreator = wallet && s && s.creator === wallet.publicKey;
                    const isCoAdminHere = wallet && s && (coAdminsById?.[id] || []).includes(wallet.publicKey);
                    const canManage = isCreator || isCoAdminHere;
                    const isPriv = !!visibilityById?.[id];

                    return (
                        <article key={id} className={`survey-card ${isExpanded ? "is-selected" : ""}`}>
                            {s ? (
                                <>
                                    <header className="survey-card-head">
                                        <div className="survey-id">
                                            <span className="survey-id-tag">{id}</span>
                                            <StatusPill status={s.status} />
                                            {isPriv && <span className="role-tag role-private">Private</span>}
                                        </div>
                                        <button type="button" className="icon-btn" title="Share" onClick={() => onShare(id)}>↗</button>
                                    </header>
                                    <h3 className="survey-title">{s.title}</h3>
                                    <p className="survey-desc">{s.description || "No description"}</p>

                                    <div className="survey-meta">
                                        <Stat label="Responses" value={`${s.response_count}${s.max_responses ? ` / ${s.max_responses}` : ""}`} />
                                        <Stat label="Questions" value={s.question_count} />
                                        <Stat label="Reward" value={`${stroopsToXlm(s.reward_per_response)} XLM`} />
                                        <Stat label="Ends" value={formatRelative(s.end_time)} small />
                                    </div>

                                    <div className="survey-actions">
                                        <button type="button" className="btn btn-sm btn-primary" onClick={() => onRespond(id)}>Respond</button>
                                        {canManage && (
                                            <button type="button" className="btn btn-sm btn-outline" onClick={() => onManage(id)}>Manage</button>
                                        )}
                                        <button
                                            type="button"
                                            className="btn btn-sm btn-ghost"
                                            onClick={() => isExpanded ? onCollapse() : onExpand(id)}
                                        >
                                            {isExpanded ? "Hide" : "Details"}
                                        </button>
                                    </div>

                                    {isExpanded && (
                                        <div className="survey-expanded">
                                            <div className="survey-meta-row">
                                                <span className="meta-label">Closes</span>
                                                <span className="meta-value small">{formatUnix(s.end_time)}</span>
                                            </div>
                                            <div className="survey-meta-row">
                                                <span className="meta-label">Creator</span>
                                                <span className="mono small">{truncate(s.creator, 8, 8)}</span>
                                            </div>

                                            <div className="participants">
                                                <div className="participants-head">
                                                    <strong>Responses</strong>
                                                    <button type="button" className="link-btn" onClick={() => onLoadResponses(id)}>Reload</button>
                                                </div>
                                                {!list && <span className="hint">Click Reload to fetch responses.</span>}
                                                {list && list.length === 0 && <span className="hint">No responses yet.</span>}
                                                {list && list.length > 0 && (
                                                    <ul className="participant-list">
                                                        {list.map((entry, idx) => (
                                                            <li key={`${entry.respondent}-${idx}`}>
                                                                <span className="mono small">{truncate(entry.respondent, 8, 8)}</span>
                                                                <span className="hint">{formatUnix(entry.submitted_at)}</span>
                                                                {wallet?.publicKey && wallet.publicKey !== entry.respondent && (
                                                                    <button type="button" className="btn btn-xs btn-primary" onClick={() => onTip(entry.respondent, id)}>
                                                                        Tip
                                                                    </button>
                                                                )}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="survey-skeleton">
                                    <div className="skeleton-line" />
                                    <div className="skeleton-line short" />
                                </div>
                            )}
                        </article>
                    );
                })}
            </div>
        </div>
    );
}
