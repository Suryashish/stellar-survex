export default function StatusPill({ status }) {
    const cls = (status || "").toLowerCase();
    return <span className={`status-pill pill-${cls}`}>{status}</span>;
}
