import { Application, Window } from '@wailsio/runtime';
import {
	DownloadSong,
	GetAudioUrl,
	GetSearchSuggestions,
	GetTrayIconEnabled,
	SaveSongDialog,
	SearchVideos,
	SetTrayIconEnabled,
} from '../../bindings/music-app/internal/handlers/handler';

export class NativeCommands {
	static Minimizar = async () => {
		await Window.Minimise();
	};

	static CloseWindow = async () => {
		await Application.Quit();
	};

	static SaveSongDialog = async () => {
		return await SaveSongDialog('minha_musica');
	};

	static GetAudioUrl = async (url: string) => {
		return await GetAudioUrl(url);
	};

	static DownloadSong = async (url: string, pathName: string) => {
		await DownloadSong(url, pathName);
	};

	static WindowHide = async () => {
		await Window.Hide();
	};

	static GetSearchSuggestions = async (input: string) => {
		return await GetSearchSuggestions(input);
	};

	static GetTrayIconEnabled = async () => {
		return await GetTrayIconEnabled();
	};

	static SetTrayIconEnabled = async (enabled: boolean) => {
		await SetTrayIconEnabled(enabled);
	};

	static SearchVideos = async (query: string) => {
		return await SearchVideos(query);
	};
}
