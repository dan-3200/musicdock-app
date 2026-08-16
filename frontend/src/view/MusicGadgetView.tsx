import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft, Clock3, Download, Heart, Library, ListMusic, ListPlus, Loader2,
  Minus, Moon, Music2, Pause, Pencil, Play, Plus, RefreshCw, Repeat, Repeat1,
  Search, Settings, Shuffle, SkipBack, SkipForward, Sparkles, Sun, Trash2,
  Volume2, VolumeX, X,
} from "lucide-react";

import { NativeCommands } from "../infra/commands.native";
import { SongController } from "../infra/song.controller";
import { useLibrary } from "../logic/useLibrary";
import { usePlaybackHistory, usePlayer, useSearch, useSearchSuggestions, type VideoResult } from "../logic/usePlayer";
import { useRecommendations } from "../logic/useRecommendations";
import { PlaylistPicker } from "./PlaylistPicker";

type View = "now" | "search" | "library" | "queue" | "settings";
type ThemeMode = "light" | "dark";
type LibrarySection = "liked" | "playlists" | "history";
type DiscoverSection = "recommended" | "search";

const formatTime = SongController.formatTime;
const viewMotion = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.16 } };

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(timestamp);
}

function IconButton({ label, children, active = false, onClick, disabled = false }: {
  label: string; children: ReactNode; active?: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={`dock-icon-button ${active ? "dock-icon-button--active" : ""}`}>
      {children}
    </button>
  );
}

function SongArtwork({ song, playing, size = "large" }: { song: VideoResult | null; playing: boolean; size?: "large" | "small" }) {
  return (
    <div className={`artwork artwork--${size} ${playing ? "artwork--playing" : ""}`}>
      {song?.thumbnail ? <img src={song.thumbnail} alt={`Capa de ${song.title}`} /> : <Music2 aria-hidden="true" />}
      <span className="artwork__glow" aria-hidden="true" />
    </div>
  );
}

function SaveActions({ song, liked, onToggleLike, onAddToPlaylist }: {
  song: VideoResult;
  liked: boolean;
  onToggleLike: (song: VideoResult) => void;
  onAddToPlaylist: (song: VideoResult) => void;
}) {
  return (
    <div className="song-row__actions">
      <IconButton label={liked ? "Remover das músicas curtidas" : "Curtir música"} active={liked} onClick={() => onToggleLike(song)}>
        <Heart fill={liked ? "currentColor" : "none"} />
      </IconButton>
      <IconButton label="Adicionar à playlist" onClick={() => onAddToPlaylist(song)}><ListPlus /></IconButton>
    </div>
  );
}

export function MusicGadgetView() {
  const {
    queue, currentIndex, activeItem, hasNext, hasPrev, enqueue, enqueueAndPlay, dequeue,
    playAt, playNext, playPrev, volume, setVolume, currentTime, duration, isLoading,
    isDownloading, isPlaying, isPaused, error, play, pause, seek, download, autoplay, shuffle,
    loop, toggleAutoplay, toggleShuffle, cycleLoop,
  } = usePlayer();
  const { results, search } = useSearch();
  const { history, record: recordHistory, clear: clearHistory } = usePlaybackHistory();
  const {
    likedSongs, playlists, isLiked, toggleLike, clearLikedSongs, createPlaylist,
    renamePlaylist, deletePlaylist, addSongToPlaylist, removeSongFromPlaylist,
    isSongInPlaylist,
  } = useLibrary();
  const {
    recommendations, isLoading: recommendationsLoading, error: recommendationsError,
    hasSignals: hasRecommendationSignals, refresh: refreshRecommendations,
  } = useRecommendations({ likedSongs, history });
  const [view, setView] = useState<View>("now");
  const [librarySection, setLibrarySection] = useState<LibrarySection>("liked");
  const [discoverSection, setDiscoverSection] = useState<DiscoverSection>("recommended");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playlistTarget, setPlaylistTarget] = useState<VideoResult | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [theme, setTheme] = useState<ThemeMode>(() => window.localStorage.getItem("musicdock.theme") === "dark" ? "dark" : "light");
  const [trayIconEnabled, setTrayIconEnabled] = useState(true);
  const [trayRestartRequired, setTrayRestartRequired] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useSearchSuggestions(query);
  const queueIds = useMemo(() => new Set(queue.map((song) => song.id)), [queue]);
  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [playlists, selectedPlaylistId],
  );
  const lastVolume = useRef(volume || 25);

  useEffect(() => { if (volume > 0) lastVolume.current = volume; }, [volume]);
  useEffect(() => { if (activeItem) recordHistory(activeItem); }, [activeItem?.id, recordHistory]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("musicdock.theme", theme);
  }, [theme]);
  useEffect(() => {
    NativeCommands.GetTrayIconEnabled()
      .then(setTrayIconEnabled)
      .catch(() => setSettingsError("Não foi possível ler a configuração da bandeja."));
  }, []);
  useEffect(() => {
    if (selectedPlaylistId && !selectedPlaylist) setSelectedPlaylistId(null);
  }, [selectedPlaylist, selectedPlaylistId]);

  const toggleMute = () => setVolume(volume === 0 ? lastVolume.current : 0);
  const toggleTrayIcon = async () => {
    const nextEnabled = !trayIconEnabled;
    setSettingsError(null);
    try {
      const restartRequired = await NativeCommands.SetTrayIconEnabled(nextEnabled);
      setTrayIconEnabled(nextEnabled);
      setTrayRestartRequired(restartRequired);
    } catch {
      setSettingsError("Não foi possível salvar a configuração da bandeja.");
    }
  };
  const submitSearch = (value = query) => {
    const clean = value.trim();
    if (!clean) return;
    setQuery(clean);
    setDiscoverSection("search");
    setShowSuggestions(false);
    inputRef.current?.blur();
    search(clean);
  };
  const submitNewPlaylist = (event: FormEvent) => {
    event.preventDefault();
    const playlist = createPlaylist(newPlaylistName);
    if (!playlist) return;
    setNewPlaylistName("");
    setSelectedPlaylistId(playlist.id);
  };
  const createPlaylistAndAdd = (name: string, song: VideoResult) => {
    const playlist = createPlaylist(name);
    if (!playlist) return false;
    addSongToPlaylist(playlist.id, song);
    return true;
  };
  const requestPlaylistRename = () => {
    if (!selectedPlaylist) return;
    const nextName = window.prompt("Novo nome da playlist", selectedPlaylist.name);
    if (nextName?.trim()) renamePlaylist(selectedPlaylist.id, nextName);
  };
  const requestPlaylistDelete = () => {
    if (!selectedPlaylist || !window.confirm(`Excluir a playlist “${selectedPlaylist.name}”?`)) return;
    deletePlaylist(selectedPlaylist.id);
    setSelectedPlaylistId(null);
  };
  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => seek(Number(event.target.value));
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(target?.tagName) || target?.isContentEditable || !activeItem) return;
      if (event.code === "Space") { event.preventDefault(); isPaused ? play() : pause(); }
      if (event.key === "ArrowRight") seek(Math.min(duration, currentTime + 5));
      if (event.key === "ArrowLeft") seek(Math.max(0, currentTime - 5));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeItem, currentTime, duration, isPaused, pause, play, seek]);

  return (
    <main className="dock-shell">
      <section className="dock-window" aria-label="MusicDock">
        <header className="dock-titlebar wails-draggable">
          <button type="button" className="dock-wordmark" onClick={() => setView("now")}>
            <span className="dock-wordmark__mark"><span /></span>
            <span>musicdock</span>
          </button>
          <div className="dock-window-actions">
            <button type="button" aria-label="Minimizar" onClick={NativeCommands.Minimizar}><Minus /></button>
            <button type="button" aria-label={trayIconEnabled ? "Ocultar" : "Fechar"} onClick={trayIconEnabled ? NativeCommands.WindowHide : NativeCommands.CloseWindow}><X /></button>
          </div>
        </header>

        <div className="app-workspace">
        <div className="dock-content">
          <AnimatePresence mode="wait" initial={false}>
          {view === "now" && (
            <motion.div key="now" className="view-motion now-playing" {...viewMotion}>
              <section className="player-card" aria-label="Player atual">
                <div className="player-card__art" aria-hidden="true">
                  {activeItem?.thumbnail ? <img src={activeItem.thumbnail} alt="" /> : <Music2 />}
                </div>
                <div className="player-card__scrim" aria-hidden="true" />

                <div className="player-card__top">
                  <div className="player-card__actions">
                    <IconButton label="Adicionar à playlist" onClick={() => activeItem && setPlaylistTarget(activeItem)} disabled={!activeItem}><ListPlus /></IconButton>
                    <IconButton label={activeItem && isLiked(activeItem) ? "Remover das músicas curtidas" : "Curtir música"} active={!!activeItem && isLiked(activeItem)} onClick={() => activeItem && toggleLike(activeItem)} disabled={!activeItem}>
                      <Heart fill={activeItem && isLiked(activeItem) ? "currentColor" : "none"} />
                    </IconButton>
                  </div>
                </div>
              </section>

              <div className="player-track">
                <div>
                  <p>TOCANDO AGORA</p>
                  <h2 title={activeItem?.title}>{activeItem?.title ?? "Nada tocando"}</h2>
                  <span>{activeItem ? "YouTube · streaming" : "Escolha uma faixa em Descobrir"}</span>
                </div>
              </div>

              <div className="player-playback">
                {error && <p className="player-error" role="alert">Não foi possível carregar esta faixa.</p>}
                <div className="progress-block">
                  <input
                    aria-label="Progresso da música"
                    aria-valuetext={`${formatTime(currentTime)} de ${formatTime(duration)}`}
                    className="dock-range dock-range--progress"
                    type="range"
                    min="0"
                    max={duration || 1}
                    step="0.1"
                    value={Math.min(currentTime, duration || 0)}
                    disabled={!activeItem || duration <= 0}
                    onChange={handleSeek}
                    style={{ "--progress": `${duration ? (currentTime / duration) * 100 : 0}%` } as CSSProperties & { "--progress": string }}
                  />
                  <div className="time-row"><span>{formatTime(currentTime)}</span><span>-{formatTime(Math.max(0, duration - currentTime))}</span></div>
                </div>

                <div className="transport" aria-label="Controles de reprodução">
                  <IconButton label="Faixa anterior" onClick={playPrev} disabled={!hasPrev}><SkipBack fill="currentColor" /></IconButton>
                  <button type="button" className="play-button" aria-label={isPaused ? "Tocar" : "Pausar"} onClick={isPaused ? play : pause} disabled={!activeItem || isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" /> : isPaused ? <Play fill="currentColor" /> : <Pause fill="currentColor" />}
                  </button>
                  <IconButton label="Próxima faixa" onClick={playNext} disabled={!hasNext}><SkipForward fill="currentColor" /></IconButton>
                </div>
              </div>

              <div className="player-utility" aria-label="Opções de reprodução">
                <IconButton label="Embaralhar" active={shuffle} onClick={toggleShuffle}><Shuffle /></IconButton>
                <IconButton label={loop === "one" ? "Repetir faixa" : "Repetir fila"} active={loop !== "off"} onClick={cycleLoop}>{loop === "one" ? <Repeat1 /> : <Repeat />}</IconButton>
                <button type="button" className={`autoplay-toggle ${autoplay ? "is-on" : ""}`} onClick={toggleAutoplay}><span />Autoplay</button>
                <div className="volume-control">
                  <button type="button" aria-label="Alternar mudo" onClick={toggleMute}>{volume === 0 ? <VolumeX /> : <Volume2 />}</button>
                  <input aria-label="Volume" className="dock-range" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
                </div>
                <IconButton label="Baixar faixa" onClick={download} disabled={!activeItem || isDownloading}>{isDownloading ? <Loader2 className="animate-spin" /> : <Download />}</IconButton>
              </div>
            </motion.div>
          )}

          {view === "search" && (
            <motion.div key="search" className="view-motion library-view" {...viewMotion}>
              <div className="view-heading view-heading--with-action">
                <div><p className="eyebrow">DESCOBRIR</p><h2>{discoverSection === "recommended" ? "Feito para você" : "O que você quer ouvir?"}</h2></div>
                {discoverSection === "recommended" && hasRecommendationSignals && (
                  <button type="button" className="text-action text-action--icon" onClick={refreshRecommendations} disabled={recommendationsLoading}>
                    <RefreshCw className={recommendationsLoading ? "animate-spin" : ""} /> Atualizar
                  </button>
                )}
              </div>
              <div className="section-tabs" role="tablist" aria-label="Descobrir músicas">
                <button type="button" role="tab" aria-selected={discoverSection === "recommended"} className={discoverSection === "recommended" ? "is-active" : ""} onClick={() => setDiscoverSection("recommended")}><Sparkles /> Para você</button>
                <button type="button" role="tab" aria-selected={discoverSection === "search"} className={discoverSection === "search" ? "is-active" : ""} onClick={() => setDiscoverSection("search")}><Search /> Buscar</button>
              </div>

              {discoverSection === "search" ? <>
                <form className="search-box" onSubmit={(event) => { event.preventDefault(); submitSearch(); }}>
                  <Search aria-hidden="true" />
                  <input ref={inputRef} value={query} onFocus={() => setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 120)} onChange={(event) => setQuery(event.target.value)} placeholder="Artista, música ou álbum" aria-label="Buscar música" />
                  {query && <button type="button" aria-label="Limpar busca" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(""); inputRef.current?.focus(); }}><X /></button>}
                </form>
                {showSuggestions && suggestions.length > 0 && (
                  <div className="suggestions">{suggestions.slice(0, 4).map((suggestion) => <button type="button" key={suggestion} onMouseDown={(event) => event.preventDefault()} onClick={() => submitSearch(suggestion)}>{suggestion}</button>)}</div>
                )}
                <div className="result-list">
                  {results.length === 0 ? <p className="empty-copy">Busque algo para ver resultados.</p> : results.map((song) => {
                    const queued = queueIds.has(song.id);
                    return <motion.article layout className="song-row" key={song.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}>
                      <SongArtwork song={song} playing={activeItem?.id === song.id && isPlaying} size="small" />
                      <button type="button" className="song-row__main" onClick={() => enqueueAndPlay(song)}><strong>{song.title}</strong><span>{queued ? "Na fila" : "Toque para ouvir agora"}</span></button>
                      <SaveActions song={song} liked={isLiked(song)} onToggleLike={toggleLike} onAddToPlaylist={setPlaylistTarget} />
                      <IconButton label={queued ? "Já está na fila" : "Adicionar à fila"} onClick={() => enqueue(song)} disabled={queued}><Plus /></IconButton>
                    </motion.article>;
                  })}
                </div>
              </> : (
                <div className="result-list recommendations-list">
                  {!hasRecommendationSignals ? (
                    <div className="empty-state"><Sparkles /><strong>Ensine seus gostos ao MusicDock</strong><p>Curta ou reproduza algumas músicas para receber recomendações personalizadas.</p></div>
                  ) : recommendationsLoading && recommendations.length === 0 ? (
                    <div className="empty-state"><Loader2 className="animate-spin" /><strong>Preparando recomendações</strong></div>
                  ) : recommendationsError && recommendations.length === 0 ? (
                    <div className="empty-state empty-state--error"><Sparkles /><strong>Recomendações indisponíveis</strong><p>{recommendationsError}</p></div>
                  ) : recommendations.length === 0 ? (
                    <div className="empty-state"><Sparkles /><strong>Nenhuma novidade encontrada</strong><p>Tente atualizar usando outras músicas da sua biblioteca.</p></div>
                  ) : recommendations.map((song) => {
                    const queued = queueIds.has(song.id);
                    return <motion.article layout className="song-row" key={song.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}>
                      <SongArtwork song={song} playing={activeItem?.id === song.id && isPlaying} size="small" />
                      <button type="button" className="song-row__main" onClick={() => enqueueAndPlay(song)}><strong>{song.title}</strong><span>{queued ? "Na fila" : "Recomendação personalizada"}</span></button>
                      <SaveActions song={song} liked={isLiked(song)} onToggleLike={toggleLike} onAddToPlaylist={setPlaylistTarget} />
                      <IconButton label={queued ? "Já está na fila" : "Adicionar à fila"} onClick={() => enqueue(song)} disabled={queued}><Plus /></IconButton>
                    </motion.article>;
                  })}
                </div>
              )}
            </motion.div>
          )}

          {view === "queue" && (
            <motion.div key="queue" className="view-motion library-view" {...viewMotion}>
              <div className="view-heading"><p className="eyebrow">SUA SESSÃO</p><h2>Fila de reprodução</h2><span>{queue.length} {queue.length === 1 ? "faixa" : "faixas"}</span></div>
              <div className="result-list">
                {queue.length === 0 ? <p className="empty-copy">A fila está vazia. Encontre algo novo.</p> : queue.map((song, index) => <motion.article layout className={`song-row ${index === currentIndex ? "song-row--active" : ""}`} key={song.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}>
                  <span className="queue-number">{index === currentIndex && isPlaying ? <span className="equalizer" aria-label="Tocando"><i /><i /><i /></span> : String(index + 1).padStart(2, "0")}</span>
                  <button type="button" className="song-row__main" onClick={() => playAt(index)}><strong>{song.title}</strong><span>{index === currentIndex ? "Selecionada" : "Toque para reproduzir"}</span></button>
                  <IconButton label="Remover da fila" onClick={() => dequeue(index)}><X /></IconButton>
                </motion.article>) }
              </div>
            </motion.div>
          )}
          {view === "library" && (
            <motion.div key="library" className="view-motion library-view" {...viewMotion}>
              <div className="view-heading view-heading--with-action">
                <div>
                  <p className="eyebrow">SUA BIBLIOTECA</p>
                  <h2>{librarySection === "liked" ? "Músicas curtidas" : librarySection === "playlists" ? "Playlists" : "Histórico"}</h2>
                  <span>{librarySection === "liked" ? `${likedSongs.length} ${likedSongs.length === 1 ? "música" : "músicas"}` : librarySection === "playlists" ? `${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}` : `${history.length} ${history.length === 1 ? "faixa" : "faixas"}`}</span>
                </div>
                {librarySection === "liked" && likedSongs.length > 0 && <button type="button" className="text-action" onClick={clearLikedSongs}>Limpar</button>}
                {librarySection === "history" && history.length > 0 && <button type="button" className="text-action" onClick={clearHistory}>Limpar</button>}
              </div>

              <div className="section-tabs section-tabs--library" role="tablist" aria-label="Seções da biblioteca">
                <button type="button" role="tab" aria-selected={librarySection === "liked"} className={librarySection === "liked" ? "is-active" : ""} onClick={() => { setLibrarySection("liked"); setSelectedPlaylistId(null); }}><Heart /> Curtidas</button>
                <button type="button" role="tab" aria-selected={librarySection === "playlists"} className={librarySection === "playlists" ? "is-active" : ""} onClick={() => setLibrarySection("playlists")}><ListMusic /> Playlists</button>
                <button type="button" role="tab" aria-selected={librarySection === "history"} className={librarySection === "history" ? "is-active" : ""} onClick={() => { setLibrarySection("history"); setSelectedPlaylistId(null); }}><Clock3 /> Histórico</button>
              </div>

              {librarySection === "liked" && (
                <div className="result-list">
                  {likedSongs.length === 0 ? <div className="empty-state"><Heart /><strong>Nenhuma música curtida</strong><p>Use o coração no player ou nos resultados para guardar suas favoritas.</p></div> : likedSongs.map((song) => <motion.article layout className="song-row" key={song.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}>
                    <SongArtwork song={song} playing={activeItem?.id === song.id && isPlaying} size="small" />
                    <button type="button" className="song-row__main" onClick={() => enqueueAndPlay(song)}><strong>{song.title}</strong><span>Salva neste dispositivo</span></button>
                    <SaveActions song={song} liked onToggleLike={toggleLike} onAddToPlaylist={setPlaylistTarget} />
                  </motion.article>)}
                </div>
              )}

              {librarySection === "playlists" && !selectedPlaylist && <>
                <form className="playlist-create" onSubmit={submitNewPlaylist}>
                  <input value={newPlaylistName} maxLength={100} onChange={(event) => setNewPlaylistName(event.target.value)} placeholder="Nome da nova playlist" aria-label="Nome da nova playlist" />
                  <button type="submit" disabled={!newPlaylistName.trim()}><Plus /> Criar</button>
                </form>
                <div className="playlist-grid">
                  {playlists.length === 0 ? <div className="empty-state"><ListMusic /><strong>Crie sua primeira playlist</strong><p>Agrupe músicas para ouvir quando quiser.</p></div> : playlists.map((playlist) => (
                    <button type="button" className="playlist-card" key={playlist.id} onClick={() => setSelectedPlaylistId(playlist.id)}>
                      <span className="playlist-card__cover"><ListMusic /></span>
                      <span><strong>{playlist.name}</strong><small>{playlist.songs.length} {playlist.songs.length === 1 ? "faixa" : "faixas"}</small></span>
                    </button>
                  ))}
                </div>
              </>}

              {librarySection === "playlists" && selectedPlaylist && <>
                <div className="playlist-detail">
                  <button type="button" className="playlist-detail__back" aria-label="Voltar para playlists" onClick={() => setSelectedPlaylistId(null)}><ChevronLeft /></button>
                  <div><strong>{selectedPlaylist.name}</strong><span>{selectedPlaylist.songs.length} {selectedPlaylist.songs.length === 1 ? "faixa" : "faixas"}</span></div>
                  <IconButton label="Renomear playlist" onClick={requestPlaylistRename}><Pencil /></IconButton>
                  <IconButton label="Excluir playlist" onClick={requestPlaylistDelete}><Trash2 /></IconButton>
                </div>
                <div className="result-list result-list--flush">
                  {selectedPlaylist.songs.length === 0 ? <div className="empty-state"><ListPlus /><strong>Playlist vazia</strong><p>Adicione músicas usando o botão de playlist.</p></div> : selectedPlaylist.songs.map((song) => <motion.article layout className="song-row" key={song.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}>
                    <SongArtwork song={song} playing={activeItem?.id === song.id && isPlaying} size="small" />
                    <button type="button" className="song-row__main" onClick={() => enqueueAndPlay(song)}><strong>{song.title}</strong><span>Na playlist {selectedPlaylist.name}</span></button>
                    <IconButton label={isLiked(song) ? "Remover das músicas curtidas" : "Curtir música"} active={isLiked(song)} onClick={() => toggleLike(song)}><Heart fill={isLiked(song) ? "currentColor" : "none"} /></IconButton>
                    <IconButton label="Remover da playlist" onClick={() => removeSongFromPlaylist(selectedPlaylist.id, song)}><X /></IconButton>
                  </motion.article>)}
                </div>
              </>}

              {librarySection === "history" && (
                <div className="result-list">
                  {history.length === 0 ? <div className="empty-state"><Clock3 /><strong>O histórico está vazio</strong><p>As faixas reproduzidas aparecerão aqui.</p></div> : history.map((song) => <motion.article layout className="song-row" key={`${song.id}-${song.playedAt}`} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}>
                    <SongArtwork song={song} playing={activeItem?.id === song.id && isPlaying} size="small" />
                    <button type="button" className="song-row__main" onClick={() => enqueueAndPlay(song)}><strong>{song.title}</strong><span>Ouvida {relativeTime(song.playedAt)}</span></button>
                    <SaveActions song={song} liked={isLiked(song)} onToggleLike={toggleLike} onAddToPlaylist={setPlaylistTarget} />
                  </motion.article>)}
                </div>
              )}
            </motion.div>
          )}
          {view === "settings" && (
            <motion.div key="settings" className="view-motion settings-view" {...viewMotion}>
              <div className="view-heading"><p className="eyebrow">PREFERÊNCIAS</p><h2>Configurações</h2><span>Personalize a aparência e o comportamento do app.</span></div>

              <section className="settings-group" aria-labelledby="appearance-heading">
                <div className="settings-group__heading">
                  <span className="settings-group__icon"><Sun aria-hidden="true" /></span>
                  <div><h3 id="appearance-heading">Aparência</h3><p>Escolha como o MusicDock aparece.</p></div>
                </div>
                <div className="theme-options" aria-label="Tema do aplicativo">
                  <button type="button" className={theme === "light" ? "is-selected" : ""} aria-pressed={theme === "light"} onClick={() => setTheme("light")}><Sun /><span><strong>Claro</strong><small>Fundo branco</small></span></button>
                  <button type="button" className={theme === "dark" ? "is-selected" : ""} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}><Moon /><span><strong>Escuro</strong><small>Fundo preto</small></span></button>
                </div>
              </section>

              <section className="settings-group" aria-labelledby="system-heading">
                <div className="settings-row">
                  <div className="settings-group__heading">
                    <span className="settings-group__icon"><Settings aria-hidden="true" /></span>
                    <div><h3 id="system-heading">Ícone na bandeja</h3><p>Mantenha acesso rápido ao MusicDock.</p></div>
                  </div>
                  <button type="button" role="switch" aria-checked={trayIconEnabled} className={`setting-switch ${trayIconEnabled ? "is-on" : ""}`} onClick={toggleTrayIcon}><span /></button>
                </div>
                {trayRestartRequired && <p className="settings-note">O ícone voltará no próximo início do app.</p>}
                {settingsError && <p className="settings-error" role="alert">{settingsError}</p>}
              </section>

              <p className="settings-version">MUSICDOCK · CONFIGURAÇÕES SALVAS NESTE DISPOSITIVO</p>
            </motion.div>
          )}
          </AnimatePresence>
        </div>

        <nav className="dock-nav" aria-label="Navegação principal">
          <button type="button" className={view === "now" ? "is-active" : ""} onClick={() => setView("now")}><Music2 /><span>Agora</span></button>
          <button type="button" className={view === "search" ? "is-active" : ""} onClick={() => setView("search")}><Sparkles /><span>Descobrir</span></button>
          <button type="button" className={view === "library" ? "is-active" : ""} onClick={() => setView("library")}><Library /><span>Biblioteca</span>{likedSongs.length > 0 && <b>{likedSongs.length}</b>}</button>
          <button type="button" className={view === "queue" ? "is-active" : ""} onClick={() => setView("queue")}><ListMusic /><span>Fila</span>{queue.length > 0 && <b>{queue.length}</b>}</button>
          <button type="button" className={view === "settings" ? "is-active" : ""} onClick={() => setView("settings")}><Settings /><span>Config</span></button>
        </nav>
        </div>

        {playlistTarget && (
          <PlaylistPicker
            song={playlistTarget}
            playlists={playlists}
            isSongInPlaylist={isSongInPlaylist}
            onAdd={addSongToPlaylist}
            onCreateAndAdd={createPlaylistAndAdd}
            onClose={() => setPlaylistTarget(null)}
          />
        )}
      </section>
    </main>
  );
}

export default MusicGadgetView;
