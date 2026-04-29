import { localInputToUnix, formatUnix, formatRelative } from "../../lib/stellar.js";
import Section from "../components/Section.jsx";
import Field from "../components/Field.jsx";

export default function CreatePage({ form, wallet, onTitleBlur, onChange, onSetQuestion, onAddQuestion, onRemoveQuestion, onSubmit, busyKey, disabled }) {
    const endUnix = localInputToUnix(form.endTimeLocal);
    const rewardNum = Number(form.rewardXlm || "0");
    const maxNum = Number(form.maxResponses || "0");
    const totalEscrow = rewardNum > 0 ? rewardNum * maxNum : 0;
    const escrowError = rewardNum > 0 && maxNum <= 0;

    return (
        <Section title="Create a Survey" tag="create_survey">
            <div className="grid-2">
                <Field label="Title" name="title" value={form.title} onChange={onChange} onBlur={onTitleBlur} placeholder="What do you want to ask?" />
                <Field label="Survey ID" name="id" value={form.id} onChange={onChange} hint="Unique on-chain identifier (auto-generated from title — letters, numbers, underscore, max 32)." />
            </div>
            <Field label="Description" name="description" textarea rows={2} value={form.description} onChange={onChange} placeholder="Optional context for respondents." />

            <div className="builder">
                <div className="builder-head">
                    <label>Questions</label>
                    <span className="hint">{form.questions.length} question{form.questions.length === 1 ? "" : "s"}</span>
                </div>
                {form.questions.map((q, i) => (
                    <div className="question-row" key={i}>
                        <span className="q-num">Q{i + 1}</span>
                        <input
                            value={q}
                            onChange={(e) => onSetQuestion(i, e.target.value)}
                            placeholder={`Question ${i + 1}`}
                        />
                        <button
                            type="button"
                            className="icon-btn-danger"
                            onClick={() => onRemoveQuestion(i)}
                            disabled={form.questions.length <= 1}
                            title="Remove question"
                        >
                            ×
                        </button>
                    </div>
                ))}
                <button type="button" className="btn btn-outline btn-sm builder-add" onClick={onAddQuestion}>
                    + Add Question
                </button>
            </div>

            <div className="grid-2">
                <Field label="Closes At" name="endTimeLocal" type="datetime-local" value={form.endTimeLocal} onChange={onChange} hint={endUnix ? `${formatUnix(endUnix)} · ${formatRelative(endUnix)}` : "Pick a future date and time"} />
                <Field label="Max Responses" name="maxResponses" type="number" value={form.maxResponses} onChange={onChange} hint={rewardNum > 0 ? "Required when reward > 0 (sets escrow size)" : "0 = unlimited"} />
                <Field label="Reward per Response (XLM)" name="rewardXlm" value={form.rewardXlm} onChange={onChange} hint="Paid out automatically on each response from the escrow." />
                <Field label="Creator" value={wallet ? wallet.publicKey : "Connect wallet to auto-fill"} readOnly />
            </div>

            <div className={`escrow-card ${escrowError ? "escrow-bad" : totalEscrow > 0 ? "escrow-on" : "escrow-off"}`}>
                <div className="escrow-line">
                    <span className="escrow-label">Total to escrow on publish</span>
                    <span className="escrow-value">
                        {escrowError ? "—" : `${totalEscrow.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM`}
                    </span>
                </div>
                <span className="hint">
                    {escrowError
                        ? "Set Max Responses > 0 — the contract needs a known cap so it can hold the right amount of XLM."
                        : totalEscrow > 0
                            ? `${rewardNum} XLM × ${maxNum} responses. The contract holds this in escrow and pays each respondent automatically on submit.`
                            : "No reward configured. Respondents won't receive any XLM."}
                </span>
            </div>

            <div className="row">
                <button
                    type="button"
                    className={`btn btn-primary ${busyKey === "create" ? "is-loading" : ""}`}
                    onClick={onSubmit}
                    disabled={disabled || escrowError}
                >
                    {totalEscrow > 0 ? `Publish & Escrow ${totalEscrow.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM` : "Publish Survey"}
                </button>
            </div>
        </Section>
    );
}
