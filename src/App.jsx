import React, { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import {
    checkConnection,
    connectWallet,
    disconnectWallet,
    getActiveNetwork,
    createSurvey,
    pauseSurvey,
    resumeSurvey,
    closeSurvey,
    extendSurvey,
    enableWhitelist,
    addToWhitelist,
    submitResponse,
    getSurvey,
    listSurveys,
    getTotalCount,
    getResponseCount,
    hasResponded,
    isAcceptingResponses,
    CONTRACT_ID,
    NETWORK_NAME,
} from "../lib/stellar.js";

const nowTs = () => Math.floor(Date.now() / 1000);
const dayFromNow = () => nowTs() + 86400;

const truncate = (addr) => (!addr || addr.length < 12 ? addr || "" : `${addr.slice(0, 6)}…${addr.slice(-4)}`);

const formatTime = (ts) => {
    const n = Number(ts);
    if (!n) return "—";
    return new Date(n * 1000).toLocaleString();
};

const statusLabel = (status) => {
    if (status == null) return "—";
    if (typeof status === "string") return status;
    if (typeof status === "object" && "tag" in status) return status.tag;
    return String(status);
};

const stringify = (value) => {
    if (value == null) return "No data returned.";
    if (typeof value === "string") return value;
    return JSON.stringify(
        value,
        (_, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
    );
};

const TABS = [
    { key: "create", label: "01 / Create" },
    { key: "manage", label: "02 / Manage" },
    { key: "respond", label: "03 / Respond" },
    { key: "analytics", label: "04 / Analytics" },
];

export default function App() {
    const [wallet, setWallet] = useState(null);
    const [network, setNetwork] = useState("");
    const [activeTab, setActiveTab] = useState("create");
    const [busy, setBusy] = useState(false);
    const [activeAction, setActiveAction] = useState(null);
    const [toast, setToast] = useState(null);
    const [output, setOutput] = useState({ kind: "idle", value: "" });
    const [totalCount, setTotalCount] = useState(null);
    const [confirmKey, setConfirmKey] = useState(null);
    const confirmTimer = useRef(null);

    const [form, setForm] = useState({
        id: "survey1",
        title: "Developer Satisfaction Survey",
        description: "Rate your experience with Soroban",
        questionCount: "5",
        endTime: String(dayFromNow()),
        maxResponses: "0",
        manageId: "survey1",
        newEndTime: String(dayFromNow() + 86400),
        whitelistAddrs: "",
        respondId: "survey1",
        answers: "5,4,3,5,4",
        querySurveyId: "survey1",
        queryRespondent: "",
    });

    const setField = (event) => {
        const { name, value } = event.target;
        setForm((prev) => ({ ...prev, [name]: value }));
    };

    useEffect(() => {
        return () => confirmTimer.current && clearTimeout(confirmTimer.current);
    }, []);

    const showToast = useCallback((kind, message) => {
        setToast({ kind, message });
        setTimeout(() => setToast(null), 3500);
    }, []);

    const refreshTotal = useCallback(async () => {
        try {
            const value = await getTotalCount();
            setTotalCount(typeof value === "bigint" ? Number(value) : value ?? 0);
        } catch {
            setTotalCount(null);
        }
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const user = await checkConnection();
                if (user) {
                    setWallet(user);
                    const net = await getActiveNetwork();
                    setNetwork(net);
                }
            } catch {
                /* ignore */
            }
            refreshTotal();
        })();
    }, [refreshTotal]);

    const run = async (actionKey, fn, { successMessage, refresh } = {}) => {
        setBusy(true);
        setActiveAction(actionKey);
        setOutput({ kind: "loading", value: "Awaiting network…" });
        try {
            const result = await fn();
            setOutput({ kind: "success", value: stringify(result) });
            showToast("success", successMessage || "Action completed");
            if (refresh) await refreshTotal();
            return result;
        } catch (error) {
            const message = error?.message || String(error);
            setOutput({ kind: "error", value: message });
            showToast("error", message.length > 90 ? `${message.slice(0, 90)}…` : message);
        } finally {
            setBusy(false);
            setActiveAction(null);
        }
    };

    const onConnect = () =>
        run("connect", async () => {
            const user = await connectWallet();
            setWallet(user);
            const net = await getActiveNetwork();
            setNetwork(net);
            return { connected: true, address: user.publicKey, network: net };
        }, { successMessage: "Wallet connected" });

    const onDisconnect = async () => {
        await disconnectWallet();
        setWallet(null);
        setNetwork("");
        setOutput({ kind: "idle", value: "" });
        showToast("info", "Wallet disconnected");
    };

    const requireWallet = () => {
        if (!wallet) {
            showToast("error", "Connect Freighter first");
            return false;
        }
        return true;
    };

    const onCreate = () => {
        if (!requireWallet()) return;
        run("create", () => createSurvey({
            id: form.id.trim(),
            creator: wallet.publicKey,
            title: form.title.trim(),
            description: form.description.trim(),
            questionCount: form.questionCount.trim(),
            endTime: form.endTime.trim(),
            maxResponses: form.maxResponses.trim(),
        }), { successMessage: "Survey created", refresh: true });
    };

    const onPause = () => {
        if (!requireWallet()) return;
        run("pause", () => pauseSurvey({ id: form.manageId.trim(), creator: wallet.publicKey }),
            { successMessage: "Survey paused" });
    };

    const onResume = () => {
        if (!requireWallet()) return;
        run("resume", () => resumeSurvey({ id: form.manageId.trim(), creator: wallet.publicKey }),
            { successMessage: "Survey resumed" });
    };

    const handleConfirm = (key, action) => {
        if (confirmKey === key) {
            setConfirmKey(null);
            if (confirmTimer.current) clearTimeout(confirmTimer.current);
            action();
        } else {
            setConfirmKey(key);
            if (confirmTimer.current) clearTimeout(confirmTimer.current);
            confirmTimer.current = setTimeout(() => setConfirmKey(null), 3000);
        }
    };

    const onClose = () => {
        if (!requireWallet()) return;
        handleConfirm("close", () =>
            run("close", () => closeSurvey({ id: form.manageId.trim(), creator: wallet.publicKey }),
                { successMessage: "Survey closed" }));
    };

    const onExtend = () => {
        if (!requireWallet()) return;
        run("extend", () => extendSurvey({
            id: form.manageId.trim(),
            creator: wallet.publicKey,
            newEndTime: form.newEndTime.trim(),
        }), { successMessage: "Survey extended" });
    };

    const onEnableWhitelist = () => {
        if (!requireWallet()) return;
        run("enable_wl", () => enableWhitelist({ id: form.manageId.trim(), creator: wallet.publicKey }),
            { successMessage: "Whitelist enabled" });
    };

    const onAddWhitelist = () => {
        if (!requireWallet()) return;
        const addresses = form.whitelistAddrs
            .split(/[\s,]+/)
            .map((value) => value.trim())
            .filter(Boolean);
        if (!addresses.length) {
            showToast("error", "Enter at least one address");
            return;
        }
        run("add_wl", () => addToWhitelist({
            id: form.manageId.trim(),
            creator: wallet.publicKey,
            addresses,
        }), { successMessage: `Added ${addresses.length} address(es)` });
    };

    const onSubmitResponse = () => {
        if (!requireWallet()) return;
        run("respond", () => submitResponse({
            surveyId: form.respondId.trim(),
            respondent: wallet.publicKey,
            answers: form.answers.trim(),
        }), { successMessage: "Response submitted" });
    };

    const onGetSurvey = () =>
        run("getSurvey", async () => {
            const data = await getSurvey(form.querySurveyId.trim());
            if (!data) return "Survey not found.";
            return {
                id: typeof data.id === "string" ? data.id : String(data.id),
                creator: data.creator,
                title: data.title,
                description: data.description,
                question_count: Number(data.question_count),
                response_count: Number(data.response_count),
                max_responses: Number(data.max_responses),
                status: statusLabel(data.status),
                created_at: formatTime(data.created_at),
                end_time: formatTime(data.end_time),
            };
        });

    const onListSurveys = () => run("list", () => listSurveys());

    const onResponseCount = () =>
        run("respCount", async () => {
            const value = await getResponseCount(form.querySurveyId.trim());
            return { surveyId: form.querySurveyId.trim(), responseCount: Number(value) };
        });

    const onHasResponded = () =>
        run("hasResp", async () => {
            const target = form.queryRespondent.trim() || wallet?.publicKey;
            if (!target) throw new Error("Provide a respondent address or connect a wallet");
            const value = await hasResponded(form.querySurveyId.trim(), target);
            return { surveyId: form.querySurveyId.trim(), respondent: target, hasResponded: Boolean(value) };
        });

    const onIsAccepting = () =>
        run("accepting", async () => {
            const value = await isAcceptingResponses(form.querySurveyId.trim());
            return { surveyId: form.querySurveyId.trim(), accepting: Boolean(value) };
        });

    const onTotalCount = () =>
        run("total", async () => {
            const value = await getTotalCount();
            const num = typeof value === "bigint" ? Number(value) : Number(value || 0);
            setTotalCount(num);
            return { totalSurveys: num };
        });

    const ActionBtn = ({ id, label, variant, onClick, confirmLabel }) => (
        <button
            type="button"
            className={`btn btn-${variant || "primary"} ${activeAction === id ? "is-loading" : ""}`}
            onClick={onClick}
            disabled={busy}
        >
            {confirmKey === id ? confirmLabel || "Confirm?" : label}
        </button>
    );

    return (
        <div className="page">
            <div className="grain" aria-hidden="true" />

            {/* Top bar */}
            <header className="topbar">
                <div className="brand">
                    <div className="brand-mark">SB</div>
                    <div className="brand-text">
                        <strong>Survey Builder</strong>
                        <span>On-chain · Soroban</span>
                    </div>
                </div>

                <div className="topbar-meta">
                    <span className={`pill ${wallet ? "pill-on" : "pill-off"}`}>
                        <span className="pill-dot" />
                        {wallet ? truncate(wallet.publicKey) : "Disconnected"}
                    </span>
                    {wallet ? (
                        <>
                            <span className="pill pill-net">{network || NETWORK_NAME}</span>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={onDisconnect} disabled={busy}>
                                Disconnect
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className={`btn btn-primary btn-sm ${activeAction === "connect" ? "is-loading" : ""}`}
                            onClick={onConnect}
                            disabled={busy}
                        >
                            Connect Freighter
                        </button>
                    )}
                </div>
            </header>

            <main className="main">
                {/* Hero */}
                <section className="hero card">
                    <div className="hero-left">
                        <span className="eyebrow">Stellar · Testnet</span>
                        <h1>Build surveys.<br />Collect proof on-chain.</h1>
                        <p>
                            Create, gate, and analyze surveys backed by a Soroban contract.
                            Lifecycle controls, optional whitelists, deduped responses — all
                            on a public ledger.
                        </p>
                        <div className="hero-actions">
                            <ActionBtn id="total" label="Refresh Total" variant="outline" onClick={onTotalCount} />
                            <a className="btn btn-ghost" href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`} target="_blank" rel="noreferrer">
                                View Contract ↗
                            </a>
                        </div>
                    </div>
                    <div className="hero-right">
                        <div className="stat-card stat-1">
                            <span className="stat-label">Total Surveys</span>
                            <span className="stat-value">{totalCount == null ? "—" : totalCount}</span>
                        </div>
                        <div className="stat-card stat-2">
                            <span className="stat-label">Network</span>
                            <span className="stat-value mono small">{network || NETWORK_NAME}</span>
                        </div>
                        <div className="stat-card stat-3">
                            <span className="stat-label">Contract</span>
                            <span className="stat-value mono tiny">{truncate(CONTRACT_ID)}</span>
                        </div>
                    </div>
                </section>

                {/* Tabs */}
                <nav className="tabs">
                    {TABS.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            className={`tab ${activeTab === tab.key ? "tab-active" : ""}`}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                {/* Tab content */}
                {activeTab === "create" && (
                    <section className="card panel">
                        <div className="panel-head">
                            <h2>Create a Survey</h2>
                            <span className="panel-tag">create_survey</span>
                        </div>
                        <div className="grid-2">
                            <Field label="Survey ID (Symbol)" name="id" value={form.id} onChange={setField} hint="Unique on-chain identifier (max 32 chars)" />
                            <Field label="Title" name="title" value={form.title} onChange={setField} />
                            <Field label="Question Count" name="questionCount" type="number" value={form.questionCount} onChange={setField} />
                            <Field label="Max Responses" name="maxResponses" type="number" value={form.maxResponses} onChange={setField} hint="0 = unlimited" />
                            <Field label="End Time (UNIX)" name="endTime" type="number" value={form.endTime} onChange={setField} hint={`Now: ${nowTs()}`} />
                            <Field label="Creator" value={wallet ? wallet.publicKey : "Connect wallet to auto-fill"} readOnly />
                        </div>
                        <Field label="Description" name="description" textarea rows={3} value={form.description} onChange={setField} />
                        <div className="row">
                            <ActionBtn id="create" label="Create Survey" onClick={onCreate} />
                        </div>
                    </section>
                )}

                {activeTab === "manage" && (
                    <section className="card panel">
                        <div className="panel-head">
                            <h2>Manage a Survey</h2>
                            <span className="panel-tag">creator-only</span>
                        </div>
                        <div className="grid-2">
                            <Field label="Survey ID" name="manageId" value={form.manageId} onChange={setField} />
                            <Field label="New End Time (UNIX)" name="newEndTime" type="number" value={form.newEndTime} onChange={setField} />
                        </div>
                        <div className="row wrap">
                            <ActionBtn id="pause" label="Pause" variant="outline" onClick={onPause} />
                            <ActionBtn id="resume" label="Resume" variant="outline" onClick={onResume} />
                            <ActionBtn id="extend" label="Extend End Time" variant="outline" onClick={onExtend} />
                            <ActionBtn id="close" label="Close Survey" variant="danger" onClick={onClose} confirmLabel="Confirm Close?" />
                        </div>

                        <div className="divider" />

                        <h3 className="subhead">Whitelist</h3>
                        <Field
                            label="Addresses (comma or newline separated)"
                            name="whitelistAddrs"
                            textarea
                            rows={3}
                            value={form.whitelistAddrs}
                            onChange={setField}
                            hint="Each address must be a valid G... Stellar account"
                        />
                        <div className="row wrap">
                            <ActionBtn id="enable_wl" label="Enable Whitelist" variant="outline" onClick={onEnableWhitelist} />
                            <ActionBtn id="add_wl" label="Add to Whitelist" onClick={onAddWhitelist} />
                        </div>
                    </section>
                )}

                {activeTab === "respond" && (
                    <section className="card panel">
                        <div className="panel-head">
                            <h2>Submit Response</h2>
                            <span className="panel-tag">submit_response</span>
                        </div>
                        <div className="grid-2">
                            <Field label="Survey ID" name="respondId" value={form.respondId} onChange={setField} />
                            <Field label="Respondent" value={wallet ? wallet.publicKey : "Connect wallet"} readOnly />
                        </div>
                        <Field
                            label="Answers (free-form string)"
                            name="answers"
                            textarea
                            rows={3}
                            value={form.answers}
                            onChange={setField}
                            hint="Encode answers as JSON, CSV, base64 — your call. Stored off-chain; participation tracked on-chain."
                        />
                        <div className="row">
                            <ActionBtn id="respond" label="Submit Response" onClick={onSubmitResponse} />
                        </div>
                    </section>
                )}

                {activeTab === "analytics" && (
                    <section className="card panel">
                        <div className="panel-head">
                            <h2>Read-only Queries</h2>
                            <span className="panel-tag">simulated</span>
                        </div>
                        <div className="grid-2">
                            <Field label="Survey ID" name="querySurveyId" value={form.querySurveyId} onChange={setField} />
                            <Field label="Respondent (optional)" name="queryRespondent" value={form.queryRespondent} onChange={setField} placeholder="Defaults to your wallet" />
                        </div>
                        <div className="row wrap">
                            <ActionBtn id="getSurvey" label="Get Survey" variant="outline" onClick={onGetSurvey} />
                            <ActionBtn id="list" label="List Surveys" variant="outline" onClick={onListSurveys} />
                            <ActionBtn id="respCount" label="Response Count" variant="outline" onClick={onResponseCount} />
                            <ActionBtn id="hasResp" label="Has Responded?" variant="outline" onClick={onHasResponded} />
                            <ActionBtn id="accepting" label="Accepting Responses?" variant="outline" onClick={onIsAccepting} />
                            <ActionBtn id="total" label="Total Count" variant="ghost" onClick={onTotalCount} />
                        </div>
                    </section>
                )}

                {/* Output */}
                <section className={`card output output-${output.kind}`}>
                    <div className="panel-head">
                        <h2>Output</h2>
                        <span className="panel-tag">{output.kind}</span>
                    </div>
                    {output.kind === "loading" ? (
                        <div className="loader">
                            <span className="loader-dot" />
                            <span className="loader-dot" />
                            <span className="loader-dot" />
                            <span>Awaiting network response…</span>
                        </div>
                    ) : (
                        <pre className="output-pre">
                            {output.value || "Run an action above. Results, errors, and contract data will appear here."}
                        </pre>
                    )}
                </section>

                <footer className="foot">
                    <span>Built on Soroban</span>
                    <span className="mono tiny">{CONTRACT_ID}</span>
                </footer>
            </main>

            {toast && (
                <div className={`toast toast-${toast.kind}`}>
                    <span className="toast-bar" />
                    <span>{toast.message}</span>
                </div>
            )}
        </div>
    );
}

function Field({ label, name, value, onChange, type = "text", hint, textarea, rows = 2, readOnly, placeholder }) {
    return (
        <div className={`field ${readOnly ? "field-ro" : ""}`}>
            <label>{label}</label>
            {textarea ? (
                <textarea name={name} value={value} onChange={onChange} rows={rows} readOnly={readOnly} placeholder={placeholder} />
            ) : (
                <input name={name} value={value} onChange={onChange} type={type} readOnly={readOnly} placeholder={placeholder} />
            )}
            {hint && <span className="hint">{hint}</span>}
        </div>
    );
}
