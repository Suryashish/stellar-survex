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
    Contract,
    Networks,
    rpc,
    TransactionBuilder,
    nativeToScVal,
    scValToNative,
    xdr,
} from "@stellar/stellar-sdk";

export const CONTRACT_ID = "CBLSLD5OJU6VB62ACD2AEPBDJOLXVO7A4QOA2XILQETKAEWPWVFVTWBP";
export const DEMO_ADDR = "GBKM52FA6XTDQL775MG5KWLAGU3MPHKGU2VRXWZR2FE773YBBULBFUZV";
export const NETWORK_NAME = "TESTNET";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

const server = new rpc.Server(RPC_URL);

const toSymbol = (value) => xdr.ScVal.scvSymbol(String(value));
const toU32 = (value) => nativeToScVal(Number(value || 0), { type: "u32" });
const toU64 = (value) => nativeToScVal(BigInt(value || 0), { type: "u64" });
const toAddress = (value) => new Address(value).toScVal();

const requireConfig = () => {
    if (!CONTRACT_ID) throw new Error("CONTRACT_ID is not configured");
    if (!DEMO_ADDR) throw new Error("DEMO_ADDR is not configured");
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
    try {
        const result = await requestAccess();
        const address = result?.address || result;
        if (!address || typeof address !== "string") {
            throw new Error("Freighter did not return an address");
        }
        return { publicKey: address };
    } catch (error) {
        if (error?.message) throw error;
        throw new Error("Wallet connection rejected");
    }
};

export const disconnectWallet = async () => {
    try {
        if (typeof setAllowed === "function") {
            await setAllowed(false).catch(() => null);
        }
    } catch {
        // freighter doesn't fully support programmatic disconnect; we just clear app state
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
    ]);
};

export const pauseSurvey = async ({ id, creator }) => {
    if (!id) throw new Error("Survey ID is required");
    if (!creator) throw new Error("Creator address is required");
    return invokeWrite("pause_survey", [toSymbol(id), toAddress(creator)]);
};

export const resumeSurvey = async ({ id, creator }) => {
    if (!id) throw new Error("Survey ID is required");
    if (!creator) throw new Error("Creator address is required");
    return invokeWrite("resume_survey", [toSymbol(id), toAddress(creator)]);
};

export const closeSurvey = async ({ id, creator }) => {
    if (!id) throw new Error("Survey ID is required");
    if (!creator) throw new Error("Creator address is required");
    return invokeWrite("close_survey", [toSymbol(id), toAddress(creator)]);
};

export const extendSurvey = async ({ id, creator, newEndTime }) => {
    if (!id) throw new Error("Survey ID is required");
    if (!creator) throw new Error("Creator address is required");
    return invokeWrite("extend_survey", [
        toSymbol(id),
        toAddress(creator),
        toU64(newEndTime),
    ]);
};

// --- Whitelist ---

export const enableWhitelist = async ({ id, creator }) => {
    if (!id) throw new Error("Survey ID is required");
    if (!creator) throw new Error("Creator address is required");
    return invokeWrite("enable_whitelist", [toSymbol(id), toAddress(creator)]);
};

export const addToWhitelist = async ({ id, creator, addresses }) => {
    if (!id) throw new Error("Survey ID is required");
    if (!creator) throw new Error("Creator address is required");
    if (!addresses?.length) throw new Error("At least one address is required");

    const list = xdr.ScVal.scvVec(addresses.map((addr) => toAddress(addr)));
    return invokeWrite("add_to_whitelist", [toSymbol(id), toAddress(creator), list]);
};

// --- Responses ---

export const submitResponse = async ({ surveyId, respondent, answers }) => {
    if (!surveyId) throw new Error("Survey ID is required");
    if (!respondent) throw new Error("Respondent address is required");

    return invokeWrite("submit_response", [
        toSymbol(surveyId),
        toAddress(respondent),
        nativeToScVal(answers || "", { type: "string" }),
    ]);
};

// --- Read queries ---

export const getSurvey = async (id) => {
    if (!id) throw new Error("Survey ID is required");
    return invokeRead("get_survey", [toSymbol(id)]);
};

export const listSurveys = async () => invokeRead("list_surveys", []);

export const getTotalCount = async () => invokeRead("get_total_count", []);

export const getResponseCount = async (surveyId) => {
    if (!surveyId) throw new Error("Survey ID is required");
    return invokeRead("get_response_count", [toSymbol(surveyId)]);
};

export const hasResponded = async (surveyId, respondent) => {
    if (!surveyId) throw new Error("Survey ID is required");
    if (!respondent) throw new Error("Respondent address is required");
    return invokeRead("has_responded", [toSymbol(surveyId), toAddress(respondent)]);
};

export const isAcceptingResponses = async (surveyId) => {
    if (!surveyId) throw new Error("Survey ID is required");
    return invokeRead("is_accepting_responses", [toSymbol(surveyId)]);
};
