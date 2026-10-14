import { useEffect } from "react";
import type { StoredGlobalTheme } from "../utils/themeStorage";

interface Props {
  open: boolean;
  theme: StoredGlobalTheme;
  onChange: (patch: Partial<StoredGlobalTheme>) => void;
  onClose: () => void;
}

export function CustomizePanel({ open, theme, onChange, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Personalización</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <div className="modal-section-title">Color principal</div>
            <div className="color-row">
              <input
                type="color"
                value={theme.primary}
                onChange={(e) => onChange({ primary: e.target.value })}
              />
              <span className="color-code">{theme.primary.toUpperCase()}</span>
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">Colores del tema</div>
            <div className="color-row">
              <span className="color-label">Fondo principal</span>
              <input
                type="color"
                value={theme.themeColor1}
                onChange={(e) => onChange({ themeColor1: e.target.value })}
              />
              <span className="color-code">
                {theme.themeColor1.toUpperCase()}
              </span>
            </div>
            <div className="color-row">
              <span className="color-label">Paneles</span>
              <input
                type="color"
                value={theme.themeColor2}
                onChange={(e) => onChange({ themeColor2: e.target.value })}
              />
              <span className="color-code">
                {theme.themeColor2.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">Tema del disco</div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={theme.discThemeMode}
                onChange={(e) => onChange({ discThemeMode: e.target.checked })}
              />
              <span>
                El tema cambia según la portada del disco seleccionado
              </span>
            </label>
            <p className="modal-hint">
              Los colores se extraen automáticamente de la carátula. Puedes
              elegir entre esos y unos personalizados por disco en el panel
              lateral derecho.
            </p>
          </div>
          <div className="modal-section">
            <div className="modal-section-title">Reproducción</div>
            <label className="toggle-row">
                <input
                type="checkbox"
                checked={theme.singlePlayback}
                onChange={(e) =>
                    onChange({ singlePlayback: e.target.checked })
                }
                />
                <span>Solo una canción a la vez</span>
            </label>
            <p className="modal-hint">
                Al activarlo, cambiar de pista (por clic en el sidebar, swipe o al
                cargar una nueva) detendrá la anterior y sólo sonará la seleccionada.
            </p>
            </div>
          <div className="modal-section">
            <div className="modal-section-title">Intensidad del color</div>

            <div className="slider-row">
              <div className="slider-label">
                <span>Paleta de la portada</span>
                <span className="value">{theme.satBoost.toFixed(2)}×</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.8"
                step="0.05"
                value={theme.satBoost}
                onChange={(e) => onChange({ satBoost: Number(e.target.value) })}
              />
            </div>

            <p className="modal-hint">
              Controla cómo de vivos son los colores extraídos de la portada.
              Con 1.00 los colores se muestran tal cual; por encima se saturan
              más, por debajo se apagan.
            </p>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">Brillo del tema extraído</div>

            <div className="slider-row">
                <div className="slider-label">
                <span>Brillo</span>
                <span className="value">{Math.round(theme.brightness * 100)}%</span>
                </div>
                <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={theme.brightness}
                onChange={(e) =>
                    onChange({ brightness: Number(e.target.value) })
                }
                />
            </div>

            <p className="modal-hint">
                Aclara el fondo y los paneles cuando el tema del disco está activo.
                Con 0% el tema es oscuro; al 100% el fondo se nota bastante más claro.
                No afecta a los colores personalizados (esos los eliges tú).
            </p>
            </div>
        </div>
      </div>
    </div>
  );
}
