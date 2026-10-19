import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

export function DeleteConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: Props) {
  const [dontAsk, setDontAsk] = useState(false);

  // Resetear el check cada vez que se abre
  useEffect(() => {
    if (open) setDontAsk(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm(dontAsk);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm, dontAsk]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onCancel} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>

          <label className="toggle-row" style={{ marginTop: 14 }}>
            <input
              type="checkbox"
              checked={dontAsk}
              onChange={(e) => setDontAsk(e.target.checked)}
            />
            <span>No volver a preguntar en esta sesión</span>
          </label>

          <div className="playlist-modal-actions">
            <button className="modal-btn-secondary" onClick={onCancel}>
              Cancelar
            </button>
            <button
              className="modal-btn-danger"
              onClick={() => onConfirm(dontAsk)}
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}