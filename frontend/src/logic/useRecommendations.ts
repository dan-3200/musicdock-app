import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NativeCommands } from '../infra/commands.native';
import type { VideoResult } from './usePlayer';

const DEFAULT_RESULT_LIMIT = 12;
const MAX_RESULT_LIMIT = 20;
const MAX_SEARCHES_PER_REFRESH = 3;
const MAX_SEEDS_PER_SOURCE = 12;

const SEARCH_VARIANTS = ['', 'music', 'radio'];

export interface UseRecommendationsOptions {
	likedSongs: readonly VideoResult[];
	history: readonly VideoResult[];
	limit?: number;
}

export interface UseRecommendationsResult {
	recommendations: VideoResult[];
	isLoading: boolean;
	error: string | null;
	hasSignals: boolean;
	refresh: () => void;
}

/**
 * Produces lightweight, private recommendations from data already stored on the
 * device. No request is made until at least one usable liked/history song exists.
 */
export function useRecommendations({
	likedSongs,
	history,
	limit = DEFAULT_RESULT_LIMIT,
}: UseRecommendationsOptions): UseRecommendationsResult {
	const [recommendations, setRecommendations] = useState<VideoResult[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [refreshVersion, setRefreshVersion] = useState(0);

	const requestVersion = useRef(0);
	const signalsRef = useRef({ likedSongs, history });
	signalsRef.current = { likedSongs, history };

	const resultLimit = clampLimit(limit);
	const signalFingerprint = useMemo(
		() => buildSignalFingerprint(likedSongs, history),
		[likedSongs, history],
	);
	const hasSignals = signalFingerprint.length > 0;

	const refresh = useCallback(() => {
		if (signalFingerprint.length > 0) {
			setRefreshVersion((current) => current + 1);
		}
	}, [signalFingerprint]);

	useEffect(() => {
		const currentRequest = ++requestVersion.current;
		let disposed = false;

		if (!signalFingerprint) {
			setRecommendations([]);
			setError(null);
			setIsLoading(false);
			return () => {
				disposed = true;
			};
		}

		const { likedSongs: currentLikes, history: currentHistory } = signalsRef.current;
		const queries = buildQueries(currentLikes, currentHistory, refreshVersion);
		if (queries.length === 0) {
			setRecommendations([]);
			setError(null);
			setIsLoading(false);
			return () => {
				disposed = true;
			};
		}

		setIsLoading(true);
		setError(null);

		void Promise.allSettled(queries.map((query) => NativeCommands.SearchVideos(query)))
			.then((responses) => {
				if (disposed || currentRequest !== requestVersion.current) return;

				const successful = responses
					.filter(isFulfilled)
					.map((response) => response.value ?? []);
				const next = mergeRecommendations(
					successful,
					currentLikes,
					currentHistory,
					resultLimit,
				);

				setRecommendations(next);
				if (successful.length === 0) {
					setError('Não foi possível carregar recomendações agora.');
				}
			})
			.catch((reason: unknown) => {
				if (disposed || currentRequest !== requestVersion.current) return;
				setRecommendations([]);
				setError(errorMessage(reason));
			})
			.finally(() => {
				if (!disposed && currentRequest === requestVersion.current) {
					setIsLoading(false);
				}
			});

		return () => {
			disposed = true;
		};
	}, [refreshVersion, resultLimit, signalFingerprint]);

	return { recommendations, isLoading, error, hasSignals, refresh };
}

function buildSignalFingerprint(
	likedSongs: readonly VideoResult[],
	history: readonly VideoResult[],
): string {
	return [
		...likedSongs.filter(isUsableSignal).map((song) => `l:${songKey(song)}`),
		...history.filter(isUsableSignal).map((song) => `h:${songKey(song)}`),
	].join('|');
}

function buildQueries(
	likedSongs: readonly VideoResult[],
	history: readonly VideoResult[],
	refreshVersion: number,
): string[] {
	const likes = uniqueSongs(likedSongs).filter(isUsableSignal).slice(0, MAX_SEEDS_PER_SOURCE);
	const recent = uniqueSongs(history).filter(isUsableSignal).slice(0, MAX_SEEDS_PER_SOURCE);
	const seedPool = interleave(likes, recent);
	if (seedPool.length === 0) return [];

	const queries: string[] = [];
	const seenQueries = new Set<string>();
	const offset = refreshVersion % seedPool.length;

	for (let index = 0; index < seedPool.length && queries.length < MAX_SEARCHES_PER_REFRESH; index += 1) {
		const seed = seedPool[(offset + index) % seedPool.length];
		const title = cleanSeedTitle(seed.title);
		if (!title) continue;

		const variant = SEARCH_VARIANTS[(refreshVersion + queries.length) % SEARCH_VARIANTS.length];
		const query = variant ? `${title} ${variant}` : title;
		const normalized = normalizeText(query);
		if (seenQueries.has(normalized)) continue;

		seenQueries.add(normalized);
		queries.push(query);
	}

	return queries;
}

function mergeRecommendations(
	resultGroups: readonly (readonly VideoResult[])[],
	likedSongs: readonly VideoResult[],
	history: readonly VideoResult[],
	limit: number,
): VideoResult[] {
	const knownSongs = [...likedSongs, ...history];
	const knownIds = new Set(knownSongs.map((song) => song.id).filter(Boolean));
	const knownUrls = new Set(knownSongs.map((song) => normalizeUrl(song.url)).filter(Boolean));
	const knownTitles = new Set(knownSongs.map((song) => normalizeTitle(song.title)).filter(Boolean));
	const selectedIds = new Set<string>();
	const selectedUrls = new Set<string>();
	const selectedTitles = new Set<string>();
	const merged: VideoResult[] = [];

	// Round-robin keeps one seed/query from monopolising all result slots.
	const longestGroup = Math.max(0, ...resultGroups.map((group) => group.length));
	for (let rank = 0; rank < longestGroup && merged.length < limit; rank += 1) {
		for (const group of resultGroups) {
			const candidate = group[rank];
			if (!isVideoResult(candidate)) continue;

			const url = normalizeUrl(candidate.url);
			const title = normalizeTitle(candidate.title);
			if (
				knownIds.has(candidate.id) ||
				(url !== '' && knownUrls.has(url)) ||
				(title !== '' && knownTitles.has(title)) ||
				selectedIds.has(candidate.id) ||
				(url !== '' && selectedUrls.has(url)) ||
				(title !== '' && selectedTitles.has(title))
			) {
				continue;
			}

			selectedIds.add(candidate.id);
			if (url) selectedUrls.add(url);
			if (title) selectedTitles.add(title);
			merged.push(candidate);
			if (merged.length >= limit) break;
		}
	}

	return merged;
}

function uniqueSongs(songs: readonly VideoResult[]): VideoResult[] {
	const seen = new Set<string>();
	return songs.filter((song) => {
		const key = songKey(song);
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function interleave(primary: readonly VideoResult[], secondary: readonly VideoResult[]): VideoResult[] {
	const songs: VideoResult[] = [];
	const seen = new Set<string>();
	const length = Math.max(primary.length, secondary.length);

	for (let index = 0; index < length; index += 1) {
		for (const song of [primary[index], secondary[index]]) {
			if (!song) continue;
			const key = songKey(song);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			songs.push(song);
		}
	}

	return songs;
}

function cleanSeedTitle(title: string): string {
	return title
		.replace(/[\[(](?:official|oficial|lyrics?|letra|audio|video|visualizer|clipe)[^\])]*[\])]/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120);
}

function normalizeTitle(title: string): string {
	return normalizeText(cleanSeedTitle(title));
}

function normalizeText(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function normalizeUrl(value: string): string {
	return value.trim().replace(/\/$/, '').toLocaleLowerCase();
}

function songKey(song: VideoResult): string {
	return song.id || normalizeUrl(song.url) || normalizeTitle(song.title);
}

function isUsableSignal(song: VideoResult): boolean {
	return isVideoResult(song) && cleanSeedTitle(song.title).length > 0;
}

function isVideoResult(value: unknown): value is VideoResult {
	if (!value || typeof value !== 'object') return false;
	const song = value as Partial<VideoResult>;
	return typeof song.id === 'string' && song.id.length > 0 &&
		typeof song.title === 'string' && song.title.length > 0 &&
		typeof song.thumbnail === 'string' && typeof song.url === 'string';
}

function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
	return result.status === 'fulfilled';
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit)) return DEFAULT_RESULT_LIMIT;
	return Math.min(MAX_RESULT_LIMIT, Math.max(1, Math.floor(limit)));
}

function errorMessage(reason: unknown): string {
	if (reason instanceof Error && reason.message.trim()) return reason.message;
	return 'Não foi possível carregar recomendações agora.';
}
