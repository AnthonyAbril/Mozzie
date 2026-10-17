import type { Playlist } from "../utils/playlistStorage";
import { DEFAULT_COVER } from "../utils/defaultCover";

interface Props {
  playlists: Playlist[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateFromCurrent: () => void;
  onPlayTrack: (playlist: Playlist, trackIndex: number) => void;
  onDelete: (id: string) => void;
}

export function PlaylistGrid({
  playlists,
  selectedId,
  isLoading,
  onSelect,
  onCreateFromCurrent,
  onDelete,
}: {
  playlists: Playlist[];
  selectedId: string | null;
  isLoading: boolean;
  onSelect: (id: string) => void;
  onCreateFromCurrent: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={`playlist-grid-wrap ${isLoading ? "loading" : ""}`}>
      <div className="playlist-grid-header">
        <h2>Mis playlists</h2>
        <button
          className="create-playlist-btn"
          onClick={onCreateFromCurrent}
          disabled={isLoading}
        >
          + Nueva playlist
        </button>
      </div>

      {isLoading && (
        <div className="playlist-loading-overlay">
          <div className="spinner" />
          <span>Cargando playlist…</span>
        </div>
      )}

      {playlists.length === 0 ? (
        <div className="playlist-empty">
          No tienes playlists todavía. Carga pistas y pulsa "Nueva playlist".
        </div>
      ) : (
        <div className="playlist-grid">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              className={`playlist-card ${pl.id === selectedId ? "selected" : ""}`}
              onClick={() => onSelect(pl.id)}
            >
              <div
                className="playlist-cover"
                style={{ backgroundImage: `url(${pl.coverUrl ?? DEFAULT_COVER})` }}
              >
              </div>
              <div className="playlist-info">
                <div className="playlist-name">{pl.name}</div>
                <div className="playlist-count">
                  {pl.trackPaths.length} pistas
                </div>
              </div>
              <button
                className="playlist-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(pl.id);
                }}
                title="Eliminar playlist"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PlaylistDetail({
  playlist,
  onPlayTrack,
}: {
  playlist: Playlist | null;
  onPlayTrack: (playlist: Playlist, index: number) => void;
}) {
  if (!playlist) {
    return (
      <div className="playlist-detail-empty">
        Selecciona una playlist para ver sus detalles.
      </div>
    );
  }

  return (
    <div className="playlist-detail">
      <div
        className="playlist-detail-cover"
        style={
          playlist.coverUrl
            ? { backgroundImage: `url(${playlist.coverUrl})` }
            : undefined
        }
      >
        {!playlist.coverUrl && <span>♪</span>}
      </div>
      <h3 className="playlist-detail-name">{playlist.name}</h3>
      <div className="playlist-detail-count">
        {playlist.trackPaths.length} pistas
      </div>

      <div className="playlist-detail-tracks">
        {playlist.trackPaths.map((p, i) => {
          const name = p.split(/[\\/]/).pop() ?? p;
          return (
            <button
              key={`${p}-${i}`}
              className="playlist-track-item"
              onClick={() => onPlayTrack(playlist, i)}
              title={name}
            >
              {i + 1}. {name}
            </button>
          );
        })}
      </div>

      {playlist.description && (
        <div className="playlist-detail-description">
          <div className="section-title">Descripción</div>
          <p>{playlist.description}</p>
        </div>
      )}
    </div>
  );
}