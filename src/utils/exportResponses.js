const escapeCell = (val) => {
    const s = val == null ? "" : String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
};

const isoOrEmpty = (unix) => {
    if (!unix) return "";
    const ms = Number(unix) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) return "";
    return new Date(ms).toISOString();
};

const safeFilename = (id) =>
    String(id || "survey").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);

export const buildResponsesCsv = (survey, responses) => {
    const questions = survey?.questions || [];
    const header = [
        "#",
        "Respondent",
        "Submitted At (ISO)",
        "Submitted At (Unix)",
        ...questions.map((q, i) => `Q${i + 1}: ${q}`),
    ];
    const rows = (responses || []).map((entry, idx) => [
        idx + 1,
        entry.respondent || "",
        isoOrEmpty(entry.submitted_at),
        entry.submitted_at || "",
        ...questions.map((_, qi) => entry.answers?.[qi] ?? ""),
    ]);
    return [header, ...rows]
        .map((row) => row.map(escapeCell).join(","))
        .join("\r\n");
};

export const downloadResponsesCsv = (survey, responses) => {
    if (!survey) return;
    const csv = buildResponsesCsv(survey, responses);
    // BOM so Excel detects UTF-8 correctly
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeFilename(survey.id)}_responses.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
