import { useEffect, useRef, useState } from "react";

export interface CandidateGroup {
  label: string;
  tracks: { path: string; name: string }[];
}

interface Props {
  open: boolean;
  defaultName: string;
  defaultDescription: string;
  candidateGroups: CandidateGroup[];
  initialSelectedPaths: string[];
  onCancel: () => void;
  onConfirm: (name: string, description: string, selectedPaths: string[]) => void;
}

export function PlaylistModal({
  open, defaultName, defaultDescription, candidateGroups, initialSelectedPaths, onCancel, onConfirm,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName(defaultName);
      setDescription(defaultDescription);
      setSelected(new Set(initialSelectedPaths));
    }
    wasOpenRef.current = open;
  }, [open, defaultName, defaultDescription, initialSelectedPaths]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleGroup = (group: CandidateGroup) => {
    const allSelected = group.tracks.every((t) => selected.has(t.path));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of group.tracks) {
        if (allSelected) next.delete(t.path);
        else next.add(t.path);
      }
      return next;
    });
  };

  const submit = () => {
    if (!name.trim() || selected.size === 0) return;
    onConfirm(name.trim(), description.trim(), Array.from(selected));
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nueva playlist</h2>
          <button className="modal-close" onClick={onCancel} aria-label="Cerrar">✕</button>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <div className="modal-section-title">Nombre</div>
            <input type="text" className="playlist-modal-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Mi playlist favorita" />
          </div>

          <div className="modal-section">
            <div className="modal-section-title">Descripción (opcional)</div>
            <textarea className="playlist-modal-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para escuchar en el coche…" rows={3} />
          </div>

          <div className="modal-section">
            <div className="modal-section-title">Canciones seleccionadas ({selected.size})</div>
            {candidateGroups.length === 0 ? (
              <div className="modal-hint">No hay canciones disponibles.</div>
            ) : (
              <div className="track-picker">
                {candidateGroups.map((group, gi) => {
                  const allSelected = group.tracks.every((t) => selected.has(t.path));
                  const someSelected = !allSelected && group.tracks.some((t) => selected.has(t.path));
                  return (
                    <div key={gi} className="track-picker-group">
                      <div className="track-picker-header">
                        <button className="track-picker-toggle" onClick={() => toggleGroup(group)}>
                          {allSelected ? "☑" : someSelected ? "▣" : "☐"} {group.label} ({group.tracks.length})
                        </button>
                      </div>
                      <div className="track-picker-list">
                        {group.tracks.map((t) => (
                          <label key={t.path} className="track-picker-item">
                            <input type="checkbox" checked={selected.has(t.path)} onChange={() => toggle(t.path)} />
                            <span title={t.path}>{t.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="playlist-modal-actions">
            <button className="modal-btn-secondary" onClick={onCancel}>Cancelar</button>
            <button className="modal-btn-primary" onClick={submit} disabled={!name.trim() || selected.size === 0}>
              Crear ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}