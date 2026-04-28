import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
    updateReward,
    enableWhitelist,
    addToWhitelist,
    submitResponse,
    getSurvey,
    listSurveys,
    getTotalCount,
    getResponseCount,
    hasResponded,
    isAcceptingResponses,
    getParticipants,
    sendPayment,
    xlmToStroops,
    stroopsToXlm,
    CONTRACT_ID,
    NETWORK_NAME,
} from "../lib/stellar.js";

const nowTs = () => Math.floor(Date.now() / 1000);
const dayFromNow = () => nowTs() + 86400;

const truncate = (addr, head = 6, tail = 4) =>
    !addr || addr.length < head + tail + 3 ? addr || "" : `${addr.slice(0, head)}…${addr.slice(-tail)}`;

const formatTime = (ts) => {
    const n = Number(ts);
    if (!n) return "—";
    return new Date(n * 1000).toLocaleString();
};

const statusLabel = (status) => {
    if (status == null) return "Unknown";
    if (typeof status === "string") return status;
    if (typeof status === "object" && "tag" in status) return status.tag;
    return String(status);
};

const normalizeSurvey = (raw) => {
    if (!raw) return null;
    return {
        id: typeof raw.id === "string" ? raw.id : String(raw.id),
        creator: raw.creator,
        title: raw.title,
        description: raw.description,
        question_count: Number(raw.question_count),
        response_count: Number(raw.response_count),
        max_responses: Number(raw.max_responses),
        status: statusLabel(raw.status),
        created_at: Number(raw.created_at),
        end_time: Number(raw.end_time),
        reward_per_response: typeof raw.reward_per_response === "bigint"
            ? raw.reward_per_response
            : BigInt(raw.reward_per_response || 0),
    };
};

const NAV = [
    { key: "explore", num: "00", label: "Explore" },
    { key: "create", num: "01", label: "Create" },
    { key: "manage", num: "02", label: "Manage" },
    { key: "respond", num: "03", label: "Respond" },
    { key: "analytics", num: "04", label: "Analytics" },
];

const newTxId = () => `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export default function App() {
    const [wallet, setWallet] = useState(null);
    const [network, setNetwork] = useState("");
    const [activeNav, setActiveNav] = useState("explore");
    const [busyAction, setBusyAction] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [result, setResult] = useState({ kind: "idle", title: "", body: null });
    const [totalCount, setTotalCount] = useState(null);
    const [confirmKey, setConfirmKey] = useState(null);
    const confirmTimer = useRef(null);

    // Explore data
    const [surveyIds, setSurveyIds] = useState([]);
    const [surveysById, setSurveysById] = useState({});
    const [participantsById, setParticipantsById] = useState({});
    const [exploreLoading, setExploreLoading] = useState(false);
    const [selectedSurvey, setSelectedSurvey] = useState(null);

    // Payment modal
    const [paymentModal, setPaymentModal] = useState(null); // { recipient, surveyId? }

    // Forms
    const [form, setForm] = useState({
        id: "survey1",
        title: "Developer Satisfaction Survey",
        description: "Rate your experience with Soroban",
        questionCount: "5",
        endTime: String(dayFromNow()),
        maxResponses: "0",
        rewardXlm: "0",
        manageId: "survey1",
        newEndTime: String(dayFromNow() + 86400),
        whitelistAddrs: "",
        manageRewardXlm: "0",
        respondId: "survey1",
        answers: "5,4,3,5,4",
        querySurveyId: "survey1",
        queryRespondent: "",
    });

    const setField = (event) => {
        const { name, value } = event.target;
        setForm((prev) => ({ ...prev, [name]: value }));
    };
    const patchForm = (patch) => setForm((prev) => ({ ...prev, ...patch }));

    useEffect(() => {
        return () => confirmTimer.current && clearTimeout(confirmTimer.current);
    }, []);

    // ---- Transaction feed ----
    const addTx = useCallback((label) => {
        const id = newTxId();
        setTransactions((prev) => [
            { id, label, status: "pending", startedAt: Date.now() },
            ...prev.slice(0, 7),
        ]);
        return id;
    }, []);

    const updateTx = useCallback((id, patch) => {
        setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
        if (patch.status === "success") {
            setTimeout(() => {
                setTransactions((prev) => prev.filter((t) => t.id !== id));
            }, 9000);
        }
    }, []);

    const dismissTx = (id) => setTransactions((prev) => prev.filter((t) => t.id !== id));

    // ---- Refresh helpers ----
    const refreshTotal = useCallback(async () => {
        try {
            const value = await getTotalCount();
            setTotalCount(typeof value === "bigint" ? Number(value) : value ?? 0);
        } catch {
            setTotalCount(null);
        }
    }, []);

    const refreshExplore = useCallback(async () => {
        setExploreLoading(true);
        try {
            const ids = await listSurveys();
            const idStrings = (ids || []).map((s) => (typeof s === "string" ? s : String(s)));
            setSurveyIds(idStrings);

            const fetched = {};
            await Promise.all(idStrings.map(async (id) => {
                try {
                    const data = await getSurvey(id);
                    fetched[id] = normalizeSurvey(data);
                } catch {
                    fetched[id] = null;
                }
            }));
            setSurveysById(fetched);
        } catch (error) {
            setResult({ kind: "error", title: "Failed to load surveys", body: error.message });
        } finally {
            setExploreLoading(false);
        }
    }, []);

    const refreshParticipants = useCallback(async (id) => {
        try {
            const list = await getParticipants(id);
            setParticipantsById((prev) => ({ ...prev, [id]: list || [] }));
            return list;
        } catch {
            setParticipantsById((prev) => ({ ...prev, [id]: [] }));
            return [];
        }
    }, []);

    // ---- Initial mount ----
    useEffect(() => {
        (async () => {
            try {
                const user = await checkConnection();
                if (user) {
                    setWallet(user);
                    const net = await getActiveNetwork();
                    setNetwork(net);
                }
            } catch { /* noop */ }
            refreshTotal();
            refreshExplore();
        })();

        // URL deep link: ?survey=<id> opens Respond pre-filled
        const params = new URLSearchParams(window.location.search);
        const sharedId = params.get("survey");
        if (sharedId) {
            patchForm({ respondId: sharedId, querySurveyId: sharedId, manageId: sharedId });
            setActiveNav("respond");
        }
    }, [refreshTotal, refreshExplore]);

    // ---- Action runner ----
    const run = async (actionKey, label, fn, { onSuccess, refresh } = {}) => {
        setBusyAction(actionKey);
        const txId = addTx(label);
        try {
            const value = await fn();
            updateTx(txId, { status: "success", hash: value?.hash });
            if (onSuccess) await onSuccess(value);
            if (refresh?.total) await refreshTotal();
            if (refresh?.explore) await refreshExplore();
            if (refresh?.participantsOf) await refreshParticipants(refresh.participantsOf);
            return value;
        } catch (error) {
            const message = error?.message || String(error);
            updateTx(txId, { status: "error", error: message });
            setResult({ kind: "error", title: `Error · ${label}`, body: message });
        } finally {
            setBusyAction(null);
        }
    };

    const requireWallet = () => {
        if (!wallet) {
            const txId = addTx("Connect Freighter first");
            updateTx(txId, { status: "error", error: "No wallet connected" });
            return false;
        }
        return true;
    };

    // ---- Wallet ----
    const onConnect = () =>
        run("connect", "Connecting wallet", async () => {
            const user = await connectWallet();
            setWallet(user);
            const net = await getActiveNetwork();
            setNetwork(net);
            return { hash: null, address: user.publicKey };
        });

    const onDisconnect = async () => {
        await disconnectWallet();
        setWallet(null);
        setNetwork("");
        setResult({ kind: "info", title: "Wallet disconnected", body: "Connect again to perform transactions." });
    };

    // ---- Survey actions ----
    const onCreate = () => {
        if (!requireWallet()) return;
        run("create", "Creating survey", () => createSurvey({
            id: form.id.trim(),
            creator: wallet.publicKey,
            title: form.title.trim(),
            description: form.description.trim(),
            questionCount: form.questionCount.trim(),
            endTime: form.endTime.trim(),
            maxResponses: form.maxResponses.trim(),
            rewardStroops: xlmToStroops(form.rewardXlm.trim()),
        }), {
            onSuccess: () => {
                setResult({
                    kind: "success",
                    title: `Survey "${form.id}" created`,
                    body: { kind: "create", id: form.id, title: form.title, reward: form.rewardXlm },
                });
            },
            refresh: { total: true, explore: true },
        });
    };

    const onPause = () => {
        if (!requireWallet()) return;
        run("pause", `Pause ${form.manageId}`, () =>
            pauseSurvey({ id: form.manageId.trim(), creator: wallet.publicKey }),
            { refresh: { explore: true } });
    };
    const onResume = () => {
        if (!requireWallet()) return;
        run("resume", `Resume ${form.manageId}`, () =>
            resumeSurvey({ id: form.manageId.trim(), creator: wallet.publicKey }),
            { refresh: { explore: true } });
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
            run("close", `Close ${form.manageId}`, () =>
                closeSurvey({ id: form.manageId.trim(), creator: wallet.publicKey }),
                { refresh: { explore: true } }));
    };

    const onExtend = () => {
        if (!requireWallet()) return;
        run("extend", `Extend ${form.manageId}`, () => extendSurvey({
            id: form.manageId.trim(),
            creator: wallet.publicKey,
            newEndTime: form.newEndTime.trim(),
        }), { refresh: { explore: true } });
    };

    const onUpdateReward = () => {
        if (!requireWallet()) return;
        run("update_reward", `Update reward ${form.manageId}`, () => updateReward({
            id: form.manageId.trim(),
            creator: wallet.publicKey,
            rewardStroops: xlmToStroops(form.manageRewardXlm.trim()),
        }), { refresh: { explore: true } });
    };

    const onEnableWhitelist = () => {
        if (!requireWallet()) return;
        run("enable_wl", `Enable whitelist ${form.manageId}`, () =>
            enableWhitelist({ id: form.manageId.trim(), creator: wallet.publicKey }));
    };

    const onAddWhitelist = () => {
        if (!requireWallet()) return;
        const addresses = form.whitelistAddrs.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
        if (!addresses.length) {
            setResult({ kind: "error", title: "Whitelist", body: "Enter at least one address" });
            return;
        }
        run("add_wl", `Whitelist +${addresses.length}`, () => addToWhitelist({
            id: form.manageId.trim(),
            creator: wallet.publicKey,
            addresses,
        }));
    };

    const onSubmitResponse = () => {
        if (!requireWallet()) return;
        run("respond", `Respond to ${form.respondId}`, () => submitResponse({
            surveyId: form.respondId.trim(),
            respondent: wallet.publicKey,
            answers: form.answers.trim(),
        }), {
            onSuccess: () => {
                setResult({
                    kind: "success",
                    title: "Response submitted",
                    body: { kind: "respond", surveyId: form.respondId, answers: form.answers },
                });
            },
            refresh: { explore: true, participantsOf: form.respondId.trim() },
        });
    };

    // ---- Read queries ----
    const onGetSurvey = () =>
        run("getSurvey", `Read survey ${form.querySurveyId}`, async () => {
            const data = await getSurvey(form.querySurveyId.trim());
            const normalized = normalizeSurvey(data);
            if (!normalized) {
                setResult({ kind: "error", title: "Survey not found", body: form.querySurveyId });
                return null;
            }
            setSurveysById((prev) => ({ ...prev, [normalized.id]: normalized }));
            setResult({ kind: "success", title: `Survey · ${normalized.id}`, body: { kind: "survey", survey: normalized } });
            return { hash: null };
        });

    const onListSurveys = () =>
        run("list", "Read survey list", async () => {
            await refreshExplore();
            return { hash: null };
        }, {
            onSuccess: () => setResult({
                kind: "success",
                title: "Survey list refreshed",
                body: { kind: "ids", ids: surveyIds },
            }),
        });

    const onResponseCount = () =>
        run("respCount", `Read response count ${form.querySurveyId}`, async () => {
            const value = await getResponseCount(form.querySurveyId.trim());
            setResult({
                kind: "success",
                title: `Response count · ${form.querySurveyId}`,
                body: { kind: "stat", stat: "Responses", value: Number(value) },
            });
            return { hash: null };
        });

    const onHasResponded = () =>
        run("hasResp", "Check has responded", async () => {
            const target = form.queryRespondent.trim() || wallet?.publicKey;
            if (!target) throw new Error("Provide a respondent address or connect a wallet");
            const value = await hasResponded(form.querySurveyId.trim(), target);
            setResult({
                kind: "success",
                title: "Response check",
                body: { kind: "boolean", label: `Has ${truncate(target)} responded?`, value: Boolean(value) },
            });
            return { hash: null };
        });

    const onIsAccepting = () =>
        run("accepting", "Check accepting", async () => {
            const value = await isAcceptingResponses(form.querySurveyId.trim());
            setResult({
                kind: "success",
                title: "Accepting responses",
                body: { kind: "boolean", label: `${form.querySurveyId} is accepting?`, value: Boolean(value) },
            });
            return { hash: null };
        });

    const onTotalCount = () =>
        run("total", "Read total count", async () => {
            const value = await getTotalCount();
            const num = typeof value === "bigint" ? Number(value) : Number(value || 0);
            setTotalCount(num);
            setResult({
                kind: "success",
                title: "Total surveys on-chain",
                body: { kind: "stat", stat: "Total Surveys", value: num },
            });
            return { hash: null };
        });

    const onLoadParticipants = (id) =>
        run("participants", `Load participants ${id}`, async () => {
            const list = await refreshParticipants(id);
            setResult({
                kind: "success",
                title: `Participants · ${id}`,
                body: { kind: "participants", surveyId: id, list: list || [] },
            });
            return { hash: null };
        });

    // ---- Survey row actions ----
    const openSurveyDetail = async (id) => {
        setSelectedSurvey(id);
        if (!participantsById[id]) {
            await refreshParticipants(id);
        }
    };

    const startRespond = (id) => {
        patchForm({ respondId: id });
        setActiveNav("respond");
    };

    const startManage = (id) => {
        const s = surveysById[id];
        patchForm({
            manageId: id,
            manageRewardXlm: s ? stroopsToXlm(s.reward_per_response) : "0",
        });
        setActiveNav("manage");
    };

    const shareSurvey = async (id) => {
        const url = `${window.location.origin}${window.location.pathname}?survey=${encodeURIComponent(id)}`;
        try {
            await navigator.clipboard.writeText(url);
            setResult({
                kind: "info",
                title: "Share link copied",
                body: { kind: "share", url, surveyId: id },
            });
        } catch {
            setResult({ kind: "info", title: "Share link", body: url });
        }
    };

    // ---- Payments ----
    const openPayment = (recipient, context) => {
        if (!wallet) {
            setResult({ kind: "error", title: "Connect wallet", body: "Connect Freighter to send a payment." });
            return;
        }
        setPaymentModal({ recipient, ...context, amount: "1", memo: context?.surveyId || "Survey reward" });
    };

    const submitPayment = async () => {
        if (!paymentModal) return;
        const { recipient, amount, memo, surveyId } = paymentModal;
        await run("payment", `Tip ${truncate(recipient)} · ${amount} XLM`, () => sendPayment({
            from: wallet.publicKey,
            to: recipient,
            amount,
            memo,
        }), {
            onSuccess: (value) => {
                setResult({
                    kind: "success",
                    title: "Payment sent",
                    body: { kind: "payment", to: recipient, amount, surveyId, hash: value?.hash },
                });
                setPaymentModal(null);
            },
        });
    };

    // ---- Derived ----
    const sortedSurveyIds = useMemo(() => {
        return [...surveyIds].sort((a, b) => {
            const sa = surveysById[a]; const sb = surveysById[b];
            return (sb?.created_at || 0) - (sa?.created_at || 0);
        });
    }, [surveyIds, surveysById]);

    const isBusy = busyAction != null;

    const Btn = ({ id, label, variant = "primary", onClick, confirmLabel, icon, full }) => (
        <button
            type="button"
            className={`btn btn-${variant} ${full ? "btn-full" : ""} ${busyAction === id ? "is-loading" : ""}`}
            onClick={onClick}
            disabled={isBusy}
        >
            {icon && <span className="btn-icon">{icon}</span>}
            <span>{confirmKey === id ? confirmLabel || "Confirm?" : label}</span>
        </button>
    );

    const StatusPill = ({ status }) => {
        const cls = status === "Active" ? "pill-active" :
                    status === "Paused" ? "pill-paused" :
                    status === "Closed" ? "pill-closed" : "pill-default";
        return <span className={`status-pill ${cls}`}>{status}</span>;
    };

    return (
        <div className="layout">
            <div className="grain" aria-hidden="true" />

            {/* ===== Sidebar ===== */}
            <aside className="sidebar">
                <div className="brand">
                    <div className="brand-mark">SB</div>
                    <div className="brand-text">
                        <strong>Survey Builder</strong>
                        <span>Soroban · Testnet</span>
                    </div>
                </div>

                <nav className="nav">
                    {NAV.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            className={`nav-item ${activeNav === item.key ? "nav-active" : ""}`}
                            onClick={() => setActiveNav(item.key)}
                        >
                            <span className="nav-num">{item.num}</span>
                            <span className="nav-label">{item.label}</span>
                            {activeNav === item.key && <span className="nav-bar" />}
                        </button>
                    ))}
                </nav>

                <div className="side-stats">
                    <div className="side-stat">
                        <span className="side-stat-label">Total</span>
                        <span className="side-stat-value">{totalCount ?? "—"}</span>
                    </div>
                    <div className="side-stat">
                        <span className="side-stat-label">Network</span>
                        <span className="side-stat-value mono small">{network || NETWORK_NAME}</span>
                    </div>
                </div>

                <div className="side-wallet">
                    {wallet ? (
                        <>
                            <div className="wallet-card">
                                <span className="wallet-label">CONNECTED</span>
                                <span className="wallet-addr mono">{truncate(wallet.publicKey, 8, 6)}</span>
                            </div>
                            <button type="button" className="btn btn-ghost btn-full btn-sm" onClick={onDisconnect} disabled={isBusy}>
                                Disconnect
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className={`btn btn-primary btn-full ${busyAction === "connect" ? "is-loading" : ""}`}
                            onClick={onConnect}
                            disabled={isBusy}
                        >
                            Connect Freighter
                        </button>
                    )}
                </div>
            </aside>

            {/* ===== Main ===== */}
            <div className="main-col">
                <header className="topbar">
                    <div className="topbar-left">
                        <h1 className="page-title">{NAV.find((n) => n.key === activeNav)?.label}</h1>
                        <span className="page-sub">
                            {activeNav === "explore" && "Browse all surveys, share, and discover"}
                            {activeNav === "create" && "Publish a new survey on-chain"}
                            {activeNav === "manage" && "Lifecycle controls and whitelisting"}
                            {activeNav === "respond" && "Submit a response — your address is your signature"}
                            {activeNav === "analytics" && "Read-only contract queries"}
                        </span>
                    </div>
                    <div className="topbar-right">
                        <span className={`pill ${wallet ? "pill-on" : "pill-off"}`}>
                            <span className="pill-dot" />
                            {wallet ? truncate(wallet.publicKey) : "Disconnected"}
                        </span>
                    </div>
                </header>

                <main className="content">
                    {activeNav === "explore" && (
                        <ExplorePanel
                            ids={sortedSurveyIds}
                            surveys={surveysById}
                            participants={participantsById}
                            loading={exploreLoading}
                            onRefresh={refreshExplore}
                            onView={openSurveyDetail}
                            onRespond={startRespond}
                            onManage={startManage}
                            onShare={shareSurvey}
                            onLoadParticipants={onLoadParticipants}
                            onTip={(addr, surveyId) => openPayment(addr, { surveyId })}
                            wallet={wallet}
                            selected={selectedSurvey}
                        />
                    )}

                    {activeNav === "create" && (
                        <Section title="Create a Survey" tag="create_survey">
                            <div className="grid-2">
                                <Field label="Survey ID (Symbol)" name="id" value={form.id} onChange={setField} hint="Unique on-chain identifier (max 32 chars, letters/numbers/_)" />
                                <Field label="Title" name="title" value={form.title} onChange={setField} />
                                <Field label="Question Count" name="questionCount" type="number" value={form.questionCount} onChange={setField} />
                                <Field label="Max Responses" name="maxResponses" type="number" value={form.maxResponses} onChange={setField} hint="0 = unlimited" />
                                <Field label="End Time (UNIX)" name="endTime" type="number" value={form.endTime} onChange={setField} hint={`Now: ${nowTs()} · 1 day from now: ${dayFromNow()}`} />
                                <Field label="Reward per Response (XLM)" name="rewardXlm" value={form.rewardXlm} onChange={setField} hint="Informational. Tipping is settled via direct payment from creator." />
                            </div>
                            <Field label="Description" name="description" textarea rows={3} value={form.description} onChange={setField} />
                            <Field label="Creator" value={wallet ? wallet.publicKey : "Connect wallet to auto-fill"} readOnly />
                            <div className="row">
                                <Btn id="create" label="Publish Survey" onClick={onCreate} icon="↗" />
                            </div>
                        </Section>
                    )}

                    {activeNav === "manage" && (
                        <>
                            <Section title="Manage Survey" tag="creator-only">
                                <div className="grid-2">
                                    <Field label="Survey ID" name="manageId" value={form.manageId} onChange={setField} />
                                    <Field label="New End Time (UNIX)" name="newEndTime" type="number" value={form.newEndTime} onChange={setField} />
                                </div>
                                <div className="row wrap">
                                    <Btn id="pause" label="Pause" variant="outline" onClick={onPause} />
                                    <Btn id="resume" label="Resume" variant="outline" onClick={onResume} />
                                    <Btn id="extend" label="Extend End Time" variant="outline" onClick={onExtend} />
                                    <Btn id="close" label="Close Survey" variant="danger" onClick={onClose} confirmLabel="Confirm Close?" />
                                </div>
                            </Section>

                            <Section title="Update Reward" tag="update_reward">
                                <div className="grid-2">
                                    <Field label="New Reward per Response (XLM)" name="manageRewardXlm" value={form.manageRewardXlm} onChange={setField} hint="Set to 0 to clear" />
                                </div>
                                <div className="row">
                                    <Btn id="update_reward" label="Update Reward" variant="outline" onClick={onUpdateReward} />
                                </div>
                            </Section>

                            <Section title="Whitelist" tag="enable + add">
                                <Field
                                    label="Addresses"
                                    name="whitelistAddrs"
                                    textarea
                                    rows={3}
                                    value={form.whitelistAddrs}
                                    onChange={setField}
                                    hint="Comma or newline separated. Each must be a valid G... Stellar account."
                                />
                                <div className="row wrap">
                                    <Btn id="enable_wl" label="Enable Whitelist" variant="outline" onClick={onEnableWhitelist} />
                                    <Btn id="add_wl" label="Add Addresses" onClick={onAddWhitelist} />
                                </div>
                            </Section>
                        </>
                    )}

                    {activeNav === "respond" && (
                        <Section title="Submit Response" tag="submit_response">
                            <div className="grid-2">
                                <Field label="Survey ID" name="respondId" value={form.respondId} onChange={setField} />
                                <Field label="Respondent" value={wallet ? wallet.publicKey : "Connect wallet"} readOnly />
                            </div>
                            <Field
                                label="Answers"
                                name="answers"
                                textarea
                                rows={3}
                                value={form.answers}
                                onChange={setField}
                                hint="Free-form string — JSON, CSV, base64, your call. Stored off-chain; participation tracked on-chain."
                            />
                            <div className="row">
                                <Btn id="respond" label="Submit Response" onClick={onSubmitResponse} icon="✓" />
                            </div>
                        </Section>
                    )}

                    {activeNav === "analytics" && (
                        <Section title="Read-only Queries" tag="simulated">
                            <div className="grid-2">
                                <Field label="Survey ID" name="querySurveyId" value={form.querySurveyId} onChange={setField} />
                                <Field label="Respondent (optional)" name="queryRespondent" value={form.queryRespondent} onChange={setField} placeholder="Defaults to your wallet" />
                            </div>
                            <div className="row wrap">
                                <Btn id="getSurvey" label="Get Survey" variant="outline" onClick={onGetSurvey} />
                                <Btn id="list" label="List Surveys" variant="outline" onClick={onListSurveys} />
                                <Btn id="respCount" label="Response Count" variant="outline" onClick={onResponseCount} />
                                <Btn id="hasResp" label="Has Responded?" variant="outline" onClick={onHasResponded} />
                                <Btn id="accepting" label="Accepting?" variant="outline" onClick={onIsAccepting} />
                                <Btn id="total" label="Total Count" variant="ghost" onClick={onTotalCount} />
                            </div>
                        </Section>
                    )}

                    <ResultPanel result={result} onTip={(addr, surveyId) => openPayment(addr, { surveyId })} />

                    <footer className="foot">
                        <span>Built on Soroban · Stellar Testnet</span>
                        <span className="mono tiny">{CONTRACT_ID}</span>
                    </footer>
                </main>
            </div>

            {/* ===== Transaction Status Drawer ===== */}
            <TxDrawer transactions={transactions} onDismiss={dismissTx} />

            {/* ===== Payment Modal ===== */}
            {paymentModal && (
                <PaymentModal
                    state={paymentModal}
                    onChange={(patch) => setPaymentModal((p) => ({ ...p, ...patch }))}
                    onClose={() => setPaymentModal(null)}
                    onSubmit={submitPayment}
                    busy={busyAction === "payment"}
                />
            )}
        </div>
    );
}

// ============================== Components ==============================

function Section({ title, tag, children }) {
    return (
        <section className="card panel">
            <div className="panel-head">
                <h2>{title}</h2>
                {tag && <span className="panel-tag">{tag}</span>}
            </div>
            {children}
        </section>
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

function ExplorePanel({ ids, surveys, participants, loading, onRefresh, onView, onRespond, onManage, onShare, onLoadParticipants, onTip, wallet, selected }) {
    return (
        <div className="explore">
            <div className="explore-head">
                <div>
                    <h2>All Surveys</h2>
                    <p>Click any survey to expand details, share, or respond.</p>
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
                    <p>Be the first to publish — head to <strong>01 / Create</strong>.</p>
                </div>
            )}

            <div className="survey-grid">
                {ids.map((id) => {
                    const s = surveys[id];
                    const isSelected = selected === id;
                    const parts = participants[id];
                    const isCreator = wallet && s && s.creator === wallet.publicKey;

                    return (
                        <article key={id} className={`survey-card ${isSelected ? "is-selected" : ""}`}>
                            <header className="survey-card-head">
                                <div className="survey-id">
                                    <span className="survey-id-tag">{id}</span>
                                    {s && <span className={`status-pill pill-${(s.status || "").toLowerCase()}`}>{s.status}</span>}
                                </div>
                                <div className="survey-actions-mini">
                                    <button type="button" className="icon-btn" title="Share" onClick={() => onShare(id)}>↗</button>
                                </div>
                            </header>

                            {s ? (
                                <>
                                    <h3 className="survey-title">{s.title}</h3>
                                    <p className="survey-desc">{s.description || "No description"}</p>

                                    <div className="survey-meta">
                                        <Stat label="Responses" value={`${s.response_count}${s.max_responses ? ` / ${s.max_responses}` : ""}`} />
                                        <Stat label="Questions" value={s.question_count} />
                                        <Stat label="Reward" value={`${stroopsToXlm(s.reward_per_response)} XLM`} />
                                        <Stat label="Ends" value={formatTime(s.end_time)} small />
                                    </div>

                                    <div className="survey-actions">
                                        <button type="button" className="btn btn-sm btn-primary" onClick={() => onRespond(id)}>Respond</button>
                                        <button type="button" className="btn btn-sm btn-outline" onClick={() => onShare(id)}>Share</button>
                                        {isCreator && (
                                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onManage(id)}>Manage</button>
                                        )}
                                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onView(id)}>
                                            {isSelected ? "Hide" : "Participants"}
                                        </button>
                                    </div>

                                    {isSelected && (
                                        <div className="participants">
                                            <div className="participants-head">
                                                <strong>Participants</strong>
                                                <button type="button" className="link-btn" onClick={() => onLoadParticipants(id)}>Reload</button>
                                            </div>
                                            {!parts && <span className="hint">Loading…</span>}
                                            {parts && parts.length === 0 && <span className="hint">No responses yet.</span>}
                                            {parts && parts.length > 0 && (
                                                <ul className="participant-list">
                                                    {parts.map((p, idx) => (
                                                        <li key={`${p}-${idx}`}>
                                                            <span className="mono small">{truncate(p, 8, 8)}</span>
                                                            {wallet?.publicKey && wallet.publicKey !== p && (
                                                                <button type="button" className="btn btn-xs btn-primary" onClick={() => onTip(p, id)}>
                                                                    Tip
                                                                </button>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
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

function Stat({ label, value, small }) {
    return (
        <div className="meta-stat">
            <span className="meta-label">{label}</span>
            <span className={`meta-value ${small ? "small" : ""}`}>{value}</span>
        </div>
    );
}

function ResultPanel({ result, onTip }) {
    if (result.kind === "idle") return null;

    return (
        <section className={`card result result-${result.kind}`}>
            <div className="panel-head">
                <h2>{result.title || "Result"}</h2>
                <span className={`panel-tag tag-${result.kind}`}>{result.kind}</span>
            </div>
            <ResultBody body={result.body} onTip={onTip} />
        </section>
    );
}

function ResultBody({ body, onTip }) {
    if (body == null) return <p className="result-empty">No data.</p>;
    if (typeof body === "string") return <p className="result-text">{body}</p>;
    if (typeof body !== "object" || !body.kind) return <pre className="result-pre">{JSON.stringify(body, null, 2)}</pre>;

    if (body.kind === "stat") {
        return (
            <div className="big-stat">
                <span className="big-stat-label">{body.stat}</span>
                <span className="big-stat-value">{body.value}</span>
            </div>
        );
    }
    if (body.kind === "boolean") {
        return (
            <div className={`bool-stat ${body.value ? "bool-yes" : "bool-no"}`}>
                <span className="bool-icon">{body.value ? "✓" : "✗"}</span>
                <span className="bool-label">{body.label}</span>
                <span className="bool-value">{body.value ? "Yes" : "No"}</span>
            </div>
        );
    }
    if (body.kind === "ids") {
        return (
            <ul className="id-list">
                {(body.ids || []).map((id) => <li key={id} className="mono">{id}</li>)}
                {(!body.ids || body.ids.length === 0) && <li>No surveys yet.</li>}
            </ul>
        );
    }
    if (body.kind === "survey") {
        const s = body.survey;
        return (
            <div className="survey-detail">
                <h3>{s.title}</h3>
                <p>{s.description}</p>
                <div className="survey-meta">
                    <Stat label="Status" value={s.status} />
                    <Stat label="Responses" value={`${s.response_count}${s.max_responses ? ` / ${s.max_responses}` : ""}`} />
                    <Stat label="Questions" value={s.question_count} />
                    <Stat label="Reward" value={`${stroopsToXlm(s.reward_per_response)} XLM`} />
                    <Stat label="Created" value={formatTime(s.created_at)} small />
                    <Stat label="Ends" value={formatTime(s.end_time)} small />
                </div>
                <div className="creator-row">
                    <span className="meta-label">Creator</span>
                    <span className="mono small">{s.creator}</span>
                </div>
            </div>
        );
    }
    if (body.kind === "participants") {
        return (
            <div className="result-participants">
                <p>{body.list.length} participant{body.list.length === 1 ? "" : "s"} in <strong className="mono">{body.surveyId}</strong></p>
                <ul className="participant-list">
                    {body.list.map((p, i) => (
                        <li key={`${p}-${i}`}>
                            <span className="mono small">{p}</span>
                            <button type="button" className="btn btn-xs btn-primary" onClick={() => onTip(p, body.surveyId)}>Tip</button>
                        </li>
                    ))}
                    {body.list.length === 0 && <li className="hint">No responses yet.</li>}
                </ul>
            </div>
        );
    }
    if (body.kind === "share") {
        return (
            <div className="share-result">
                <p>Share this link to invite someone to respond:</p>
                <code className="share-link mono small">{body.url}</code>
            </div>
        );
    }
    if (body.kind === "payment") {
        return (
            <div className="payment-result">
                <p><strong>{body.amount} XLM</strong> sent to <span className="mono small">{truncate(body.to, 8, 8)}</span></p>
                {body.hash && (
                    <a href={`https://stellar.expert/explorer/testnet/tx/${body.hash}`} target="_blank" rel="noreferrer" className="link-btn">
                        View transaction ↗
                    </a>
                )}
            </div>
        );
    }
    if (body.kind === "create") {
        return (
            <div className="result-flat">
                <p><strong>{body.title}</strong> published as <span className="mono">{body.id}</span>.</p>
                {body.reward && Number(body.reward) > 0 && <p>Reward: {body.reward} XLM per response (informational)</p>}
            </div>
        );
    }
    if (body.kind === "respond") {
        return (
            <div className="result-flat">
                <p>Response submitted to <strong className="mono">{body.surveyId}</strong>.</p>
                <p className="hint">Answers stored in tx args; participation recorded on-chain.</p>
            </div>
        );
    }
    return <pre className="result-pre">{JSON.stringify(body, null, 2)}</pre>;
}

function TxDrawer({ transactions, onDismiss }) {
    if (!transactions.length) return null;
    return (
        <div className="tx-drawer">
            {transactions.map((tx) => (
                <div key={tx.id} className={`tx-card tx-${tx.status}`}>
                    <span className="tx-icon">
                        {tx.status === "pending" && <span className="spinner" />}
                        {tx.status === "success" && "✓"}
                        {tx.status === "error" && "✗"}
                    </span>
                    <div className="tx-body">
                        <span className="tx-label">{tx.label}</span>
                        <span className="tx-meta">
                            {tx.status === "pending" && "Awaiting network…"}
                            {tx.status === "success" && (tx.hash ? (
                                <a className="link-btn" href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer">
                                    View on stellar.expert ↗
                                </a>
                            ) : "Done")}
                            {tx.status === "error" && (tx.error || "Failed")}
                        </span>
                    </div>
                    <button type="button" className="tx-close" onClick={() => onDismiss(tx.id)}>×</button>
                </div>
            ))}
        </div>
    );
}

function PaymentModal({ state, onChange, onClose, onSubmit, busy }) {
    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                    <h2>Send Payment</h2>
                    <button type="button" className="tx-close" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    <Field label="Recipient" value={state.recipient} readOnly />
                    {state.surveyId && <Field label="For Survey" value={state.surveyId} readOnly />}
                    <Field
                        label="Amount (XLM)"
                        type="number"
                        value={state.amount}
                        onChange={(e) => onChange({ amount: e.target.value })}
                        hint="Sent as a native XLM payment from your connected wallet."
                    />
                    <Field
                        label="Memo (optional)"
                        value={state.memo || ""}
                        onChange={(e) => onChange({ memo: e.target.value })}
                        hint="Max 28 characters."
                    />
                </div>
                <div className="modal-foot">
                    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="button" className={`btn btn-primary ${busy ? "is-loading" : ""}`} onClick={onSubmit} disabled={busy}>
                        Send {state.amount} XLM
                    </button>
                </div>
            </div>
        </div>
    );
}
