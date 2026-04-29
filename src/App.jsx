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
    addCoAdmin,
    removeCoAdmin,
    getCoAdmins,
    setVisibility,
    addAllowedViewers,
    removeAllowedViewer,
    getAllowedViewers,
    isPrivateSurvey,
    canView,
    initSurveyAdmin,
    setSurveyPointsConfig,
    getSurveyPointsConfig,
    getSurveyContractAdmin,
    initPointsToken,
    setPointsTokenMinter,
    getPointsBalance,
    getPointsMetadata,
    POINTS_TOKEN_ID,
    sendPayment,
    xlmToStroops,
    stroopsToXlm,
    unixToLocalInput,
    localInputToUnix,
    CONTRACT_ID,
    NETWORK_NAME,
} from "../lib/stellar.js";

import { NAV, nowTs, truncate, newTxId } from "./utils/constants.js";
import { normalizeSurvey, decodeAnswers, slugifyId, emptyCreateForm, isValidStellarAddress, isValidContractId, parseAddressList } from "./utils/survey.js";

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
    const [coAdminsById, setCoAdminsById] = useState({});
    const [viewersById, setViewersById] = useState({});
    const [visibilityById, setVisibilityById] = useState({});
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
        viewerAddrs: "",
        newCoAdmin: "",
    });
    const [answers, setAnswers] = useState([]);

    const [paymentModal, setPaymentModal] = useState(null);

    // Analytics
    const [analyticsId, setAnalyticsId] = useState("");
    const [analyticsScope, setAnalyticsScope] = useState("mine");
    const [analyticsCheck, setAnalyticsCheck] = useState({ accepting: null, hasResponded: null, respondent: "" });
    const [analyticsLoading, setAnalyticsLoading] = useState(false);

    // Points-token state
    const [pointsMeta, setPointsMeta] = useState(null);
    const [pointsConfig, setPointsConfig] = useState({ token: null, creator: 0n, respondent: 0n });
    const [pointsBalance, setPointsBalance] = useState(0n);
    const [contractAdmin, setContractAdmin] = useState(null);

    // Shared landing (URL ?survey=<id>)
    const [sharedSurveyId, setSharedSurveyId] = useState(() => {
        if (typeof window === "undefined") return null;
        const params = new URLSearchParams(window.location.search);
        return params.get("survey") || null;
    });
    const [sharedSurveyState, setSharedSurveyState] = useState({ loading: true, survey: null, hasResponded: null, submitted: false, isPrivate: false, canView: null });

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

    const refreshPointsConfig = useCallback(async () => {
        try {
            const cfg = await getSurveyPointsConfig();
            const [token, creator, respondent] = Array.isArray(cfg) ? cfg : [null, 0n, 0n];
            setPointsConfig({
                token: token ? String(token) : null,
                creator: typeof creator === "bigint" ? creator : BigInt(creator || 0),
                respondent: typeof respondent === "bigint" ? respondent : BigInt(respondent || 0),
            });
        } catch {
            setPointsConfig({ token: null, creator: 0n, respondent: 0n });
        }
        try {
            const admin = await getSurveyContractAdmin();
            setContractAdmin(admin ? String(admin) : null);
        } catch {
            setContractAdmin(null);
        }
        if (POINTS_TOKEN_ID) {
            try {
                const meta = await getPointsMetadata();
                setPointsMeta(meta);
            } catch {
                setPointsMeta(null);
            }
        }
    }, []);

    const refreshPointsBalance = useCallback(async (address) => {
        if (!address || !POINTS_TOKEN_ID) {
            setPointsBalance(0n);
            return;
        }
        try {
            const value = await getPointsBalance(address);
            setPointsBalance(typeof value === "bigint" ? value : BigInt(value || 0));
        } catch {
            setPointsBalance(0n);
        }
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

            const fetchedSurveys = {};
            const fetchedCoAdmins = {};
            const fetchedViewers = {};
            const fetchedVisibility = {};
            await Promise.all(idStrings.map(async (id) => {
                try {
                    const data = await getSurvey(id);
                    fetchedSurveys[id] = normalizeSurvey(data);
                } catch {
                    fetchedSurveys[id] = null;
                }
                try {
                    const list = await getCoAdmins(id);
                    fetchedCoAdmins[id] = (list || []).map((a) => String(a));
                } catch {
                    fetchedCoAdmins[id] = [];
                }
                try {
                    const list = await getAllowedViewers(id);
                    fetchedViewers[id] = (list || []).map((a) => String(a));
                } catch {
                    fetchedViewers[id] = [];
                }
                try {
                    const value = await isPrivateSurvey(id);
                    fetchedVisibility[id] = Boolean(value);
                } catch {
                    fetchedVisibility[id] = false;
                }
            }));
            setSurveysById(fetchedSurveys);
            setCoAdminsById(fetchedCoAdmins);
            setViewersById(fetchedViewers);
            setVisibilityById(fetchedVisibility);
        } catch (error) {
            notifyError("Failed to load surveys", error.message);
        } finally {
            setExploreLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const refreshSurveyMeta = useCallback(async (id) => {
        if (!id) return;
        const [coAdminList, viewerList, priv] = await Promise.all([
            getCoAdmins(id).then((v) => (v || []).map(String)).catch(() => []),
            getAllowedViewers(id).then((v) => (v || []).map(String)).catch(() => []),
            isPrivateSurvey(id).then(Boolean).catch(() => false),
        ]);
        setCoAdminsById((prev) => ({ ...prev, [id]: coAdminList }));
        setViewersById((prev) => ({ ...prev, [id]: viewerList }));
        setVisibilityById((prev) => ({ ...prev, [id]: priv }));
        return { coAdminList, viewerList, priv };
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
            refreshPointsConfig();
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Refresh user's points balance whenever wallet identity changes.
    useEffect(() => {
        refreshPointsBalance(wallet?.publicKey || null);
    }, [wallet, refreshPointsBalance]);

    // Shared survey loader
    useEffect(() => {
        if (!sharedSurveyId) return;
        let cancelled = false;
        (async () => {
            setSharedSurveyState({ loading: true, survey: null, hasResponded: null, submitted: false, isPrivate: false, canView: null });
            try {
                const [raw, priv] = await Promise.all([
                    getSurvey(sharedSurveyId),
                    isPrivateSurvey(sharedSurveyId).then(Boolean).catch(() => false),
                ]);
                const normalized = normalizeSurvey(raw);
                if (cancelled) return;
                setSharedSurveyState({ loading: false, survey: normalized, hasResponded: null, submitted: false, isPrivate: priv, canView: null });
                if (normalized) {
                    setSurveysById((prev) => ({ ...prev, [sharedSurveyId]: normalized }));
                    setVisibilityById((prev) => ({ ...prev, [sharedSurveyId]: priv }));
                    setRespondId(sharedSurveyId);
                    setAnswers(new Array(normalized.questions.length).fill(""));
                }
            } catch {
                if (!cancelled) setSharedSurveyState({ loading: false, survey: null, hasResponded: null, submitted: false, isPrivate: false, canView: null });
            }
        })();
        return () => { cancelled = true; };
    }, [sharedSurveyId]);

    // When wallet connects in shared mode, check responded + access.
    useEffect(() => {
        if (!sharedSurveyId || !wallet) return;
        let cancelled = false;
        (async () => {
            try {
                const value = await hasResponded(sharedSurveyId, wallet.publicKey);
                if (!cancelled) setSharedSurveyState((prev) => ({ ...prev, hasResponded: Boolean(value) }));
            } catch { /* tolerate */ }
            try {
                const allowed = await canView(sharedSurveyId, wallet.publicKey);
                if (!cancelled) setSharedSurveyState((prev) => ({ ...prev, canView: Boolean(allowed) }));
            } catch {
                if (!cancelled) setSharedSurveyState((prev) => ({ ...prev, canView: !prev.isPrivate }));
            }
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
            if (refresh?.metaOf) await refreshSurveyMeta(refresh.metaOf);
            if (refresh?.pointsBalance && wallet?.publicKey) await refreshPointsBalance(wallet.publicKey);
            if (refresh?.pointsConfig) await refreshPointsConfig();
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

        const surveyId = createForm.id.trim();
        const isPrivate = createForm.visibility === "private";
        const initialViewers = isPrivate
            ? parseAddressList(createForm.initialViewers).filter(isValidStellarAddress)
            : [];

        run("create", `Create ${surveyId}`, async () => {
            const result = await createSurvey({
                id: surveyId,
                creator: wallet.publicKey,
                title: createForm.title.trim(),
                description: createForm.description.trim(),
                questions: trimmedQuestions,
                endTime: endUnix,
                maxResponses: createForm.maxResponses.trim() || "0",
                rewardStroops: xlmToStroops(createForm.rewardXlm.trim() || "0"),
            });
            if (isPrivate) {
                try {
                    await setVisibility({ id: surveyId, caller: wallet.publicKey, isPrivate: true });
                } catch (e) {
                    notifyError("Set visibility", e?.message || String(e));
                }
                if (initialViewers.length) {
                    try {
                        await addAllowedViewers({ id: surveyId, caller: wallet.publicKey, addresses: initialViewers });
                    } catch (e) {
                        notifyError("Add viewers", e?.message || String(e));
                    }
                }
            }
            return result;
        }, {
            onSuccess: () => setCreateForm(emptyCreateForm()),
            refresh: { total: true, explore: true, pointsBalance: true },
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
            viewerAddrs: "",
            newCoAdmin: "",
        });
        if (!responsesById[id]) refreshResponses(id);
        // Refresh meta (co-admins, viewers, visibility) on selection.
        refreshSurveyMeta(id);
    }, [surveysById, responsesById, refreshResponses, refreshSurveyMeta]);

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
            pauseSurvey({ id: manageId, caller: wallet.publicKey }),
            { refresh: { explore: true } });
    };
    const onResume = () => {
        if (!requireWallet() || !manageId) return;
        run("resume", `Resume ${manageId}`, () =>
            resumeSurvey({ id: manageId, caller: wallet.publicKey }),
            { refresh: { explore: true } });
    };
    const onClose = () => {
        if (!requireWallet() || !manageId) return;
        handleConfirm("close", () =>
            run("close", `Close ${manageId}`, () =>
                closeSurvey({ id: manageId, caller: wallet.publicKey }),
                { refresh: { explore: true } }));
    };
    const onExtend = () => {
        if (!requireWallet() || !manageId) return;
        const unix = localInputToUnix(manageForm.newEndTimeLocal);
        if (!unix) { notifyError("Pick a new end time", "Choose a future date and time."); return; }
        run("extend", `Extend ${manageId}`, () => extendSurvey({
            id: manageId,
            caller: wallet.publicKey,
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
            enableWhitelist({ id: manageId, caller: wallet.publicKey }));
    };
    const onAddWhitelist = () => {
        if (!requireWallet() || !manageId) return;
        const addresses = parseAddressList(manageForm.whitelistAddrs);
        if (!addresses.length) {
            notifyError("Whitelist", "Enter at least one address.");
            return;
        }
        const invalid = addresses.find((a) => !isValidStellarAddress(a));
        if (invalid) {
            notifyError("Whitelist", `Not a valid Stellar address: ${invalid}`);
            return;
        }
        run("add_wl", `Whitelist +${addresses.length}`, () => addToWhitelist({
            id: manageId,
            caller: wallet.publicKey,
            addresses,
        }), {
            onSuccess: () => updateManage({ whitelistAddrs: "" }),
        });
    };

    // ---- co-admin management ----
    const onAddCoAdmin = () => {
        if (!requireWallet() || !manageId) return;
        const addr = String(manageForm.newCoAdmin || "").trim();
        if (!isValidStellarAddress(addr)) {
            notifyError("Co-admin", "Enter a valid G… Stellar address.");
            return;
        }
        if (addr === wallet.publicKey) {
            notifyError("Co-admin", "You're already the admin.");
            return;
        }
        run("add_coadmin", `Add co-admin ${truncate(addr)}`, () => addCoAdmin({
            id: manageId,
            creator: wallet.publicKey,
            address: addr,
        }), {
            onSuccess: () => updateManage({ newCoAdmin: "" }),
            refresh: { metaOf: manageId },
        });
    };

    const onRemoveCoAdmin = (addr) => {
        if (!requireWallet() || !manageId) return;
        run("remove_coadmin", `Remove co-admin ${truncate(addr)}`, () => removeCoAdmin({
            id: manageId,
            creator: wallet.publicKey,
            address: addr,
        }), { refresh: { metaOf: manageId } });
    };

    // ---- visibility & viewers ----
    const onSetVisibility = (isPrivate) => {
        if (!requireWallet() || !manageId) return;
        run("set_vis", `${isPrivate ? "Private" : "Public"} ${manageId}`, () => setVisibility({
            id: manageId,
            caller: wallet.publicKey,
            isPrivate,
        }), { refresh: { metaOf: manageId } });
    };

    const onAddViewers = () => {
        if (!requireWallet() || !manageId) return;
        const addresses = parseAddressList(manageForm.viewerAddrs);
        if (!addresses.length) {
            notifyError("Viewers", "Enter at least one address.");
            return;
        }
        const invalid = addresses.find((a) => !isValidStellarAddress(a));
        if (invalid) {
            notifyError("Viewers", `Not a valid Stellar address: ${invalid}`);
            return;
        }
        run("add_viewers", `Allow +${addresses.length}`, () => addAllowedViewers({
            id: manageId,
            caller: wallet.publicKey,
            addresses,
        }), {
            onSuccess: () => updateManage({ viewerAddrs: "" }),
            refresh: { metaOf: manageId },
        });
    };

    const onRemoveViewer = (addr) => {
        if (!requireWallet() || !manageId) return;
        run("remove_viewer", `Revoke ${truncate(addr)}`, () => removeAllowedViewer({
            id: manageId,
            caller: wallet.publicKey,
            address: addr,
        }), { refresh: { metaOf: manageId } });
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
            refresh: sharedSurveyId
                ? { pointsBalance: true }
                : { explore: true, responsesOf: respondId, pointsBalance: true },
        });
    };

    // ---- token / admin setup ----
    const onClaimSurveyAdmin = () => {
        if (!requireWallet()) return;
        run("init_admin", "Claim survey admin", () => initSurveyAdmin({ admin: wallet.publicKey }), {
            refresh: { pointsConfig: true },
        });
    };

    const onInitToken = ({ name, symbol, decimals }) => {
        if (!requireWallet()) return;
        if (!POINTS_TOKEN_ID) {
            notifyError("Points token", "POINTS_TOKEN_ID is not configured in lib/stellar.js.");
            return;
        }
        run("init_token", `Initialize ${symbol || "token"}`, () => initPointsToken({
            admin: wallet.publicKey,
            name,
            symbol,
            decimals: Number(decimals) || 0,
        }), { refresh: { pointsConfig: true } });
    };

    const onSetTokenMinter = (minter) => {
        if (!requireWallet()) return;
        run("set_minter", "Authorize survey contract as minter", () => setPointsTokenMinter({
            admin: wallet.publicKey,
            minter,
        }), { refresh: { pointsConfig: true } });
    };

    const onSavePointsConfig = ({ token, creatorPoints, respondentPoints }) => {
        if (!requireWallet()) return;
        if (!isValidContractId(String(token))) {
            notifyError("Points config", "Token address is not a valid C… contract id.");
            return;
        }
        run("set_points_cfg", "Save points configuration", () => setSurveyPointsConfig({
            admin: wallet.publicKey,
            token,
            creatorPoints: BigInt(creatorPoints || 0),
            respondentPoints: BigInt(respondentPoints || 0),
        }), { refresh: { pointsConfig: true } });
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
            .filter((s) => {
                if (!s) return false;
                if (s.creator === wallet.publicKey) return true;
                const co = coAdminsById[s.id] || [];
                return co.includes(wallet.publicKey);
            });
    }, [wallet, sortedSurveyIds, surveysById, coAdminsById]);

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
                        <div className="brand-mark">SX</div>
                        <div className="brand-text">
                            <strong>Survex</strong>
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
                    {pointsMeta && (
                        <div className="side-stat">
                            <span className="side-stat-label">{pointsMeta.symbol || "PTS"} balance</span>
                            <span className="side-stat-value">
                                {wallet ? String(pointsBalance) : "—"}
                            </span>
                        </div>
                    )}
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
                            visibilityById={visibilityById}
                            viewersById={viewersById}
                            coAdminsById={coAdminsById}
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
                            pointsConfig={pointsConfig}
                            pointsMeta={pointsMeta}
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
                            coAdmins={coAdminsById[manageId]}
                            viewers={viewersById[manageId]}
                            isPrivate={visibilityById[manageId] || false}
                            onAddCoAdmin={onAddCoAdmin}
                            onRemoveCoAdmin={onRemoveCoAdmin}
                            onSetVisibility={onSetVisibility}
                            onAddViewers={onAddViewers}
                            onRemoveViewer={onRemoveViewer}
                            pointsConfig={pointsConfig}
                            pointsMeta={pointsMeta}
                            pointsBalance={pointsBalance}
                            contractAdmin={contractAdmin}
                            pointsTokenId={POINTS_TOKEN_ID}
                            onClaimSurveyAdmin={onClaimSurveyAdmin}
                            onInitToken={onInitToken}
                            onSetTokenMinter={onSetTokenMinter}
                            onSavePointsConfig={onSavePointsConfig}
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
