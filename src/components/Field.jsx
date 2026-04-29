export default function Field({ label, name, value, onChange, type = "text", hint, textarea, rows = 2, readOnly, placeholder, onBlur }) {
    return (
        <div className={`field ${readOnly ? "field-ro" : ""}`}>
            <label>{label}</label>
            {textarea ? (
                <textarea name={name} value={value} onChange={onChange} rows={rows} readOnly={readOnly} placeholder={placeholder} onBlur={onBlur} />
            ) : (
                <input name={name} value={value} onChange={onChange} type={type} readOnly={readOnly} placeholder={placeholder} onBlur={onBlur} />
            )}
            {hint && <span className="hint">{hint}</span>}
        </div>
    );
}
