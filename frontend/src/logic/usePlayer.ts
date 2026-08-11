import { useCallback, useEffect, useRef, useState } from 'react';
import { SongController } from '../infra/song.controller';
import { NativeCommands } from '../infra/commands.native';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VideoResult {
	id: string;
	title: string;
	thumbnail: string;
	url: string;
}

export interface HistoryEntry extends VideoResult {
	playedAt: number;
}

const HISTORY_STORAGE_KEY = 'musicdock.playback-history.v1';
const HISTORY_LIMIT = 30;

export function usePlaybackHistory() {
	const [history, setHistory] = useState<HistoryEntry[]>(() => {
		try {
			const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
			const parsed: unknown = stored ? JSON.parse(stored) : [];
			return Array.isArray(parsed) ? parsed.filter(isHistoryEntry).slice(0, HISTORY_LIMIT) : [];
		} catch {
			return [];
		}
	});

	const save = useCallback((entries: HistoryEntry[]) => {
		setHistory(entries);
		try {
			window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
		} catch {
			// O player continua utilizável mesmo se o armazenamento do WebView estiver indisponível.
		}
	}, []);

	const record = useCallback((song: VideoResult) => {
		setHistory((current) => {
			const next = [{ ...song, playedAt: Date.now() }, ...current.filter((entry) => entry.id !== song.id)].slice(0, HISTORY_LIMIT);
			try {
				window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
			} catch {
				// O histórico em memória permanece disponível nesta sessão.
			}
			return next;
		});
	}, []);

	const clear = useCallback(() => save([]), [save]);

	return { history, record, clear };
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Partial<HistoryEntry>;
	return typeof entry.id === 'string' && typeof entry.title === 'string' &&
		typeof entry.thumbnail === 'string' && typeof entry.url === 'string' && typeof entry.playedAt === 'number';
}

export type LoopMode = 'off' | 'all' | 'one';

// ─── useSearch ────────────────────────────────────────────────────────────────

export function useSearch() {
	const [results, setResults] = useState<VideoResult[]>([]);

	const search = useCallback(async (query: string) => {
		const data = await NativeCommands.SearchVideos(query);
		setResults(data);
	}, []);

	return { results, search };
}

// ─── useSearchSuggestions ─────────────────────────────────────────────────────

export function useSearchSuggestions(input: string) {
	const [suggestions, setSuggestions] = useState<string[]>([]);

	useEffect(() => {
		if (input.trim().length <= 1) {
			setSuggestions([]);
			return;
		}
		const timer = setTimeout(async () => {
			setSuggestions(await NativeCommands.GetSearchSuggestions(input));
		}, 300);
		return () => clearTimeout(timer);
	}, [input]);

	return suggestions;
}

// ─── usePlayer ────────────────────────────────────────────────────────────────

export function usePlayer() {
	const [queue, setQueue] = useState<VideoResult[]>([]);
	const [currentIndex, setCurrentIndex] = useState(-1);

	const [volume, setVolume] = useState(25);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [isDownloading, setIsDownloading] = useState(false);
	const [isPaused, setIsPaused] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// ─── Playback modes ───────────────────────────────────────────────────────
	const [autoplay, setAutoplay] = useState(true);
	const [shuffle, setShuffle] = useState(false);
	const [loop, setLoop] = useState<LoopMode>('off');

	const toggleAutoplay = useCallback(() => setAutoplay((v) => !v), []);
	const toggleShuffle = useCallback(() => setShuffle((v) => !v), []);
	const cycleLoop = useCallback(
		() => setLoop((m) => (m === 'off' ? 'all' : m === 'all' ? 'one' : 'off')),
		[],
	);

	const songRef = useRef<SongController | null>(null);

	const liveRef = useRef({ queue, currentIndex, autoplay, shuffle, loop });
	useEffect(() => {
		liveRef.current = { queue, currentIndex, autoplay, shuffle, loop };
	}, [queue, currentIndex, autoplay, shuffle, loop]);

	const activeItem = currentIndex >= 0 ? (queue[currentIndex] ?? null) : null;
	const hasNext =
		queue.length > 0 &&
		(loop === 'all' || shuffle || currentIndex < queue.length - 1);
	const hasPrev =
		queue.length > 0 && (loop === 'all' || shuffle || currentIndex > 0);
	const isPlaying =
		!isLoading && !!activeItem && currentTime > 0 && currentTime < duration;

	// ─── Helpers for next index ───────────────────────────────────────────────
	const pickNextIndex = useCallback((opts: { fromAutoEnd: boolean }) => {
		const {
			queue: q,
			currentIndex: ci,
			shuffle: sh,
			loop: lp,
		} = liveRef.current;
		if (q.length === 0) return -1;

		if (opts.fromAutoEnd && lp === 'one') return ci;

		if (sh) {
			if (q.length === 1) return lp === 'off' && opts.fromAutoEnd ? -1 : 0;
			let next = ci;
			while (next === ci) next = Math.floor(Math.random() * q.length);
			return next;
		}

		if (ci + 1 < q.length) return ci + 1;
		if (lp === 'all') return 0;
		return -1;
	}, []);

	const pickPrevIndex = useCallback(() => {
		const {
			queue: q,
			currentIndex: ci,
			shuffle: sh,
			loop: lp,
		} = liveRef.current;
		if (q.length === 0) return -1;

		if (sh) {
			if (q.length === 1) return 0;
			let prev = ci;
			while (prev === ci) prev = Math.floor(Math.random() * q.length);
			return prev;
		}

		if (ci - 1 >= 0) return ci - 1;
		if (lp === 'all') return q.length - 1;
		return ci;
	}, []);

	const enqueue = useCallback((video: VideoResult) => {
		setQueue((prev) =>
			prev.some((v) => v.id === video.id) ? prev : [...prev, video],
		);
	}, []);

	const enqueueAndPlay = useCallback((video: VideoResult) => {
		setQueue((prev) => {
			const existing = prev.findIndex((v) => v.id === video.id);
			if (existing >= 0) {
				setCurrentIndex(existing);
				return prev;
			}
			setCurrentIndex(prev.length);
			return [...prev, video];
		});
	}, []);

	const dequeue = useCallback((index: number) => {
		setQueue((prev) => prev.filter((_, i) => i !== index));
		setCurrentIndex((prev) => {
			if (index < prev) return prev - 1;
			if (index === prev) return -1;
			return prev;
		});
	}, []);

	const playAt = useCallback((index: number) => setCurrentIndex(index), []);
	const playNext = useCallback(() => {
		const next = pickNextIndex({ fromAutoEnd: false });
		if (next >= 0) setCurrentIndex(next);
	}, [pickNextIndex]);
	const playPrev = useCallback(() => {
		const prev = pickPrevIndex();
		if (prev >= 0) setCurrentIndex(prev);
	}, [pickPrevIndex]);

	const play = useCallback(() => {
		setIsPaused(false);
		songRef.current?.play();
	}, []);
	const pause = useCallback(() => {
		setIsPaused(true);
		songRef.current?.pause();
	}, []);
	const seek = useCallback((time: number) => {
		setCurrentTime(time);
		songRef.current?.seek(time);
	}, []);

	const download = useCallback(async () => {
		if (!activeItem) return;
		setIsDownloading(true);
		try {
			const path = await NativeCommands.SaveSongDialog();
			if (!path) return;
			await NativeCommands.DownloadSong(activeItem.url, path);
		} catch (err) {
			setError(String(err));
		} finally {
			setIsDownloading(false);
		}
	}, [activeItem]);

	useEffect(() => {
		if (!activeItem) return;
		let cancelled = false;
		let interval: ReturnType<typeof setInterval>;

		const load = async () => {
			songRef.current?.pause();
			songRef.current = null;
			setIsLoading(true);
			setError(null);
			setCurrentTime(0);
			setDuration(0);

			try {
				const directUrl = await NativeCommands.GetAudioUrl(activeItem.url);
				if (cancelled) return;
				const controller = new SongController(directUrl);
				controller.setVolume(volume);
				songRef.current = controller;

				if (autoplay) {
					controller.play();
					setIsPaused(false);
				}

				interval = setInterval(() => {
					if (!songRef.current) return;
					const progress = songRef.current.progress;
					const dur = songRef.current.duration;
					setCurrentTime(progress);
					setDuration(dur);

					if (dur > 0 && progress >= dur - 0.5) {
						const { autoplay: ap, loop: lp } = liveRef.current;

						// Loop one: re-seek to start regardless of autoplay
						if (lp === 'one') {
							songRef.current.seek(0);
							setCurrentTime(0);
							return;
						}

						if (ap) {
							const next = pickNextIndex({ fromAutoEnd: true });
							if (next >= 0) playAt(next);
						} else {
							// Se estiver desligado, apenas pausa ao chegar no fim[cite: 3]
							setIsPaused(true);
						}
					}
				}, 500);
			} catch (err) {
				if (!cancelled) setError(String(err));
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};

		load();
		return () => {
			cancelled = true;
			clearInterval(interval);
			setIsPaused(true);
			songRef.current?.pause();
			songRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeItem?.url, pickNextIndex, playAt]);

	useEffect(() => {
		songRef.current?.setVolume(volume);
	}, [volume]);

	return {
		queue,
		currentIndex,
		activeItem,
		hasNext,
		hasPrev,
		enqueue,
		enqueueAndPlay,
		dequeue,
		playAt,
		playNext,
		playPrev,
		volume,
		setVolume,
		currentTime,
		duration,
		isLoading,
		isDownloading,
		isPlaying,
		isPaused,
		error,
		play,
		pause,
		seek,
		download,
		// new playback modes
		autoplay,
		shuffle,
		loop,
		toggleAutoplay,
		toggleShuffle,
		cycleLoop,
	};
}
