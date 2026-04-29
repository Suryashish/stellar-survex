import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
    CONTRACT_ID,
    NETWORK_NAME,
} from "../lib/stellar.js";

import { NAV, nowTs, truncate, newTxId } from "./utils/constants.js";
import { normalizeSurvey, decodeAnswers, slugifyId, emptyCreateForm } from "./utils/survey.js";

import TxDrawer from "./components/TxDrawer.jsx";
import PaymentModal from "./components/PaymentModal.jsx";

import ExplorePage from "./pages/ExplorePage.jsx";
import CreatePage from "./pages/CreatePage.jsx";
import ManagePage from "./pages/ManagePage.jsx";
import AnalyticsPage from "./pages/AnalyticsPage.jsx";
import SharedRespondPage from "./pages/SharedRespondPage.jsx";

export default function App() {
    const [wallet, setWallet] = useState(null);
    const [network, setNetwork] = useState("");
    const [activeNav, setActiveNav] = useState("explore");
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
    const [analyticsScope, setAnalyticsScope] = useState("mine");
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
            <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
                <div className="sidebar-bar">
                    <div className="brand">
                        <div className="brand-mark">SB</div>
                        <div className="brand-text">
                            <strong>Survey Builder</strong>
                            <span>Soroban · Testnet</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="nav-toggle"
                        aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
                        aria-expanded={mobileNavOpen}
                        onClick={() => setMobileNavOpen((v) => !v)}
                    >
                        <span className="nav-toggle-icon" aria-hidden="true">
                            {mobileNavOpen ? "✕" : "☰"}
                        </span>
                    </button>
                </div>

                <nav className="nav">
                    {NAV.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            className={`nav-item ${activeNav === item.key ? "nav-active" : ""}`}
                            onClick={() => { setActiveNav(item.key); setMobileNavOpen(false); }}
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
                        <ExplorePage
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
                        <CreatePage
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
                        <ManagePage
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
                        <AnalyticsPage
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
