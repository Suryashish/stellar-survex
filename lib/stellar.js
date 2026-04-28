import {
    isAllowed,
    requestAccess,
    setAllowed,
    signTransaction,
    getNetwork,
} from "@stellar/freighter-api";
import {
    Account,
    Address,
    Asset,
    BASE_FEE,
    Contract,
    Horizon,
    Memo,
    Networks,
    Operation,
    rpc,
    TransactionBuilder,
    nativeToScVal,
    scValToNative,
    xdr,
} from "@stellar/stellar-sdk";

export const CONTRACT_ID = "CA2HUVSWZGJBXPL4IOW5NZVSQR7VW37ZAOAUYNTIOP5CA7KAHL6VLQ6N";
export const DEMO_ADDR = "GBKM52FA6XTDQL775MG5KWLAGU3MPHKGU2VRXWZR2FE773YBBULBFUZV";
export const NETWORK_NAME = "TESTNET";
export const STROOPS_PER_XLM = 10_000_000n;

const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

const server = new rpc.Server(RPC_URL);
const horizon = new Horizon.Server(HORIZON_URL);

const toSymbol = (value) => xdr.ScVal.scvSymbol(String(value));
const toU32 = (value) => nativeToScVal(Number(value || 0), { type: "u32" });
const toU64 = (value) => nativeToScVal(BigInt(value || 0), { type: "u64" });
const toI128 = (value) => nativeToScVal(BigInt(value || 0), { type: "i128" });
const toAddress = (value) => new Address(value).toScVal();

const requireConfig = () => {
    if (!CONTRACT_ID) throw new Error("CONTRACT_ID is not configured");
    if (!DEMO_ADDR) throw new Error("DEMO_ADDR is not configured");
};

export const xlmToStroops = (xlm) => {
    if (xlm == null || xlm === "") return 0n;
    const [intPart, fracPart = ""] = String(xlm).split(".");
    const padded = (fracPart + "0000000").slice(0, 7);
    return BigInt(intPart || "0") * STROOPS_PER_XLM + BigInt(padded || "0");
};

export const stroopsToXlm = (stroops) => {
    const value = typeof stroops === "bigint" ? stroops : BigInt(stroops || 0);
    if (value === 0n) return "0";
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const whole = abs / STROOPS_PER_XLM;
    const frac = abs % STROOPS_PER_XLM;
    const fracStr = frac === 0n ? "" : `.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
    return `${negative ? "-" : ""}${whole}${fracStr}`;
};

export const checkConnection = async () => {
    try {
        const allowed = await isAllowed();
        if (!allowed?.isAllowed && allowed !== true) return null;
        const result = await requestAccess();
        if (!result) return null;
        const address = result?.address || result;
        if (!address || typeof address !== "string") return null;
        return { publicKey: address };
    } catch {
        return null;
    }
};

export const connectWallet = async () => {
    const result = await requestAccess();
    const address = result?.address || result;
    if (!address || typeof address !== "string") {
        throw new Error("Freighter did not return an address");
    }
    return { publicKey: address };
};

export const disconnectWallet = async () => {
    try {
        if (typeof setAllowed === "function") {
            await setAllowed(false).catch(() => null);
        }
    } catch {
        /* ignore */
    }
    return true;
};

export const getActiveNetwork = async () => {
    try {
        const net = await getNetwork();
        return net?.network || net?.networkPassphrase || "Unknown";
    } catch {
        return "Unknown";
    }
};

const waitForTx = async (hash, attempts = 0) => {
    const tx = await server.getTransaction(hash);
    if (tx.status === "SUCCESS") return tx;
    if (tx.status === "FAILED") throw new Error("Transaction failed on-chain");
    if (attempts > 30) throw new Error("Timed out waiting for transaction confirmation");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return waitForTx(hash, attempts + 1);
};

const invokeWrite = async (method, args = []) => {
    requireConfig();

    const user = await checkConnection();
    if (!user) throw new Error("Freighter wallet is not connected");

    const account = await server.getAccount(user.publicKey);
    let tx = new TransactionBuilder(account, {
        fee: "10000",
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(new Contract(CONTRACT_ID).call(method, ...args))
        .setTimeout(30)
        .build();

    tx = await server.prepareTransaction(tx);

    const signed = await signTransaction(tx.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE });
    if (!signed || signed.error) {
        throw new Error(signed?.error?.message || signed?.error || "Transaction signing rejected");
    }

    const signedTxXdr = typeof signed === "string" ? signed : signed.signedTxXdr;
    const sent = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE),
    );

    if (sent.status === "ERROR") {
        throw new Error(sent.errorResultXdr || "Transaction rejected by network");
    }

    const result = await waitForTx(sent.hash);
    return { hash: sent.hash, status: result.status };
};

const invokeRead = async (method, args = []) => {
    requireConfig();

    const tx = new TransactionBuilder(new Account(DEMO_ADDR, "0"), {
        fee: "100",
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(new Contract(CONTRACT_ID).call(method, ...args))
        .setTimeout(0)
        .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim)) {
        if (!sim.result) return null;
        return scValToNative(sim.result.retval);
    }

    throw new Error(sim.error || `Read simulation failed: ${method}`);
};

// --- Survey lifecycle ---

export const createSurvey = async (payload) => {
    if (!payload?.id) throw new Error("Survey ID is required");
    if (!payload?.creator) throw new Error("Creator address is required");
    if (!payload?.title) throw new Error("Title is required");

    return invokeWrite("create_survey", [
        toSymbol(payload.id),
        toAddress(payload.creator),
        nativeToScVal(payload.title, { type: "string" }),
        nativeToScVal(payload.description || "", { type: "string" }),
        toU32(payload.questionCount),
        toU64(payload.endTime),
        toU32(payload.maxResponses),
        toI128(payload.rewardStroops || 0),
    ]);
};

export const pauseSurvey = ({ id, creator }) =>
    invokeWrite("pause_survey", [toSymbol(id), toAddress(creator)]);

export const resumeSurvey = ({ id, creator }) =>
    invokeWrite("resume_survey", [toSymbol(id), toAddress(creator)]);

export const closeSurvey = ({ id, creator }) =>
    invokeWrite("close_survey", [toSymbol(id), toAddress(creator)]);

export const extendSurvey = ({ id, creator, newEndTime }) =>
    invokeWrite("extend_survey", [toSymbol(id), toAddress(creator), toU64(newEndTime)]);

export const updateReward = ({ id, creator, rewardStroops }) =>
    invokeWrite("update_reward", [toSymbol(id), toAddress(creator), toI128(rewardStroops)]);

// --- Whitelist ---

export const enableWhitelist = ({ id, creator }) =>
    invokeWrite("enable_whitelist", [toSymbol(id), toAddress(creator)]);

export const addToWhitelist = ({ id, creator, addresses }) => {
    if (!addresses?.length) throw new Error("At least one address is required");
    const list = xdr.ScVal.scvVec(addresses.map((addr) => toAddress(addr)));
    return invokeWrite("add_to_whitelist", [toSymbol(id), toAddress(creator), list]);
};

// --- Responses ---

export const submitResponse = ({ surveyId, respondent, answers }) =>
    invokeWrite("submit_response", [
        toSymbol(surveyId),
        toAddress(respondent),
        nativeToScVal(answers || "", { type: "string" }),
    ]);

// --- Read queries ---

export const getSurvey = (id) => invokeRead("get_survey", [toSymbol(id)]);
export const listSurveys = () => invokeRead("list_surveys", []);
export const getTotalCount = () => invokeRead("get_total_count", []);
export const getResponseCount = (surveyId) => invokeRead("get_response_count", [toSymbol(surveyId)]);
export const hasResponded = (surveyId, respondent) =>
    invokeRead("has_responded", [toSymbol(surveyId), toAddress(respondent)]);
export const isAcceptingResponses = (surveyId) =>
    invokeRead("is_accepting_responses", [toSymbol(surveyId)]);
export const getParticipants = (surveyId) =>
    invokeRead("get_participants", [toSymbol(surveyId)]);

// --- Direct payment (off-contract XLM transfer) ---

export const sendPayment = async ({ from, to, amount, memo }) => {
    if (!from) throw new Error("Sender address is required");
    if (!to) throw new Error("Recipient address is required");
    const amountStr = String(amount || "").trim();
    if (!amountStr || Number(amountStr) <= 0) throw new Error("Amount must be greater than 0");

    const account = await horizon.loadAccount(from);
    const builder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(Operation.payment({
            destination: to,
            asset: Asset.native(),
            amount: amountStr,
        }))
        .setTimeout(60);

    if (memo) builder.addMemo(Memo.text(String(memo).slice(0, 28)));
    const tx = builder.build();

    const signed = await signTransaction(tx.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE });
    if (!signed || signed.error) {
        throw new Error(signed?.error?.message || signed?.error || "Payment signing rejected");
    }
    const signedXdr = typeof signed === "string" ? signed : signed.signedTxXdr;
    const result = await horizon.submitTransaction(
        TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE),
    );
    return { hash: result.hash, status: "SUCCESS", amount: amountStr, to };
};
