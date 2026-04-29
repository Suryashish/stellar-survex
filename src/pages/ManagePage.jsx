import { useState } from "react";
import { stroopsToXlm, formatUnix, formatRelative, localInputToUnix, CONTRACT_ID } from "../../lib/stellar.js";
import { truncate } from "../utils/constants.js";
import Section from "../components/Section.jsx";
import Field from "../components/Field.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Stat from "../components/Stat.jsx";
import ManageBtn from "../components/ManageBtn.jsx";
import ResponsesSection from "../components/ResponsesSection.jsx";

function PointsAdminPanel({
    wallet,
    contractAdmin,
    pointsConfig,
    pointsMeta,
    pointsBalance,
    pointsTokenId,
    onClaimSurveyAdmin,
    onInitToken,
    onSetTokenMinter,
    onSavePointsConfig,
    busyAction,
    disabled,
}) {
    const [tokenForm, setTokenForm] = useState({ name: "Survex Points", symbol: "SXP", decimals: "0" });
    const [cfgForm, setCfgForm] = useState({
        token: pointsTokenId || "",
        creatorPoints: "10",
        respondentPoints: "1",
    });
    const isAdmin = !!(wallet && contractAdmin && wallet.publicKey === contractAdmin);
    const adminUnclaimed = !contractAdmin;
    const tokenInitialized = !!pointsMeta?.symbol;

    return (
        <Section title="Reward Points Setup" tag="admin">
            <div className="setup-grid">
                <div className="setup-step">
                    <div className="setup-step-head">
                        <span className="setup-step-num">1</span>
                        <strong>Survey contract admin</strong>
                    </div>
                    {contractAdmin ? (
                        <p className="hint">
                            Current admin: <span className="mono small">{truncate(contractAdmin, 8, 8)}</span>
                            {isAdmin && " (you)"}
                        </p>
                    ) : (
                        <p className="hint warn">No admin set. Claim it with your wallet to configure points.</p>
                    )}
                    {adminUnclaimed && wallet && (
                        <ManageBtn id="init_admin" label="Claim admin role" onClick={onClaimSurveyAdmin} busyAction={busyAction} disabled={disabled} />
                    )}
                </div>

                <div className="setup-step">
                    <div className="setup-step-head">
                        <span className="setup-step-num">2</span>
                        <strong>Initialize points token</strong>
                    </div>
                    {!pointsTokenId && (
                        <p className="hint warn">
                            POINTS_TOKEN_ID isn't set in lib/stellar.js. Deploy the points-token contract first, then paste its address there.
                        </p>
                    )}
                    {pointsTokenId && tokenInitialized && (
                        <p className="hint">
                            Initialized: <strong>{pointsMeta.name}</strong> ({pointsMeta.symbol}) · supply {String(pointsMeta.totalSupply || 0n)}
                        </p>
                    )}
                    {pointsTokenId && !tokenInitialized && isAdmin && (
                        <>
                            <div className="grid-2">
                                <Field label="Name" name="name" value={tokenForm.name} onChange={(e) => setTokenForm({ ...tokenForm, name: e.target.value })} />
                                <Field label="Symbol" name="symbol" value={tokenForm.symbol} onChange={(e) => setTokenForm({ ...tokenForm, symbol: e.target.value })} />
                                <Field label="Decimals" name="decimals" type="number" value={tokenForm.decimals} onChange={(e) => setTokenForm({ ...tokenForm, decimals: e.target.value })} />
                            </div>
                            <ManageBtn id="init_token" label="Initialize token" onClick={() => onInitToken(tokenForm)} busyAction={busyAction} disabled={disabled} />
                        </>
                    )}
                </div>

                <div className="setup-step">
                    <div className="setup-step-head">
                        <span className="setup-step-num">3</span>
                        <strong>Authorize survey contract as minter</strong>
                    </div>
                    <p className="hint">
                        Give this survey contract permission to mint points. Survey contract id: <span className="mono small">{truncate(CONTRACT_ID, 8, 8)}</span>
                    </p>
                    {pointsTokenId && tokenInitialized && isAdmin && (
                        <ManageBtn id="set_minter" label="Set survey contract as minter" onClick={() => onSetTokenMinter(CONTRACT_ID)} busyAction={busyAction} disabled={disabled} />
                    )}
                </div>

                <div className="setup-step">
                    <div className="setup-step-head">
                        <span className="setup-step-num">4</span>
                        <strong>Set point amounts</strong>
                    </div>
                    {pointsConfig?.token ? (
                        <p className="hint">
                            Currently: creator earns <strong>{String(pointsConfig.creator)}</strong>, respondent earns <strong>{String(pointsConfig.respondent)}</strong> per action.
                            <br />
                            Token: <span className="mono small">{truncate(pointsConfig.token, 8, 8)}</span>
                        </p>
                    ) : (
                        <p className="hint">No points config yet. Set the token address and amounts below.</p>
                    )}
                    {isAdmin && (
                        <>
                            <div className="grid-2">
                                <Field label="Token contract id" name="token" value={cfgForm.token} onChange={(e) => setCfgForm({ ...cfgForm, token: e.target.value })} placeholder="C…" />
                                <Field label="Per-creator points" name="creatorPoints" type="number" value={cfgForm.creatorPoints} onChange={(e) => setCfgForm({ ...cfgForm, creatorPoints: e.target.value })} />
                                <Field label="Per-respondent points" name="respondentPoints" type="number" value={cfgForm.respondentPoints} onChange={(e) => setCfgForm({ ...cfgForm, respondentPoints: e.target.value })} />
                            </div>
                            <ManageBtn id="set_points_cfg" label="Save points configuration" onClick={() => onSavePointsConfig(cfgForm)} busyAction={busyAction} disabled={disabled} />
                        </>
                    )}
                </div>

                {wallet && pointsTokenId && tokenInitialized && (
                    <div className="setup-step">
                        <div className="setup-step-head">
                            <span className="setup-step-num">★</span>
                            <strong>Your balance</strong>
                        </div>
                        <p className="hint">{String(pointsBalance || 0n)} {pointsMeta.symbol}</p>
                    </div>
                )}
            </div>
        </Section>
    );
}

export default function ManagePage({
    wallet,
    mySurveys,
    selectedId,
    survey,
    responses,
    form,
    onSelect,
    onChange,
    onPause,
    onResume,
    onClose,
    onExtend,
    onWithdrawFunds,
    onEnableWhitelist,
    onAddWhitelist,
    onShare,
    onTip,
    onReloadResponses,
    coAdmins,
    viewers,
    isPrivate,
    onAddCoAdmin,
    onRemoveCoAdmin,
    onSetVisibility,
    onAddViewers,
    onRemoveViewer,
    pointsConfig,
    pointsMeta,
    pointsBalance,
    contractAdmin,
    pointsTokenId,
    onClaimSurveyAdmin,
    onInitToken,
    onSetTokenMinter,
    onSavePointsConfig,
    busyAction,
    confirmKey,
    disabled,
}) {
    if (!wallet) {
        return (
            <Section title="Manage Surveys" tag="creator-only">
                <div className="empty-state inset">
                    <span className="empty-icon">⚠</span>
                    <h3>Connect a wallet</h3>
                    <p>Connect Freighter to see and edit surveys you've created or co-admin.</p>
                </div>
            </Section>
        );
    }

    // Setup is "fully initialized" when an admin has been claimed, the token
    // contract is initialized (metadata visible), and a points config has been
    // saved on the survey contract. After that point we hide the panel from
    // everyone except the contract admin themselves.
    const fullyInitialized = !!(contractAdmin && pointsMeta?.symbol && pointsConfig?.token);
    const isContractAdmin = !!(wallet && contractAdmin && wallet.publicKey === contractAdmin);
    const showSetupPanel = !fullyInitialized || isContractAdmin;
    const setupPanel = showSetupPanel ? (
        <PointsAdminPanel
            wallet={wallet}
            contractAdmin={contractAdmin}
            pointsConfig={pointsConfig}
            pointsMeta={pointsMeta}
            pointsBalance={pointsBalance}
            pointsTokenId={pointsTokenId}
            onClaimSurveyAdmin={onClaimSurveyAdmin}
            onInitToken={onInitToken}
            onSetTokenMinter={onSetTokenMinter}
            onSavePointsConfig={onSavePointsConfig}
            busyAction={busyAction}
            disabled={disabled}
        />
    ) : null;

    if (mySurveys.length === 0) {
        return (
            <>
                {setupPanel}
                <Section title="Manage Surveys" tag="creator-only">
                    <div className="empty-state inset">
                        <span className="empty-icon">∅</span>
                        <h3>No surveys to manage yet</h3>
                        <p>Head to <strong>01 / Create</strong> to publish a survey, or ask a creator to add you as a co-admin.</p>
                    </div>
                </Section>
            </>
        );
    }

    const isCreator = !!(wallet && survey && survey.creator === wallet.publicKey);
    const isCoAdmin = !!(wallet && survey && (coAdmins || []).includes(wallet.publicKey));
    const role = isCreator ? "Admin" : isCoAdmin ? "Co-admin" : "Viewer";
    const coAdminList = coAdmins || [];
    const viewerList = viewers || [];

    return (
        <>
        {setupPanel}
        <div className="manage-grid">
            <aside className="manage-list card">
                <div className="panel-head">
                    <h2>My Surveys</h2>
                    <span className="panel-tag">{mySurveys.length}</span>
                </div>
                <ul className="manage-list-ul">
                    {mySurveys.map((s) => {
                        const youAreCreator = s.creator === wallet.publicKey;
                        return (
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
                                        <span className={`role-tag ${youAreCreator ? "role-admin" : "role-coadmin"}`}>
                                            {youAreCreator ? "Admin" : "Co-admin"}
                                        </span>
                                        {s.response_count} responses · ends {formatRelative(s.end_time)}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </aside>

            <div className="manage-detail">
                {survey ? (
                    <>
                        <Section title={survey.title} tag={survey.id}>
                            <div className="manage-summary">
                                <StatusPill status={survey.status} />
                                <span className={`role-tag ${isCreator ? "role-admin" : "role-coadmin"}`}>{role}</span>
                                <span className={`role-tag ${isPrivate ? "role-private" : "role-public"}`}>
                                    {isPrivate ? "Private" : "Public"}
                                </span>
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
                                    hint={isCreator
                                        ? "Auto-paid to respondents on each submission. Withdraw remainder once the survey is closed or expired."
                                        : "Only the original admin can withdraw escrowed funds."}
                                />
                            </div>
                            <div className="row wrap">
                                <ManageBtn id="extend" label="Save End Time" variant="outline" onClick={onExtend} busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                                {isCreator && (
                                    <ManageBtn id="withdraw" label="Withdraw Unused Funds" variant="ghost" onClick={onWithdrawFunds} busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                                )}
                            </div>
                        </Section>

                        <Section title="Visibility & Access" tag={isPrivate ? "private" : "public"}>
                            <div className="visibility-toggle">
                                <button
                                    type="button"
                                    className={`visibility-option ${!isPrivate ? "is-active" : ""}`}
                                    onClick={() => !isPrivate ? null : onSetVisibility(false)}
                                    disabled={disabled || !isPrivate}
                                >
                                    <span className="visibility-option-title">Public</span>
                                    <span className="visibility-option-desc">Anyone can find and respond.</span>
                                </button>
                                <button
                                    type="button"
                                    className={`visibility-option ${isPrivate ? "is-active" : ""}`}
                                    onClick={() => isPrivate ? null : onSetVisibility(true)}
                                    disabled={disabled || isPrivate}
                                >
                                    <span className="visibility-option-title">Private</span>
                                    <span className="visibility-option-desc">Only listed wallets (plus admins) can view or respond.</span>
                                </button>
                            </div>

                            <div className="member-section">
                                <div className="member-section-head">
                                    <strong>Allowed wallets</strong>
                                    <span className="hint">{viewerList.length} on list</span>
                                </div>
                                {!isPrivate && (
                                    <p className="hint">This survey is public — the list below has no effect until you switch to Private.</p>
                                )}
                                {isPrivate && viewerList.length === 0 && (
                                    <p className="hint warn">No wallets allowed yet. Only the admin and co-admins can currently see this private survey.</p>
                                )}
                                {viewerList.length > 0 && (
                                    <ul className="member-list">
                                        {viewerList.map((addr) => (
                                            <li key={addr}>
                                                <span className="mono small">{truncate(addr, 8, 8)}</span>
                                                <button
                                                    type="button"
                                                    className="btn btn-xs btn-ghost"
                                                    onClick={() => onRemoveViewer(addr)}
                                                    disabled={disabled}
                                                    title="Remove from allowed wallets"
                                                >
                                                    Remove
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <Field
                                    label="Add wallets"
                                    name="viewerAddrs"
                                    textarea
                                    rows={2}
                                    value={form.viewerAddrs}
                                    onChange={(e) => onChange({ viewerAddrs: e.target.value })}
                                    hint="Comma or newline separated G… addresses."
                                />
                                <div className="row wrap">
                                    <ManageBtn id="add_viewers" label="Add to allowed list" onClick={onAddViewers} busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                                </div>
                            </div>
                        </Section>

                        {isCreator && (
                            <Section title="Co-admins" tag="admin-only">
                                <p className="hint">
                                    Co-admins can pause, resume, extend, close, manage the response whitelist, and edit the visibility list — but cannot withdraw escrowed funds or add/remove other co-admins.
                                </p>
                                {coAdminList.length === 0 && (
                                    <p className="hint">No co-admins yet — you're the sole admin.</p>
                                )}
                                {coAdminList.length > 0 && (
                                    <ul className="member-list">
                                        {coAdminList.map((addr) => (
                                            <li key={addr}>
                                                <span className="mono small">{truncate(addr, 8, 8)}</span>
                                                <button
                                                    type="button"
                                                    className="btn btn-xs btn-ghost"
                                                    onClick={() => onRemoveCoAdmin(addr)}
                                                    disabled={disabled}
                                                    title="Remove co-admin"
                                                >
                                                    Remove
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <Field
                                    label="Add a co-admin"
                                    name="newCoAdmin"
                                    value={form.newCoAdmin}
                                    onChange={(e) => onChange({ newCoAdmin: e.target.value })}
                                    placeholder="G…"
                                    hint="Stellar wallet address. Co-admins immediately gain manage access."
                                />
                                <div className="row wrap">
                                    <ManageBtn id="add_coadmin" label="Add Co-admin" onClick={onAddCoAdmin} busyAction={busyAction} confirmKey={confirmKey} disabled={disabled} />
                                </div>
                            </Section>
                        )}

                        <Section title="Response Whitelist" tag="optional">
                            <p className="hint">Independent from visibility — gates which wallets may submit a response when enabled.</p>
                            <Field
                                label="Addresses"
                                textarea
                                rows={3}
                                value={form.whitelistAddrs}
                                onChange={(e) => onChange({ whitelistAddrs: e.target.value })}
                                hint="Comma or newline separated. Each must be a valid G… Stellar address."
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
        </>
    );
}
