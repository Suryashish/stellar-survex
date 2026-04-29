import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
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
    withdrawUnusedFunds,
    enableWhitelist,
    addToWhitelist,
    submitResponse,
    getSurvey,
    listSurveys,
    getTotalCount,
    hasResponded,
    isAcceptingResponses,
    getResponses,
    sendPayment,
    xlmToStroops,
    stroopsToXlm,
    unixToLocalInput,
    localInputToUnix,
    formatUnix,
    formatRelative,
    CONTRACT_ID,
    NETWORK_NAME,
} from "../lib/stellar.js";

const nowTs = () => Math.floor(Date.now() / 1000);
const weekFromNow = () => nowTs() + 7 * 86400;

const truncate = (addr, head = 6, tail = 4) =>
    !addr || addr.length < head + tail + 3 ? addr || "" : `${addr.slice(0, head)}…${addr.slice(-tail)}`;

const statusLabel = (status) => {
    if (status == null) return "Unknown";
    if (typeof status === "string") return status;
    if (typeof status === "object" && "tag" in status) return status.tag;
    return String(status);
};

const normalizeSurvey = (raw) => {
    if (!raw) return null;
    const questions = Array.isArray(raw.questions) ? raw.questions.map((q) => String(q)) : [];
    return {
        id: typeof raw.id === "string" ? raw.id : String(raw.id),
        creator: raw.creator,
        title: raw.title,
        description: raw.description,
        questions,
        question_count: questions.length,
        response_count: Number(raw.response_count),
        max_responses: Number(raw.max_responses),
        status: statusLabel(raw.status),
        created_at: Number(raw.created_at),
        end_time: Number(raw.end_time),
        reward_per_response: typeof raw.reward_per_response === "bigint"
            ? raw.reward_per_response
            : BigInt(raw.reward_per_response || 0),
        funded_remaining: typeof raw.funded_remaining === "bigint"
            ? raw.funded_remaining
            : BigInt(raw.funded_remaining || 0),
        reward_token: raw.reward_token,
    };
};

const decodeAnswers = (str) => {
    if (!str) return [];
    try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return parsed.map((v) => String(v));
        return [String(str)];
    } catch {
        return [String(str)];
    }
};

const NAV = [
    { key: "explore", num: "00", label: "Explore" },
    { key: "create", num: "01", label: "Create" },
    { key: "manage", num: "02", label: "Manage" },
    { key: "analytics", num: "03", label: "Analytics" },
];

const newTxId = () => `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const slugifyId = (text) => {
    const base = String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32);
    return base || `s_${Math.random().toString(36).slice(2, 8)}`;
};

const emptyCreateForm = () => ({
    id: `survey_${Math.random().toString(36).slice(2, 6)}`,
    title: "",
    description: "",
    questions: ["", ""],
    endTimeLocal: unixToLocalInput(weekFromNow()),
    maxResponses: "0",
    rewardXlm: "0",
});

export default function App() {
    const [wallet, setWallet] = useState(null);
    const [network, setNetwork] = useState("");
    const [activeNav, setActiveNav] = useState("explore");
    const [busyAction, setBusyAction] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [totalCount, setTotalCount] = useState(null);
    const [confirmKey, setConfirmKey] = useState(null);
    const confirmTimer = useRef(null);

    // Surveys data
    const [surveyIds, setSurveyIds] = useState([]);
    const [surveysById, setSurveysById] = useState({});
    const [responsesById, setResponsesById] = useState({});
    const [exploreLoading, setExploreLoading] = useState(false);
    const [expandedSurvey, setExpandedSurvey] = useState(null);

    // Selections
    const [manageId, setManageId] = useState("");
    const [respondId, setRespondId] = useState("");

    // Forms
    const [createForm, setCreateForm] = useState(emptyCreateForm());
    const [manageForm, setManageForm] = useState({
        newEndTimeLocal: "",
        manageRewardXlm: "0",
        whitelistAddrs: "",
    });
    const [answers, setAnswers] = useState([]);

    const [paymentModal, setPaymentModal] = useState(null);

    // Analytics
    const [analyticsId, setAnalyticsId] = useState("");
    const [analyticsScope, setAnalyticsScope] = useState("mine"); // "mine" | "all"
    const [analyticsCheck, setAnalyticsCheck] = useState({ accepting: null, hasResponded: null, respondent: "" });
    const [analyticsLoading, setAnalyticsLoading] = useState(false);

    // Shared landing (URL ?survey=<id>)
    const [sharedSurveyId, setSharedSurveyId] = useState(() => {
        if (typeof window === "undefined") return null;
        const params = new URLSearchParams(window.location.search);
        return params.get("survey") || null;
    });
    const [sharedSurveyState, setSharedSurveyState] = useState({ loading: true, survey: null, hasResponded: null, submitted: false });

    useEffect(() => {
        return () => confirmTimer.current && clearTimeout(confirmTimer.current);
    }, []);

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

    const notifyError = useCallback((label, error) => {
        const id = newTxId();
        setTransactions((prev) => [
            { id, label, status: "error", error, startedAt: Date.now() },
            ...prev.slice(0, 7),
        ]);
    }, []);

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
            notifyError("Failed to load surveys", error.message);
        } finally {
            setExploreLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const refreshResponses = useCallback(async (id) => {
        try {
            const list = await getResponses(id);
            const normalized = (list || []).map((entry) => ({
                respondent: entry.respondent,
                answers: decodeAnswers(entry.answers),
                rawAnswers: entry.answers,
                submitted_at: Number(entry.submitted_at || 0),
            }));
            setResponsesById((prev) => ({ ...prev, [id]: normalized }));
            return normalized;
        } catch {
            setResponsesById((prev) => ({ ...prev, [id]: [] }));
            return [];
        }
    }, []);

    // ---- mount ----
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
            if (!sharedSurveyId) {
                refreshTotal();
                refreshExplore();
            }
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Shared survey loader
    useEffect(() => {
        if (!sharedSurveyId) return;
        let cancelled = false;
        (async () => {
            setSharedSurveyState({ loading: true, survey: null, hasResponded: null, submitted: false });
            try {
                const raw = await getSurvey(sharedSurveyId);
                const normalized = normalizeSurvey(raw);
                if (cancelled) return;
                setSharedSurveyState({ loading: false, survey: normalized, hasResponded: null, submitted: false });
                if (normalized) {
                    setSurveysById((prev) => ({ ...prev, [sharedSurveyId]: normalized }));
                    setRespondId(sharedSurveyId);
                    setAnswers(new Array(normalized.questions.length).fill(""));
                }
            } catch {
                if (!cancelled) setSharedSurveyState({ loading: false, survey: null, hasResponded: null, submitted: false });
            }
        })();
        return () => { cancelled = true; };
    }, [sharedSurveyId]);

    // When wallet connects in shared mode, check if they already responded
    useEffect(() => {
        if (!sharedSurveyId || !wallet) return;
        let cancelled = false;
        (async () => {
            try {
                const value = await hasResponded(sharedSurveyId, wallet.publicKey);
                if (!cancelled) setSharedSurveyState((prev) => ({ ...prev, hasResponded: Boolean(value) }));
            } catch { /* tolerate */ }
        })();
        return () => { cancelled = true; };
    }, [sharedSurveyId, wallet]);

    const exitSharedMode = () => {
        setSharedSurveyId(null);
        if (typeof window !== "undefined") {
            window.history.replaceState({}, "", window.location.pathname);
        }
        refreshTotal();
        refreshExplore();
    };

    // ---- action runner ----
    const run = async (actionKey, label, fn, { onSuccess, refresh } = {}) => {
        setBusyAction(actionKey);
        const txId = addTx(label);
        try {
            const value = await fn();
            updateTx(txId, { status: "success", hash: value?.hash });
            if (onSuccess) await onSuccess(value);
            if (refresh?.total) await refreshTotal();
            if (refresh?.explore) await refreshExplore();
            if (refresh?.responsesOf) await refreshResponses(refresh.responsesOf);
            return value;
        } catch (error) {
            const message = error?.message || String(error);
            updateTx(txId, { status: "error", error: message });
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

    // ---- wallet ----
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
    };

    // ---- create ----
    const updateCreate = (patch) => setCreateForm((prev) => ({ ...prev, ...patch }));

    const onTitleBlur = () => {
        if (!createForm.id || createForm.id.startsWith("survey_")) {
            updateCreate({ id: slugifyId(createForm.title) });
        }
    };

    const onAddQuestion = () => updateCreate({ questions: [...createForm.questions, ""] });
    const onRemoveQuestion = (index) =>
        updateCreate({ questions: createForm.questions.filter((_, i) => i !== index) });
    const onSetQuestion = (index, value) => {
        const next = [...createForm.questions];
        next[index] = value;
        updateCreate({ questions: next });
    };

    const onCreate = () => {
        if (!requireWallet()) return;
        const trimmedQuestions = createForm.questions.map((q) => q.trim()).filter(Boolean);
        if (trimmedQuestions.length === 0) {
            notifyError("Add at least one question", "Use +Add Question before publishing.");
            return;
        }
        const endUnix = localInputToUnix(createForm.endTimeLocal);
        if (!endUnix || Number(endUnix) <= nowTs()) {
            notifyError("End time must be in the future", "Pick a date and time later than now.");
            return;
        }
        const rewardXlmNumeric = Number(createForm.rewardXlm.trim() || "0");
        const maxResponsesNumeric = Number(createForm.maxResponses.trim() || "0");
        if (rewardXlmNumeric > 0 && maxResponsesNumeric <= 0) {
            notifyError("Set Max Responses", "When the reward is greater than 0, Max Responses must be > 0 so the contract knows how much to escrow.");
            return;
        }

        run("create", `Create ${createForm.id}`, () => createSurvey({
            id: createForm.id.trim(),
            creator: wallet.publicKey,
            title: createForm.title.trim(),
            description: createForm.description.trim(),
            questions: trimmedQuestions,
            endTime: endUnix,
            maxResponses: createForm.maxResponses.trim() || "0",
            rewardStroops: xlmToStroops(createForm.rewardXlm.trim() || "0"),
        }), {
            onSuccess: () => setCreateForm(emptyCreateForm()),
            refresh: { total: true, explore: true },
        });
    };

    // ---- manage ----
    const selectForManage = useCallback((id) => {
        const s = surveysById[id];
        setManageId(id);
        setManageForm({
            newEndTimeLocal: s ? unixToLocalInput(s.end_time) : "",
            manageRewardXlm: s ? stroopsToXlm(s.reward_per_response) : "0",
            whitelistAddrs: "",
        });
        if (!responsesById[id]) refreshResponses(id);
    }, [surveysById, responsesById, refreshResponses]);

    const updateManage = (patch) => setManageForm((prev) => ({ ...prev, ...patch }));

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

    const onPause = () => {
        if (!requireWallet() || !manageId) return;
        run("pause", `Pause ${manageId}`, () =>
            pauseSurvey({ id: manageId, creator: wallet.publicKey }),
            { refresh: { explore: true } });
    };
    const onResume = () => {
        if (!requireWallet() || !manageId) return;
        run("resume", `Resume ${manageId}`, () =>
            resumeSurvey({ id: manageId, creator: wallet.publicKey }),
            { refresh: { explore: true } });
    };
    const onClose = () => {
        if (!requireWallet() || !manageId) return;
        handleConfirm("close", () =>
            run("close", `Close ${manageId}`, () =>
                closeSurvey({ id: manageId, creator: wallet.publicKey }),
                { refresh: { explore: true } }));
    };
    const onExtend = () => {
        if (!requireWallet() || !manageId) return;
        const unix = localInputToUnix(manageForm.newEndTimeLocal);
        if (!unix) { notifyError("Pick a new end time", "Choose a future date and time."); return; }
        run("extend", `Extend ${manageId}`, () => extendSurvey({
            id: manageId,
            creator: wallet.publicKey,
            newEndTime: unix,
        }), { refresh: { explore: true } });
    };
    const onWithdrawFunds = () => {
        if (!requireWallet() || !manageId) return;
        run("withdraw", `Withdraw unused funds ${manageId}`, () =>
            withdrawUnusedFunds({ id: manageId, creator: wallet.publicKey }),
            { refresh: { explore: true } });
    };
    const onEnableWhitelist = () => {
        if (!requireWallet() || !manageId) return;
        run("enable_wl", `Enable whitelist ${manageId}`, () =>
            enableWhitelist({ id: manageId, creator: wallet.publicKey }));
    };
    const onAddWhitelist = () => {
        if (!requireWallet() || !manageId) return;
        const addresses = manageForm.whitelistAddrs.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
        if (!addresses.length) {
            notifyError("Whitelist", "Enter at least one address.");
            return;
        }
        run("add_wl", `Whitelist +${addresses.length}`, () => addToWhitelist({
            id: manageId,
            creator: wallet.publicKey,
            addresses,
        }), {
            onSuccess: () => updateManage({ whitelistAddrs: "" }),
        });
    };

    // ---- respond ----
    useEffect(() => {
        const s = surveysById[respondId];
        if (s && answers.length !== s.questions.length) {
            setAnswers(new Array(s.questions.length).fill(""));
        }
    }, [respondId, surveysById, answers.length]);

    const setAnswer = (index, value) => {
        setAnswers((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
    };

    const onSubmitResponse = () => {
        if (!requireWallet() || !respondId) return;
        const survey = surveysById[respondId];
        if (!survey) {
            notifyError("Survey not found", respondId);
            return;
        }
        if (answers.some((a, i) => i < survey.questions.length && !a.trim())) {
            notifyError("Answer all questions", "Each question needs a response before submitting.");
            return;
        }
        const payload = JSON.stringify(answers.slice(0, survey.questions.length).map((a) => a.trim()));
        run("respond", `Respond to ${respondId}`, () => submitResponse({
            surveyId: respondId,
            respondent: wallet.publicKey,
            answers: payload,
        }), {
            onSuccess: () => {
                setAnswers(new Array(survey.questions.length).fill(""));
                if (sharedSurveyId === respondId) {
                    setSharedSurveyState((prev) => ({ ...prev, submitted: true, hasResponded: true }));
                }
            },
            refresh: sharedSurveyId ? {} : { explore: true, responsesOf: respondId },
        });
    };

    // ---- analytics ----
    const loadAnalytics = useCallback(async (id) => {
        if (!id) return;
        setAnalyticsId(id);
        setAnalyticsLoading(true);
        setAnalyticsCheck({ accepting: null, hasResponded: null, respondent: "" });
        try {
            const [surveyRaw, accepting] = await Promise.all([
                getSurvey(id).catch(() => null),
                isAcceptingResponses(id).catch(() => null),
            ]);
            const normalized = normalizeSurvey(surveyRaw);
            if (normalized) {
                setSurveysById((prev) => ({ ...prev, [id]: normalized }));
            }
            setAnalyticsCheck((prev) => ({ ...prev, accepting }));
            await refreshResponses(id);
        } catch {
            /* tolerate partial */
        } finally {
            setAnalyticsLoading(false);
        }
    }, [refreshResponses]);

    const onCheckHasResponded = (address) => {
        if (!analyticsId) return;
        const target = (address || analyticsCheck.respondent || wallet?.publicKey || "").trim();
        if (!target) {
            notifyError("Address required", "Connect a wallet or paste an address to check.");
            return;
        }
        run("hasResp", `Check ${truncate(target)}`, async () => {
            const value = await hasResponded(analyticsId, target);
            setAnalyticsCheck((prev) => ({ ...prev, respondent: target, hasResponded: Boolean(value) }));
            return { hash: null };
        });
    };

    const refreshTotalAndExplore = useCallback(async () => {
        await Promise.all([refreshTotal(), refreshExplore()]);
    }, [refreshTotal, refreshExplore]);

    // ---- explore actions ----
    const startManageFromExplore = (id) => { selectForManage(id); setActiveNav("manage"); };
    const startRespondFromExplore = (id) => {
        const url = `${window.location.origin}${window.location.pathname}?survey=${encodeURIComponent(id)}`;
        window.open(url, "_blank", "noopener");
    };

    const shareSurvey = async (id) => {
        const url = `${window.location.origin}${window.location.pathname}?survey=${encodeURIComponent(id)}`;
        try {
            await navigator.clipboard.writeText(url);
            const txId = addTx("Share link copied");
            updateTx(txId, { status: "success" });
        } catch {
            notifyError("Share link", url);
        }
    };

    // ---- payments ----
    const openPayment = (recipient, context) => {
        if (!wallet) {
            notifyError("Connect wallet", "Connect Freighter to send a payment.");
            return;
        }
        setPaymentModal({ recipient, ...context, amount: "1", memo: context?.surveyId ? `Reward · ${context.surveyId}` : "Survey reward" });
    };

    const submitPayment = async () => {
        if (!paymentModal) return;
        const { recipient, amount, memo } = paymentModal;
        await run("payment", `Tip ${truncate(recipient)} · ${amount} XLM`, () => sendPayment({
            from: wallet.publicKey,
            to: recipient,
            amount,
            memo,
        }), {
            onSuccess: () => {
                setPaymentModal(null);
            },
        });
    };

    // ---- derived data ----
    const sortedSurveyIds = useMemo(() => {
        return [...surveyIds].sort((a, b) => {
            const sa = surveysById[a]; const sb = surveysById[b];
            return (sb?.created_at || 0) - (sa?.created_at || 0);
        });
    }, [surveyIds, surveysById]);

    const mySurveys = useMemo(() => {
        if (!wallet) return [];
        return sortedSurveyIds
            .map((id) => surveysById[id])
            .filter((s) => s && s.creator === wallet.publicKey);
    }, [wallet, sortedSurveyIds, surveysById]);

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

    if (sharedSurveyId) {
        return (
            <>
                <SharedRespondPage
                    state={sharedSurveyState}
                    surveyId={sharedSurveyId}
                    wallet={wallet}
                    answers={answers}
                    onSetAnswer={setAnswer}
                    onConnect={onConnect}
                    onDisconnect={onDisconnect}
                    onSubmit={onSubmitResponse}
                    onExit={exitSharedMode}
                    connecting={busyAction === "connect"}
                    submitting={busyAction === "respond"}
                    disabled={isBusy}
                />
                {createPortal(
                    <TxDrawer transactions={transactions} onDismiss={dismissTx} onClearAll={() => setTransactions([])} />,
                    document.body,
                )}
            </>
        );
    }

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
                            {activeNav === "explore" && "Browse surveys, share links, peek at participants"}
                            {activeNav === "create" && "Build your questions and publish on-chain"}
                            {activeNav === "manage" && "Edit your surveys and review every response"}
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
                            responses={responsesById}
                            loading={exploreLoading}
                            onRefresh={refreshExplore}
                            onExpand={(id) => {
                                setExpandedSurvey(id);
                                if (!responsesById[id]) refreshResponses(id);
                            }}
                            onCollapse={() => setExpandedSurvey(null)}
                            onRespond={startRespondFromExplore}
                            onManage={startManageFromExplore}
                            onShare={shareSurvey}
                            onTip={(addr, surveyId) => openPayment(addr, { surveyId })}
                            onLoadResponses={(id) =>
                                run("loadResp", `Load responses ${id}`, async () => {
                                    await refreshResponses(id);
                                    return { hash: null };
                                })
                            }
                            wallet={wallet}
                            expanded={expandedSurvey}
                        />
                    )}

                    {activeNav === "create" && (
                        <CreatePanel
                            form={createForm}
                            wallet={wallet}
                            onTitleBlur={onTitleBlur}
                            onChange={(e) => updateCreate({ [e.target.name]: e.target.value })}
                            onSetQuestion={onSetQuestion}
                            onAddQuestion={onAddQuestion}
                            onRemoveQuestion={onRemoveQuestion}
                            onSubmit={onCreate}
                            busyKey={busyAction}
                            disabled={isBusy}
                        />
                    )}

                    {activeNav === "manage" && (
                        <ManagePanel
                            wallet={wallet}
                            mySurveys={mySurveys}
                            selectedId={manageId}
                            survey={surveysById[manageId]}
                            responses={responsesById[manageId]}
                            form={manageForm}
                            onSelect={selectForManage}
                            onChange={updateManage}
                            onPause={onPause}
                            onResume={onResume}
                            onClose={onClose}
                            onExtend={onExtend}
                            onWithdrawFunds={onWithdrawFunds}
                            onEnableWhitelist={onEnableWhitelist}
                            onAddWhitelist={onAddWhitelist}
                            onShare={shareSurvey}
                            onTip={(addr, sid) => openPayment(addr, { surveyId: sid })}
                            onReloadResponses={() => refreshResponses(manageId)}
                            busyAction={busyAction}
                            confirmKey={confirmKey}
                            disabled={isBusy}
                        />
                    )}

                    {activeNav === "analytics" && (
                        <AnalyticsPanel
                            wallet={wallet}
                            scope={analyticsScope}
                            onSetScope={setAnalyticsScope}
                            mySurveys={mySurveys}
                            allIds={sortedSurveyIds}
                            surveys={surveysById}
                            responses={responsesById}
                            selectedId={analyticsId}
                            onSelect={loadAnalytics}
                            check={analyticsCheck}
                            onSetCheck={setAnalyticsCheck}
                            loading={analyticsLoading}
                            onCheckHasResponded={onCheckHasResponded}
                            onShare={shareSurvey}
                            onTip={(addr, sid) => openPayment(addr, { surveyId: sid })}
                            onReloadResponses={() => refreshResponses(analyticsId)}
                            onRefresh={refreshTotalAndExplore}
                            totalCount={totalCount}
                            busyAction={busyAction}
                            disabled={isBusy}
                        />
                    )}

                    <footer className="foot">
                        <span>Built on Soroban · Stellar Testnet</span>
                        <span className="mono tiny">{CONTRACT_ID}</span>
                    </footer>
                </main>
            </div>

            {createPortal(
                <TxDrawer transactions={transactions} onDismiss={dismissTx} onClearAll={() => setTransactions([])} />,
                document.body,
            )}

            {paymentModal && createPortal(
                <PaymentModal
                    state={paymentModal}
                    onChange={(patch) => setPaymentModal((p) => ({ ...p, ...patch }))}
                    onClose={() => setPaymentModal(null)}
                    onSubmit={submitPayment}
                    busy={busyAction === "payment"}
                />,
                document.body,
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

function Field({ label, name, value, onChange, type = "text", hint, textarea, rows = 2, readOnly, placeholder, onBlur }) {
    return (
        <div className={`field ${readOnly ? "field-ro" : ""}`}>
            <label>{label}</label>
            {textarea ? (
                <textarea name={name} value={value} onChange={onChange} rows={rows} readOnly={readOnly} placeholder={placeholder} onBlur={onBlur} />
            ) : (
                <input name={name} value={value} onChange={onChange} type={type} readOnly={readOnly} placeholder={placeholder} onBlur={onBlur} />
            )}
            {hint && <span className="hint">{hint}</span>}
        </div>
    );
}

function StatusPill({ status }) {
    const cls = (status || "").toLowerCase();
    return <span className={`status-pill pill-${cls}`}>{status}</span>;
}

function Stat({ label, value, small }) {
    return (
        <div className="meta-stat">
            <span className="meta-label">{label}</span>
            <span className={`meta-value ${small ? "small" : ""}`}>{value}</span>
        </div>
    );
}

// ---------- Create ----------
function CreatePanel({ form, wallet, onTitleBlur, onChange, onSetQuestion, onAddQuestion, onRemoveQuestion, onSubmit, busyKey, disabled }) {
    const endUnix = localInputToUnix(form.endTimeLocal);
    const rewardNum = Number(form.rewardXlm || "0");
    const maxNum = Number(form.maxResponses || "0");
    const totalEscrow = rewardNum > 0 ? rewardNum * maxNum : 0;
    const escrowError = rewardNum > 0 && maxNum <= 0;

    return (
        <Section title="Create a Survey" tag="create_survey">
            <div className="grid-2">
                <Field label="Title" name="title" value={form.title} onChange={onChange} onBlur={onTitleBlur} placeholder="What do you want to ask?" />
                <Field label="Survey ID" name="id" value={form.id} onChange={onChange} hint="Unique on-chain identifier (auto-generated from title — letters, numbers, underscore, max 32)." />
            </div>
            <Field label="Description" name="description" textarea rows={2} value={form.description} onChange={onChange} placeholder="Optional context for respondents." />

            <div className="builder">
                <div className="builder-head">
                    <label>Questions</label>
                    <span className="hint">{form.questions.length} question{form.questions.length === 1 ? "" : "s"}</span>
                </div>
                {form.questions.map((q, i) => (
                    <div className="question-row" key={i}>
                        <span className="q-num">Q{i + 1}</span>
                        <input
                            value={q}
                            onChange={(e) => onSetQuestion(i, e.target.value)}
                            placeholder={`Question ${i + 1}`}
                        />
                        <button
                            type="button"
                            className="icon-btn-danger"
                            onClick={() => onRemoveQuestion(i)}
                            disabled={form.questions.length <= 1}
                            title="Remove question"
                        >
                            ×
                        </button>
                    </div>
                ))}
                <button type="button" className="btn btn-outline btn-sm builder-add" onClick={onAddQuestion}>
                    + Add Question
                </button>
            </div>

            <div className="grid-2">
                <Field label="Closes At" name="endTimeLocal" type="datetime-local" value={form.endTimeLocal} onChange={onChange} hint={endUnix ? `${formatUnix(endUnix)} · ${formatRelative(endUnix)}` : "Pick a future date and time"} />
                <Field label="Max Responses" name="maxResponses" type="number" value={form.maxResponses} onChange={onChange} hint={rewardNum > 0 ? "Required when reward > 0 (sets escrow size)" : "0 = unlimited"} />
                <Field label="Reward per Response (XLM)" name="rewardXlm" value={form.rewardXlm} onChange={onChange} hint="Paid out automatically on each response from the escrow." />
                <Field label="Creator" value={wallet ? wallet.publicKey : "Connect wallet to auto-fill"} readOnly />
            </div>

            <div className={`escrow-card ${escrowError ? "escrow-bad" : totalEscrow > 0 ? "escrow-on" : "escrow-off"}`}>
                <div className="escrow-line">
                    <span className="escrow-label">Total to escrow on publish</span>
                    <span className="escrow-value">
                        {escrowError ? "—" : `${totalEscrow.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM`}
                    </span>
                </div>
                <span className="hint">
                    {escrowError
                        ? "Set Max Responses > 0 — the contract needs a known cap so it can hold the right amount of XLM."
                        : totalEscrow > 0
                            ? `${rewardNum} XLM × ${maxNum} responses. The contract holds this in escrow and pays each respondent automatically on submit.`
                            : "No reward configured. Respondents won't receive any XLM."}
                </span>
            </div>

            <div className="row">
                <button
                    type="button"
                    className={`btn btn-primary ${busyKey === "create" ? "is-loading" : ""}`}
                    onClick={onSubmit}
                    disabled={disabled || escrowError}
                >
                    {totalEscrow > 0 ? `Publish & Escrow ${totalEscrow.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM` : "Publish Survey"}
                </button>
            </div>
        </Section>
    );
}

// ---------- Manage ----------
function ManageBtn({ id, label, variant = "primary", onClick, confirmKey, confirmLabel, busyAction, disabled }) {
    const isActive = confirmKey === id;
    const isLoading = busyAction === id;
    return (
        <button
            type="button"
            className={`btn btn-${variant} ${isLoading ? "is-loading" : ""}`}
            onClick={onClick}
            disabled={disabled}
        >
            {isActive ? confirmLabel || "Confirm?" : label}
        </button>
    );
}

function ManagePanel({ wallet, mySurveys, selectedId, survey, responses, form, onSelect, onChange, onPause, onResume, onClose, onExtend, onWithdrawFunds, onEnableWhitelist, onAddWhitelist, onShare, onTip, onReloadResponses, busyAction, confirmKey, disabled }) {
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

function ResponsesSection({ survey, responses, onReload, onTip, wallet }) {
    return (
        <Section title="Responses" tag={`${responses ? responses.length : "—"} total`}>
            <div className="row" style={{ marginBottom: "0.75rem" }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={onReload}>Reload</button>
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


// ---------- Explore ----------
function ExplorePanel({ ids, surveys, responses, loading, onRefresh, onExpand, onCollapse, onRespond, onManage, onShare, onTip, onLoadResponses, wallet, expanded }) {
    return (
        <div className="explore">
            <div className="explore-head">
                <div>
                    <h2>All Surveys</h2>
                    <p>Click any survey to expand. Tap Share to copy a public link.</p>
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
                {ids.map((id) => {
                    const s = surveys[id];
                    const isExpanded = expanded === id;
                    const list = responses[id];
                    const isCreator = wallet && s && s.creator === wallet.publicKey;

                    return (
                        <article key={id} className={`survey-card ${isExpanded ? "is-selected" : ""}`}>
                            {s ? (
                                <>
                                    <header className="survey-card-head">
                                        <div className="survey-id">
                                            <span className="survey-id-tag">{id}</span>
                                            <StatusPill status={s.status} />
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
                                        {isCreator && (
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


// ---------- Analytics ----------
function AnalyticsPanel({ wallet, scope, onSetScope, mySurveys, allIds, surveys, responses, selectedId, onSelect, check, onSetCheck, loading, onCheckHasResponded, onShare, onTip, onReloadResponses, onRefresh, totalCount, busyAction, disabled }) {
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

// ---------- Tx Drawer ----------
function TxDrawer({ transactions, onDismiss, onClearAll }) {
    if (!transactions.length) return null;
    const pending = transactions.filter((t) => t.status === "pending").length;
    return (
        <div className="tx-drawer">
            <div className="tx-drawer-head">
                <div className="tx-drawer-title">
                    <span className="tx-drawer-dot" />
                    <span>Activity</span>
                    <span className="tx-drawer-count">
                        {pending > 0 ? `${pending} pending` : `${transactions.length} item${transactions.length === 1 ? "" : "s"}`}
                    </span>
                </div>
                <button type="button" className="tx-clear-all" onClick={onClearAll}>Clear</button>
            </div>
            <div className="tx-drawer-body">
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
        </div>
    );
}

// ---------- Shared Respond Page (public link landing) ----------
function SharedRespondPage({ state, surveyId, wallet, answers, onSetAnswer, onConnect, onDisconnect, onSubmit, onExit, connecting, submitting, disabled }) {
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
                <button type="button" className="shared-brand" onClick={onExit} title="Open Survey Builder">
                    <span className="brand-mark">SB</span>
                    <span className="brand-text">
                        <strong>Survey Builder</strong>
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
                    <button type="button" className="link-btn" onClick={onExit}>← Open the full Survey Builder app</button>
                </div>
            </main>
        </div>
    );
}

// ---------- Payment Modal ----------
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
