import { stroopsToXlm, formatUnix, formatRelative, localInputToUnix } from "../../lib/stellar.js";
import Section from "../components/Section.jsx";
import Field from "../components/Field.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Stat from "../components/Stat.jsx";
import ManageBtn from "../components/ManageBtn.jsx";
import ResponsesSection from "../components/ResponsesSection.jsx";

export default function ManagePage({ wallet, mySurveys, selectedId, survey, responses, form, onSelect, onChange, onPause, onResume, onClose, onExtend, onWithdrawFunds, onEnableWhitelist, onAddWhitelist, onShare, onTip, onReloadResponses, busyAction, confirmKey, disabled }) {
    if (!wallet) {
        return (
            <Section title="Manage Surveys" tag="creator-only">
                <div className="empty-state inset">
                    <span className="empty-icon">⚠</span>
                    <h3>Connect a wallet</h3>
                    <p>Connect Freighter to see and edit surveys you've created.</p>
                </div>
            </Section>
        );
    }
    if (mySurveys.length === 0) {
        return (
            <Section title="Manage Surveys" tag="creator-only">
                <div className="empty-state inset">
                    <span className="empty-icon">∅</span>
                    <h3>No surveys created yet</h3>
                    <p>Head to <strong>01 / Create</strong> to publish your first survey.</p>
                </div>
            </Section>
        );
    }

    return (
        <div className="manage-grid">
            <aside className="manage-list card">
                <div className="panel-head">
                    <h2>My Surveys</h2>
                    <span className="panel-tag">{mySurveys.length}</span>
                </div>
                <ul className="manage-list-ul">
                    {mySurveys.map((s) => (
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
            </aside>

            <div className="manage-detail">
                {survey ? (
                    <>
                        <Section title={survey.title} tag={survey.id}>
                            <div className="manage-summary">
                                <StatusPill status={survey.status} />
                                <Stat label="Responses" value={`${survey.response_count}${survey.max_responses ? ` / ${survey.max_responses}` : ""}`} />
                                <Stat label="Questions" value={survey.question_count} />
                                <Stat label="Reward" value={`${stroopsToXlm(survey.reward_per_response)} XLM`} />
                                <Stat label="Ends" value={`${formatUnix(survey.end_time)}`} small />
                                <Stat label="Created" value={`${formatUnix(survey.created_at)}`} small />
                            </div>
                            <p className="manage-desc">{survey.description || <em>No description</em>}</p>

                            <div className="row wrap manage-actions">
                                <ManageBtn id="pause" label="Pause" variant="outline" onClick={onPause} busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                                <ManageBtn id="resume" label="Resume" variant="outline" onClick={onResume} busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                                <ManageBtn id="close" label="Close Survey" variant="danger" onClick={onClose} confirmLabel="Confirm Close?" busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                                <button type="button" className="btn btn-ghost" onClick={() => onShare(survey.id)}>↗ Share Link</button>
                            </div>
                        </Section>

                        <Section title="Schedule & Escrow" tag="lifecycle">
                            <div className="grid-2">
                                <Field
                                    label="New End Time"
                                    name="newEndTimeLocal"
                                    type="datetime-local"
                                    value={form.newEndTimeLocal}
                                    onChange={(e) => onChange({ newEndTimeLocal: e.target.value })}
                                    hint={form.newEndTimeLocal ? `${formatUnix(localInputToUnix(form.newEndTimeLocal))} · ${formatRelative(localInputToUnix(form.newEndTimeLocal))}` : "Must be later than current end"}
                                />
                                <Field
                                    label="Funds remaining in escrow"
                                    value={`${stroopsToXlm(survey.funded_remaining || 0n)} XLM`}
                                    readOnly
                                    hint="Auto-paid to respondents on each submission. Withdraw remainder once the survey is closed or expired."
                                />
                            </div>
                            <div className="row wrap">
                                <ManageBtn id="extend" label="Save End Time" variant="outline" onClick={onExtend} busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                                <ManageBtn id="withdraw" label="Withdraw Unused Funds" variant="ghost" onClick={onWithdrawFunds} busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                            </div>
                        </Section>

                        <Section title="Whitelist" tag="optional">
                            <Field
                                label="Addresses"
                                textarea
                                rows={3}
                                value={form.whitelistAddrs}
                                onChange={(e) => onChange({ whitelistAddrs: e.target.value })}
                                hint="Comma or newline separated. Each must be a valid G... Stellar address."
                            />
                            <div className="row wrap">
                                <ManageBtn id="enable_wl" label="Enable Whitelist" variant="outline" onClick={onEnableWhitelist} busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                                <ManageBtn id="add_wl" label="Add Addresses" onClick={onAddWhitelist} busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                            </div>
                        </Section>

                        <Section title="Questions" tag={`${survey.question_count} on-chain`}>
                            <ol className="questions-list">
                                {survey.questions.map((q, i) => (
                                    <li key={i}><span className="q-num">Q{i + 1}</span><span>{q}</span></li>
                                ))}
                            </ol>
                            <p className="hint">Questions are immutable once published.</p>
                        </Section>

                        <ResponsesSection
                            survey={survey}
                            responses={responses}
                            onReload={onReloadResponses}
                            onTip={(addr) => onTip(addr, survey.id)}
                            wallet={wallet}
                        />
                    </>
                ) : (
                    <div className="empty-state inset">
                        <span className="empty-icon">←</span>
                        <h3>Select a survey</h3>
                        <p>Pick one from the list to edit, share, or view responses.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
