export const NAV = [
    { key: "explore", num: "00", label: "Explore" },
    { key: "create", num: "01", label: "Create" },
    { key: "manage", num: "02", label: "Manage" },
    { key: "analytics", num: "03", label: "Analytics" },
];

export const nowTs = () => Math.floor(Date.now() / 1000);
export const weekFromNow = () => nowTs() + 7 * 86400;

export const truncate = (addr, head = 6, tail = 4) =>
    !addr || addr.length < head + tail + 3 ? addr || "" : `${addr.slice(0, head)}…${addr.slice(-tail)}`;

export const newTxId = () => `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
