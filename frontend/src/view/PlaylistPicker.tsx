import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ListPlus, Plus, X } from 'lucide-react';

import type { Playlist } from '../logic/useLibrary';
import type { VideoResult } from '../logic/usePlayer';

interface PlaylistPickerProps {
	song: VideoResult;
	playlists: readonly Playlist[];
	isSongInPlaylist: (playlistId: string, song: VideoResult) => boolean;
	onAdd: (playlistId: string, song: VideoResult) => void;
	onCreateAndAdd: (name: string, song: VideoResult) => boolean;
	onClose: () => void;
}

export function PlaylistPicker({
	song,
	playlists,
	isSongInPlaylist,
	onAdd,
	onCreateAndAdd,
	onClose,
}: PlaylistPickerProps) {
	const [name, setName] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [onClose]);

	const createAndAdd = (event: FormEvent) => {
		event.preventDefault();
		if (onCreateAndAdd(name, song)) onClose();
	};

	return (
		<div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
			<section
				className="playlist-picker"
				role="dialog"
				aria-modal="true"
				aria-labelledby="playlist-picker-title"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header>
					<div>
						<p className="eyebrow">SALVAR NA BIBLIOTECA</p>
						<h2 id="playlist-picker-title">Adicionar à playlist</h2>
					</div>
					<button type="button" className="dialog-close" aria-label="Fechar" onClick={onClose}><X /></button>
				</header>

				<p className="playlist-picker__song">{song.title}</p>

				<div className="playlist-picker__list">
					{playlists.length === 0 ? (
						<p className="dialog-empty">Você ainda não criou uma playlist.</p>
					) : playlists.map((playlist) => {
						const alreadyAdded = isSongInPlaylist(playlist.id, song);
						return (
							<button
								type="button"
								key={playlist.id}
								className="playlist-picker__option"
								disabled={alreadyAdded}
								onClick={() => { onAdd(playlist.id, song); onClose(); }}
							>
								<span><ListPlus /></span>
								<strong>{playlist.name}</strong>
								<small>{alreadyAdded ? <><Check /> Adicionada</> : `${playlist.songs.length} ${playlist.songs.length === 1 ? 'faixa' : 'faixas'}`}</small>
							</button>
						);
					})}
				</div>

				<form className="playlist-picker__create" onSubmit={createAndAdd}>
					<input
						ref={inputRef}
						value={name}
						onChange={(event) => setName(event.target.value)}
						maxLength={100}
						placeholder="Nome da nova playlist"
						aria-label="Nome da nova playlist"
					/>
					<button type="submit" disabled={!name.trim()}><Plus /> Criar e adicionar</button>
				</form>
			</section>
		</div>
	);
}
