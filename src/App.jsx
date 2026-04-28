import React, { useState, useRef, useEffect } from "react";
import { checkConnection, createSurvey, submitResponse, closeSurvey, getSurvey, listSurveys, getResponseCount, hasResponded, getSurveyCount } from "../lib.js/stellar.js";

const nowTs = () => Math.floor(Date.now() / 1000);

const toOutput = (value) => {
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
};

const truncateAddress = (addr) => {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + "..." + addr.slice(-4);
};

export default function App() {
    const [form, setForm] = useState({
        id: "survey1",
        creator: "",
        title: "Developer Satisfaction Survey",
        description: "Rate your experience with Soroban",
        questionCount: "5",
        endTime: String(nowTs() + 86400),
        respondent: "",
        answers: "5,4,3,5,4",
    });
    const [output, setOutput] = useState("");
    const [walletState, setWalletState] = useState("Wallet: not connected");
    const [isBusy, setIsBusy] = useState(false);
    const [countValue, setCountValue] = useState("-");
    const [loadingAction, setLoadingAction] = useState(null);
    const [status, setStatus] = useState("idle");
    const [activeTab, setActiveTab] = useState(0);
    const [connectedAddress, setConnectedAddress] = useState("");
    const [confirmAction, setConfirmAction] = useState(null);
    const confirmTimer = useRef(null);

    useEffect(() => {
        return () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); };
    }, []);

    const setField = (event) => {
        const { name, value } = event.target;
        setForm((prev) => ({ ...prev, [name]: value }));
    };

    const runAction = async (actionName, action) => {
        setIsBusy(true);
        setLoadingAction(actionName);
        setStatus("idle");
        try {
            const result = await action();
            setOutput(toOutput(result ?? "No data found"));
            setStatus("success");
        } catch (error) {
            setOutput(error?.message || String(error));
            setStatus("error");
        } finally {
            setIsBusy(false);
            setLoadingAction(null);
        }
    };

    const handleConfirm = (actionName, action) => {
        if (confirmAction === actionName) {
            setConfirmAction(null);
            if (confirmTimer.current) clearTimeout(confirmTimer.current);
            action();
        } else {
            setConfirmAction(actionName);
            if (confirmTimer.current) clearTimeout(confirmTimer.current);
            confirmTimer.current = setTimeout(() => setConfirmAction(null), 3000);
        }
    };

    const onConnect = () => runAction("connect", async () => {
        const user = await checkConnection();
        const nextWalletState = user ? `Wallet: ${user.publicKey}` : "Wallet: not connected";
        setWalletState(nextWalletState);
        if (user) {
            setConnectedAddress(user.publicKey);
            setForm((prev) => ({
                ...prev,
                creator: prev.creator || user.publicKey,
                respondent: prev.respondent || user.publicKey,
            }));
        }
        return nextWalletState;
    });

    const onCreateSurvey = () => runAction("createSurvey", async () => createSurvey({
        id: form.id.trim(),
        creator: form.creator.trim(),
        title: form.title.trim(),
        description: form.description.trim(),
        questionCount: form.questionCount.trim(),
        endTime: form.endTime.trim(),
    }));

    const onSubmitResponse = () => runAction("submitResponse", async () => submitResponse({
        surveyId: form.id.trim(),
        respondent: form.respondent.trim(),
        answers: form.answers.trim(),
    }));

    const onCloseSurvey = () => handleConfirm("closeSurvey", () => runAction("closeSurvey", async () => closeSurvey({
        id: form.id.trim(),
        creator: form.creator.trim(),
    })));

    const onGetSurvey = () => runAction("getSurvey", async () => getSurvey(form.id.trim()));

    const onList = () => runAction("list", async () => listSurveys());

    const onResponseCount = () => runAction("responseCount", async () => {
        const value = await getResponseCount(form.id.trim());
        return { responseCount: value };
    });

    const onHasResponded = () => runAction("hasResponded", async () => {
        const value = await hasResponded(form.id.trim(), form.respondent.trim());
        return { hasResponded: value };
    });

    const onCount = () => runAction("count", async () => {
        const value = await getSurveyCount();
        setCountValue(String(value));
        return { count: value };
    });

    const tabs = ["Create Survey", "Respond", "Analytics"];

    return (
        <main className="app">
            {/* ---- Wallet Status Bar ---- */}
            <div className="wallet-status-bar">
                <span className={`wallet-dot ${connectedAddress ? "connected" : ""}`} />
                <span className="wallet-status-text">
                    {connectedAddress ? truncateAddress(connectedAddress) : "Not connected"}
                </span>
            </div>

            {/* ---- Hero ---- */}
            <section className="hero">
                <div className="hero-icon">&#9745;</div>
                <h1>Survey Builder</h1>
                <p className="subtitle">Create surveys, collect responses, and analyze results on-chain.</p>

                <div className="wallet-bar">
                    <button type="button" id="connectWallet" onClick={onConnect} className={loadingAction === "connect" ? "btn-loading" : ""} disabled={isBusy}>
                        Connect Freighter
                    </button>
                    <span className="wallet-text" id="walletState">{walletState}</span>
                </div>

                <p className="survey-count">
                    Total surveys: <span className="counter-badge">{countValue}</span>
                </p>
            </section>

            {/* ---- Tab Navigation ---- */}
            <div className="tab-bar">
                {tabs.map((tab, i) => (
                    <button
                        key={tab}
                        type="button"
                        className={`tab-btn ${activeTab === i ? "active" : ""}`}
                        onClick={() => setActiveTab(i)}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* ---- Tab 0: Create Survey ---- */}
            {activeTab === 0 && (
                <section className="card">
                    <div className="card-header">
                        <span className="card-icon">&#128203;</span>
                        <h2>Create Survey</h2>
                        <div className="question-counter">
                            Questions: <span className="counter-badge">{form.questionCount || "0"}</span>
                        </div>
                    </div>
                    <div className="card-body">
                        <div className="form-stack">
                            <div className="form-row">
                                <div className="field">
                                    <label htmlFor="id">Survey ID (Symbol)</label>
                                    <input id="id" name="id" value={form.id} onChange={setField} />
                                    <span className="field-helper">Unique survey identifier</span>
                                </div>
                                <div className="field">
                                    <label htmlFor="creator">Creator Address</label>
                                    <input id="creator" name="creator" value={form.creator} onChange={setField} placeholder="G..." />
                                    <span className="field-helper">Auto-filled on wallet connect</span>
                                </div>
                            </div>
                            <div className="field">
                                <label htmlFor="title">Survey Title</label>
                                <input id="title" name="title" value={form.title} onChange={setField} />
                            </div>
                            <div className="field">
                                <label htmlFor="description">Description</label>
                                <textarea id="description" name="description" rows="2" value={form.description} onChange={setField} />
                            </div>
                            <div className="form-row">
                                <div className="field">
                                    <label htmlFor="questionCount">Question Count</label>
                                    <input id="questionCount" name="questionCount" value={form.questionCount} onChange={setField} type="number" />
                                </div>
                                <div className="field">
                                    <label htmlFor="endTime">End Time (unix timestamp)</label>
                                    <input id="endTime" name="endTime" value={form.endTime} onChange={setField} type="number" />
                                    <span className="field-helper">Survey closes at this timestamp</span>
                                </div>
                            </div>
                        </div>

                        <div className="actions">
                            <button type="button" className={`btn ${loadingAction === "createSurvey" ? "btn-loading" : ""}`} onClick={onCreateSurvey} disabled={isBusy}>Create Survey</button>
                        </div>
                    </div>
                </section>
            )}

            {/* ---- Tab 1: Respond ---- */}
            {activeTab === 1 && (
                <section className="card">
                    <div className="card-header">
                        <span className="card-icon">&#128172;</span>
                        <h2>Submit Response</h2>
                    </div>
                    <div className="card-body">
                        <div className="form-stack">
                            <div className="field">
                                <label htmlFor="respondent">Respondent Address</label>
                                <input id="respondent" name="respondent" value={form.respondent} onChange={setField} placeholder="G..." />
                                <span className="field-helper">Your Stellar address (auto-filled on connect)</span>
                            </div>
                            <div className="field">
                                <label htmlFor="answers">Answers (delimited string)</label>
                                <textarea id="answers" name="answers" rows="2" value={form.answers} onChange={setField} />
                                <span className="field-helper">Comma-separated answer values, e.g. 5,4,3,5,4</span>
                            </div>
                        </div>

                        <div className="actions">
                            <button type="button" className={`btn ${loadingAction === "submitResponse" ? "btn-loading" : ""}`} onClick={onSubmitResponse} disabled={isBusy}>Submit Response</button>
                            <button
                                type="button"
                                className={`btn btn-danger ${loadingAction === "closeSurvey" ? "btn-loading" : ""}`}
                                onClick={onCloseSurvey}
                                disabled={isBusy}
                            >
                                {confirmAction === "closeSurvey" ? "Confirm Close?" : "Close Survey"}
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {/* ---- Tab 2: Analytics ---- */}
            {activeTab === 2 && (
                <>
                    <section className="card">
                        <div className="card-header">
                            <span className="card-icon">&#128202;</span>
                            <h2>Survey Analytics</h2>
                        </div>
                        <div className="card-body">
                            <div className="actions">
                                <button type="button" className={`btn btn-outline ${loadingAction === "responseCount" ? "btn-loading" : ""}`} onClick={onResponseCount} disabled={isBusy}>Response Count</button>
                                <button type="button" className={`btn btn-outline ${loadingAction === "hasResponded" ? "btn-loading" : ""}`} onClick={onHasResponded} disabled={isBusy}>Has Responded?</button>
                            </div>
                        </div>
                    </section>

                    <section className="card">
                        <div className="card-header">
                            <span className="card-icon">&#128209;</span>
                            <h2>Responses Log</h2>
                        </div>
                        <div className="card-body">
                            <div className="actions">
                                <button type="button" className={`btn btn-ghost ${loadingAction === "getSurvey" ? "btn-loading" : ""}`} onClick={onGetSurvey} disabled={isBusy}>Get Survey</button>
                                <button type="button" className={`btn btn-ghost ${loadingAction === "list" ? "btn-loading" : ""}`} onClick={onList} disabled={isBusy}>List Surveys</button>
                                <button type="button" className={`btn btn-ghost ${loadingAction === "count" ? "btn-loading" : ""}`} onClick={onCount} disabled={isBusy}>Get Survey Count</button>
                            </div>
                        </div>
                    </section>
                </>
            )}

            {/* ---- Output ---- */}
            <section className="card output-card">
                <div className="card-header">
                    <span className="card-icon">&#128196;</span>
                    <h2>Output</h2>
                </div>
                <div className="card-body">
                    <pre id="output" className={`output-pre status-${status}`}>
                        {output || "Connect your wallet and create or respond to surveys. Results will appear here."}
                    </pre>
                </div>
            </section>
        </main>
    );
}