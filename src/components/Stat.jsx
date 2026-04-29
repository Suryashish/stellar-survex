export default function Stat({ label, value, small }) {
    return (
        <div className="meta-stat">
            <span className="meta-label">{label}</span>
            <span className={`meta-value ${small ? "small" : ""}`}>{value}</span>
        </div>
    );
}
