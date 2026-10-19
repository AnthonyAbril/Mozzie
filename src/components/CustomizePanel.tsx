import { useEffect } from "react";
import type { StoredGlobalTheme } from "../utils/themeStorage";

interface Props {
  open: boolean;
  theme: StoredGlobalTheme;
  onChange: (patch: Partial<StoredGlobalTheme>) => void;
  onClose: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function CustomizePanel({ open, theme, onChange, onClose, isFullscreen, onToggleFullscreen }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-tall" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Personalización</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="modal-body customize-body">
          
          {/* ── SECCIÓN 1: COLORES MANUALES ── */}
          <div className="customize-section">
            <div className="customize-section-title">Apariencia General</div>
            <p className="customize-section-desc">Estos colores se usan cuando el Tema del Disco está apagado.</p>
            
            <div className="customize-box">
              <div className="color-row">
                <span className="color-label">Color de Acento</span>
                <div className="color-input-wrapper">
                  <input type="color" value={theme.primary} onChange={(e) => onChange({ primary: e.target.value })} />
                  <span className="color-code">{theme.primary.toUpperCase()}</span>
                </div>
              </div>
              <div className="color-row">
                <span className="color-label">Fondo de la App</span>
                <div className="color-input-wrapper">
                  <input type="color" value={theme.themeColor1} onChange={(e) => onChange({ themeColor1: e.target.value })} />
                  <span className="color-code">{theme.themeColor1.toUpperCase()}</span>
                </div>
              </div>
              <div className="color-row">
                <span className="color-label">Color de Paneles</span>
                <div className="color-input-wrapper">
                  <input type="color" value={theme.themeColor2} onChange={(e) => onChange({ themeColor2: e.target.value })} />
                  <span className="color-code">{theme.themeColor2.toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── SECCIÓN 2: TEMA DEL DISCO ── */}
          <div className="customize-section">
            <div className="customize-section-title">Tema del Disco</div>
            
            <div className="customize-box">
              <label className="toggle-row main-toggle">
                <input type="checkbox" checked={theme.discThemeMode} onChange={(e) => onChange({ discThemeMode: e.target.checked })} />
                <div>
                  <span className="toggle-label">Extraer colores del disco</span>
                  <span className="toggle-sublabel">Usa la portada o los colores personalizados de cada disco.</span>
                </div>
              </label>

              {theme.discThemeMode && (
                <div className="customize-sub-panel">
                  <div className="customize-row">
                    <span className="color-label">Color de Acento</span>
                    <select className="custom-select" value={theme.primarySource} onChange={e => onChange({ primarySource: e.target.value as any })}>
                      <option value="auto1">Del Disco 1</option>
                      <option value="auto2">Del Disco 2</option>
                      <option value="auto3">Del Disco 3</option>
                      <option value="color1">Fondo Manual</option>
                      <option value="color2">Paneles Manuales</option>
                    </select>
                  </div>
                  
                  <div className="customize-row">
                    <span className="color-label">Fondo del 3D</span>
                    <select className="custom-select" value={theme.bgSource} onChange={e => onChange({ bgSource: e.target.value as any })}>
                      <option value="auto1">Del Disco 1</option>
                      <option value="auto2">Del Disco 2</option>
                      <option value="auto3">Del Disco 3</option>
                      <option value="color1">Fondo Manual</option>
                      <option value="color2">Paneles Manuales</option>
                    </select>
                  </div>

                  <label className="toggle-row" style={{ marginTop: 12 }}>
                    <input type="checkbox" checked={theme.grayscalePalette} onChange={(e) => onChange({ grayscalePalette: e.target.checked })} />
                    <span>Extraer en escala de grises (tonos)</span>
                  </label>
                  <p className="modal-hint">
                    Los colores "Del Disco 1, 2 y 3" serán del mismo tono, pero con distinta luminosidad.
                  </p>

                  {theme.grayscalePalette && (
                    <div className="customize-sub-panel" style={{ marginTop: 12 }}>
                      <div className="slider-row">
                        <div className="slider-label">
                          <span>Brillo Color 1</span>
                          <span className="value">{Math.round(theme.grayscaleDarkness[0] * 100)}%</span>
                        </div>
                        <input type="range" min="0.02" max="0.5" step="0.01" value={theme.grayscaleDarkness[0]} onChange={(e) => {
                          const newArr = [...theme.grayscaleDarkness] as [number, number, number];
                          newArr[0] = Number(e.target.value);
                          onChange({ grayscaleDarkness: newArr });
                        }} />
                      </div>
                      <div className="slider-row">
                        <div className="slider-label">
                          <span>Brillo Color 2</span>
                          <span className="value">{Math.round(theme.grayscaleDarkness[1] * 100)}%</span>
                        </div>
                        <input type="range" min="0.1" max="0.7" step="0.01" value={theme.grayscaleDarkness[1]} onChange={(e) => {
                          const newArr = [...theme.grayscaleDarkness] as [number, number, number];
                          newArr[1] = Number(e.target.value);
                          onChange({ grayscaleDarkness: newArr });
                        }} />
                      </div>
                      <div className="slider-row">
                        <div className="slider-label">
                          <span>Brillo Color 3</span>
                          <span className="value">{Math.round(theme.grayscaleDarkness[2] * 100)}%</span>
                        </div>
                        <input type="range" min="0.2" max="0.9" step="0.01" value={theme.grayscaleDarkness[2]} onChange={(e) => {
                          const newArr = [...theme.grayscaleDarkness] as [number, number, number];
                          newArr[2] = Number(e.target.value);
                          onChange({ grayscaleDarkness: newArr });
                        }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── SECCIÓN 3: EFECTOS 3D Y GRADIENTE ── */}
          <div className="customize-section">
            <div className="customize-section-title">Efectos del Reproductor</div>
            
            <div className="customize-box">
              <label className="toggle-row">
                <input type="checkbox" checked={theme.bgGradient} onChange={e => onChange({ bgGradient: e.target.checked })} />
                <span>Usar gradiente en el fondo 3D</span>
              </label>

              {theme.bgGradient && (
                <div className="customize-sub-panel">
                  <div className="customize-row">
                    <span className="color-label">Color Secundario</span>
                    <select className="custom-select" value={theme.gradientColorSource} onChange={e => onChange({ gradientColorSource: e.target.value as any })}>
                      <option value="auto1">Del Disco 1</option>
                      <option value="auto2">Del Disco 2</option>
                      <option value="auto3">Del Disco 3</option>
                      <option value="color1">Fondo Manual</option>
                      <option value="color2">Paneles Manuales</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </div>
                  {theme.gradientColorSource === 'custom' && (
                    <div className="color-row" style={{ marginTop: 8, marginBottom: 0 }}>
                      <span className="color-label">Color exacto</span>
                      <input type="color" value={theme.gradientColor2} onChange={(e) => onChange({ gradientColor2: e.target.value })} />
                    </div>
                  )}
                </div>
              )}

              <div className="divider" />

              <label className="toggle-row">
                <input type="checkbox" checked={theme.reactiveLights} onChange={e => onChange({ reactiveLights: e.target.checked })} />
                <span>Luces reactivas al volumen</span>
              </label>

              <label className="toggle-row" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={theme.singlePlayback} onChange={(e) => onChange({ singlePlayback: e.target.checked })} />
                <span>Reproducir solo una canción a la vez</span>
              </label>
            </div>
          </div>

          {/* ── SECCIÓN 4: SISTEMA Y AVANZADO ── */}
          <div className="customize-section">
            <div className="customize-section-title">Sistema y Avanzado</div>
            
            <div className="customize-box">
              
              <div className="slider-row">
                <div className="slider-label">
                  <span>Suavizado de luces</span>
                  <span className="value">{Math.round((1 - theme.lightSmoothing) * 100)}%</span>
                </div>
                <input type="range" min="0.01" max="0.2" step="0.01" value={theme.lightSmoothing} onChange={(e) => onChange({ lightSmoothing: Number(e.target.value) })} />
              </div>

              <div className="slider-row">
                <div className="slider-label">
                  <span>Intensidad de la paleta</span>
                  <span className="value">{theme.satBoost.toFixed(2)}×</span>
                </div>
                <input type="range" min="0.5" max="1.8" step="0.05" value={theme.satBoost} onChange={(e) => onChange({ satBoost: Number(e.target.value) })} />
              </div>

              <div className="slider-row">
                <div className="slider-label">
                  <span>Brillo del tema</span>
                  <span className="value">{Math.round(theme.brightness * 100)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.05" value={theme.brightness} onChange={(e) => onChange({ brightness: Number(e.target.value) })} />
              </div>

              <div className="customize-row" style={{ marginTop: 16 }}>
                <span className="color-label">Sentido de giro</span>
                <div className="theme-mode-toggle mini">
                  <button className={theme.vinylSpinDirection === 1 ? 'active' : ''} onClick={() => onChange({ vinylSpinDirection: 1 })}>↻ Horario</button>
                  <button className={theme.vinylSpinDirection === -1 ? 'active' : ''} onClick={() => onChange({ vinylSpinDirection: -1 })}>↺ Antihorario</button>
                </div>
              </div>

              <div className="divider" />

              <label className="toggle-row">
                <input type="checkbox" checked={theme.blockSleep} onChange={(e) => onChange({ blockSleep: e.target.checked })} />
                <span>Evitar que la pantalla se apague al reproducir</span>
              </label>

              {/* ✅ NUEVO SWITCH DE PANTALLA COMPLETA */}
              <label className="toggle-row" style={{ marginTop: 12 }}>
                <input 
                  type="checkbox" 
                  checked={isFullscreen} 
                  onChange={onToggleFullscreen} 
                />
                <span>Pantalla completa</span>
              </label>
              <p className="modal-hint">
                También puedes usar la tecla F11 para alternar.
              </p>

            </div>
          </div>

        </div>
      </div>
    </div>
  );
}