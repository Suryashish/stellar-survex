export default function TxDrawer({ transactions, onDismiss, onClearAll }) {
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
