import Field from "./Field.jsx";

export default function PaymentModal({ state, onChange, onClose, onSubmit, busy }) {
    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                    <h2>Send Payment</h2>
                    <button type="button" className="tx-close" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    <Field label="Recipient" value={state.recipient} readOnly />
                    {state.surveyId && <Field label="For Survey" value={state.surveyId} readOnly />}
                    <Field
                        label="Amount (XLM)"
                        type="number"
                        value={state.amount}
                        onChange={(e) => onChange({ amount: e.target.value })}
                        hint="Sent as a native XLM payment from your connected wallet."
                    />
                    <Field
                        label="Memo (optional)"
                        value={state.memo || ""}
                        onChange={(e) => onChange({ memo: e.target.value })}
                        hint="Max 28 characters."
                    />
                </div>
                <div className="modal-foot">
                    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="button" className={`btn btn-primary ${busy ? "is-loading" : ""}`} onClick={onSubmit} disabled={busy}>
                        Send {state.amount} XLM
                    </button>
                </div>
            </div>
        </div>
    );
}
