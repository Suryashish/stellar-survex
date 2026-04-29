import { unixToLocalInput } from "../../lib/stellar.js";
import { weekFromNow } from "./constants.js";

export const statusLabel = (status) => {
    if (status == null) return "Unknown";
    if (typeof status === "string") return status;
    if (typeof status === "object" && "tag" in status) return status.tag;
    return String(status);
};

export const normalizeSurvey = (raw) => {
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

export const decodeAnswers = (str) => {
    if (!str) return [];
    try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return parsed.map((v) => String(v));
        return [String(str)];
    } catch {
        return [String(str)];
    }
};

export const slugifyId = (text) => {
    const base = String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32);
    return base || `s_${Math.random().toString(36).slice(2, 8)}`;
};

export const emptyCreateForm = () => ({
    id: `survey_${Math.random().toString(36).slice(2, 6)}`,
    title: "",
    description: "",
    questions: ["", ""],
    endTimeLocal: unixToLocalInput(weekFromNow()),
    maxResponses: "0",
    rewardXlm: "0",
    visibility: "public",
    initialViewers: "",
});

export const isValidStellarAddress = (addr) =>
    typeof addr === "string" && /^G[A-Z2-7]{55}$/.test(addr.trim());

export const parseAddressList = (raw) =>
    String(raw || "")
        .split(/[\s,]+/)
        .map((v) => v.trim())
        .filter(Boolean);
