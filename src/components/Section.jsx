export default function Section({ title, tag, children }) {
    return (
        <section className="card panel">
            <div className="panel-head">
                <h2>{title}</h2>
                {tag && <span className="panel-tag">{tag}</span>}
            </div>
            {children}
        </section>
    );
}
