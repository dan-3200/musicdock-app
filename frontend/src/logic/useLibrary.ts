import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VideoResult } from './usePlayer';

export interface Playlist {
	id: string;
	name: string;
	songs: VideoResult[];
	createdAt: number;
	updatedAt: number;
}

interface LibraryState {
	version: 1;
	likedSongs: VideoResult[];
	playlists: Playlist[];
}

export interface UseLibraryResult {
	likedSongs: VideoResult[];
	likedSongIds: ReadonlySet<string>;
	playlists: Playlist[];
	isLiked: (songOrId: VideoResult | string) => boolean;
	likeSong: (song: VideoResult) => void;
	unlikeSong: (songOrId: VideoResult | string) => void;
	toggleLike: (song: VideoResult) => void;
	clearLikedSongs: () => void;
	createPlaylist: (name: string) => Playlist | null;
	renamePlaylist: (playlistId: string, name: string) => void;
	deletePlaylist: (playlistId: string) => void;
	addSongToPlaylist: (playlistId: string, song: VideoResult) => void;
	removeSongFromPlaylist: (playlistId: string, songOrId: VideoResult | string) => void;
	isSongInPlaylist: (playlistId: string, songOrId: VideoResult | string) => boolean;
}

const LIBRARY_STORAGE_KEY = 'musicdock.library.v1';
const LIBRARY_VERSION = 1 as const;
const MAX_SONGS_PER_COLLECTION = 10_000;
const MAX_PLAYLISTS = 1_000;
const MAX_PLAYLIST_NAME_LENGTH = 100;

let playlistIdSequence = 0;

export function useLibrary(): UseLibraryResult {
	const [library, setLibrary] = useState<LibraryState>(readLibrary);

	useEffect(() => {
		writeLibrary(library);
	}, [library]);

	useEffect(() => {
		if (typeof window === 'undefined') return;

		const syncLibrary = (event: StorageEvent) => {
			if (event.key === LIBRARY_STORAGE_KEY) {
				setLibrary(parseLibrary(event.newValue));
			}
		};

		window.addEventListener('storage', syncLibrary);
		return () => window.removeEventListener('storage', syncLibrary);
	}, []);

	const likedSongIds = useMemo(
		() => new Set(library.likedSongs.map((song) => song.id)),
		[library.likedSongs],
	);

	const isLiked = useCallback(
		(songOrId: VideoResult | string) => likedSongIds.has(getSongId(songOrId)),
		[likedSongIds],
	);

	const likeSong = useCallback((song: VideoResult) => {
		const normalizedSong = parseSong(song);
		if (!normalizedSong) return;

		setLibrary((current) => {
			if (current.likedSongs.some((liked) => liked.id === normalizedSong.id)) return current;
			return {
				...current,
				likedSongs: [normalizedSong, ...current.likedSongs].slice(0, MAX_SONGS_PER_COLLECTION),
			};
		});
	}, []);

	const unlikeSong = useCallback((songOrId: VideoResult | string) => {
		const songId = getSongId(songOrId);
		if (!songId) return;

		setLibrary((current) => {
			const likedSongs = current.likedSongs.filter((song) => song.id !== songId);
			return likedSongs.length === current.likedSongs.length
				? current
				: { ...current, likedSongs };
		});
	}, []);

	const toggleLike = useCallback((song: VideoResult) => {
		const normalizedSong = parseSong(song);
		if (!normalizedSong) return;

		setLibrary((current) => {
			const alreadyLiked = current.likedSongs.some((liked) => liked.id === normalizedSong.id);
			return {
				...current,
				likedSongs: alreadyLiked
					? current.likedSongs.filter((liked) => liked.id !== normalizedSong.id)
					: [normalizedSong, ...current.likedSongs].slice(0, MAX_SONGS_PER_COLLECTION),
			};
		});
	}, []);

	const clearLikedSongs = useCallback(() => {
		setLibrary((current) => current.likedSongs.length === 0
			? current
			: { ...current, likedSongs: [] });
	}, []);

	const createPlaylist = useCallback((name: string): Playlist | null => {
		const normalizedName = normalizePlaylistName(name);
		if (!normalizedName || library.playlists.length >= MAX_PLAYLISTS) return null;

		const now = Date.now();
		const playlist: Playlist = {
			id: createUniquePlaylistId(new Set(library.playlists.map(({ id }) => id))),
			name: normalizedName,
			songs: [],
			createdAt: now,
			updatedAt: now,
		};

		setLibrary((current) => current.playlists.length >= MAX_PLAYLISTS
			? current
			: { ...current, playlists: [...current.playlists, playlist] });
		return playlist;
	}, [library.playlists]);

	const renamePlaylist = useCallback((playlistId: string, name: string) => {
		const normalizedName = normalizePlaylistName(name);
		if (!playlistId || !normalizedName) return;

		setLibrary((current) => updatePlaylist(current, playlistId, (playlist) => {
			if (playlist.name === normalizedName) return playlist;
			return { ...playlist, name: normalizedName, updatedAt: Date.now() };
		}));
	}, []);

	const deletePlaylist = useCallback((playlistId: string) => {
		if (!playlistId) return;
		setLibrary((current) => {
			const playlists = current.playlists.filter((playlist) => playlist.id !== playlistId);
			return playlists.length === current.playlists.length
				? current
				: { ...current, playlists };
		});
	}, []);

	const addSongToPlaylist = useCallback((playlistId: string, song: VideoResult) => {
		const normalizedSong = parseSong(song);
		if (!playlistId || !normalizedSong) return;

		setLibrary((current) => updatePlaylist(current, playlistId, (playlist) => {
			if (
				playlist.songs.length >= MAX_SONGS_PER_COLLECTION ||
				playlist.songs.some((item) => item.id === normalizedSong.id)
			) return playlist;

			return {
				...playlist,
				songs: [...playlist.songs, normalizedSong],
				updatedAt: Date.now(),
			};
		}));
	}, []);

	const removeSongFromPlaylist = useCallback((
		playlistId: string,
		songOrId: VideoResult | string,
	) => {
		const songId = getSongId(songOrId);
		if (!playlistId || !songId) return;

		setLibrary((current) => updatePlaylist(current, playlistId, (playlist) => {
			const songs = playlist.songs.filter((song) => song.id !== songId);
			return songs.length === playlist.songs.length
				? playlist
				: { ...playlist, songs, updatedAt: Date.now() };
		}));
	}, []);

	const isSongInPlaylist = useCallback((
		playlistId: string,
		songOrId: VideoResult | string,
	) => {
		const songId = getSongId(songOrId);
		return library.playlists.some(
			(playlist) => playlist.id === playlistId && playlist.songs.some((song) => song.id === songId),
		);
	}, [library.playlists]);

	return {
		likedSongs: library.likedSongs,
		likedSongIds,
		playlists: library.playlists,
		isLiked,
		likeSong,
		unlikeSong,
		toggleLike,
		clearLikedSongs,
		createPlaylist,
		renamePlaylist,
		deletePlaylist,
		addSongToPlaylist,
		removeSongFromPlaylist,
		isSongInPlaylist,
	};
}

function readLibrary(): LibraryState {
	if (typeof window === 'undefined') return emptyLibrary();
	try {
		return parseLibrary(window.localStorage.getItem(LIBRARY_STORAGE_KEY));
	} catch {
		return emptyLibrary();
	}
}

function writeLibrary(library: LibraryState): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
	} catch {
		// A biblioteca permanece utilizavel em memoria se o WebView bloquear ou lotar o storage.
	}
}

function parseLibrary(raw: string | null): LibraryState {
	if (!raw) return emptyLibrary();

	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return emptyLibrary();

		const likedSongs = parseSongs(parsed.likedSongs);
		const playlists: Playlist[] = [];
		const knownIds = new Set<string>();
		const storedPlaylists = Array.isArray(parsed.playlists)
			? parsed.playlists.slice(0, MAX_PLAYLISTS)
			: [];

		for (const value of storedPlaylists) {
			const playlist = parsePlaylist(value, knownIds);
			if (!playlist) continue;
			knownIds.add(playlist.id);
			playlists.push(playlist);
		}

		return { version: LIBRARY_VERSION, likedSongs, playlists };
	} catch {
		return emptyLibrary();
	}
}

function parsePlaylist(value: unknown, knownIds: Set<string>): Playlist | null {
	if (!isRecord(value)) return null;
	const name = normalizePlaylistName(value.name);
	if (!name) return null;

	const storedId = typeof value.id === 'string' ? value.id.trim() : '';
	const id = storedId && !knownIds.has(storedId)
		? storedId
		: createUniquePlaylistId(knownIds);
	const createdAt = parseTimestamp(value.createdAt, Date.now());
	const updatedAt = Math.max(createdAt, parseTimestamp(value.updatedAt, createdAt));
	const songsSource = Array.isArray(value.songs) ? value.songs : value.tracks;

	return {
		id,
		name,
		songs: parseSongs(songsSource),
		createdAt,
		updatedAt,
	};
}

function parseSongs(value: unknown): VideoResult[] {
	if (!Array.isArray(value)) return [];
	const songs: VideoResult[] = [];
	const knownIds = new Set<string>();

	for (const item of value.slice(0, MAX_SONGS_PER_COLLECTION)) {
		const song = parseSong(item);
		if (!song || knownIds.has(song.id)) continue;
		knownIds.add(song.id);
		songs.push(song);
	}
	return songs;
}

function parseSong(value: unknown): VideoResult | null {
	if (!isRecord(value)) return null;
	const id = typeof value.id === 'string' ? value.id.trim() : '';
	const title = typeof value.title === 'string' ? value.title.trim() : '';
	const url = typeof value.url === 'string' ? value.url.trim() : '';
	if (!id || !title || !url) return null;

	return {
		id,
		title,
		url,
		thumbnail: typeof value.thumbnail === 'string' ? value.thumbnail.trim() : '',
	};
}

function updatePlaylist(
	library: LibraryState,
	playlistId: string,
	update: (playlist: Playlist) => Playlist,
): LibraryState {
	const index = library.playlists.findIndex((playlist) => playlist.id === playlistId);
	if (index < 0) return library;

	const currentPlaylist = library.playlists[index];
	const nextPlaylist = update(currentPlaylist);
	if (nextPlaylist === currentPlaylist) return library;

	const playlists = [...library.playlists];
	playlists[index] = nextPlaylist;
	return { ...library, playlists };
}

function createUniquePlaylistId(knownIds: Set<string>): string {
	let id: string;
	do {
		playlistIdSequence += 1;
		const uuid = globalThis.crypto?.randomUUID?.();
		id = uuid ?? `playlist-${Date.now().toString(36)}-${playlistIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	} while (knownIds.has(id));
	return id;
}

function normalizePlaylistName(value: unknown): string {
	if (typeof value !== 'string') return '';
	return value.trim().replace(/\s+/g, ' ').slice(0, MAX_PLAYLIST_NAME_LENGTH);
}

function parseTimestamp(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

function getSongId(songOrId: VideoResult | string): string {
	return (typeof songOrId === 'string' ? songOrId : songOrId.id).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function emptyLibrary(): LibraryState {
	return { version: LIBRARY_VERSION, likedSongs: [], playlists: [] };
}
