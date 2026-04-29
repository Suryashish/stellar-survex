export default function ManageBtn({ id, label, variant = "primary", onClick, confirmKey, confirmLabel, busyAction, disabled }) {
    const isActive = confirmKey === id;
    const isLoading = busyAction === id;
    return (
        <button
            type="button"
            className={`btn btn-${variant} ${isLoading ? "is-loading" : ""}`}
            onClick={onClick}
            disabled={disabled}
        >
            {isActive ? confirmLabel || "Confirm?" : label}
        </button>
    );
}
