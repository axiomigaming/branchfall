import '@fontsource/marcellus/400';
import '@fontsource/big-shoulders-display/600';
import '@fontsource/big-shoulders-display/700';
import '@fontsource/big-shoulders-display/800';
import '@fontsource/instrument-sans/400';
import '@fontsource/instrument-sans/500';
import '@fontsource/instrument-sans/600';
import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioEngine } from './audio/engine';
import { Game } from './render/game';
import { WorkerRoundService } from './service/WorkerRoundService';
import { Controller } from './state/controller';
import { useStore } from './state/store';
import { App } from './ui/App';
import { Ctl } from './ui/context';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('world') as HTMLCanvasElement;
const root = createRoot(document.getElementById('app')!);
const render = (ctl: Controller | null) =>
  root.render(
    <StrictMode>
      <Ctl.Provider value={ctl}>
        <App />
      </Ctl.Provider>
    </StrictMode>,
  );
render(null);

async function boot() {
  const store = useStore.getState();
  const quality = (params.get('q') as typeof store.settings.quality | null) ?? store.settings.quality;
  const audio = new AudioEngine();
  const service = new WorkerRoundService({ seed: params.get('seed') });
  const [game] = await Promise.all([
    Game.create(canvas, quality, (progress, label) => useStore.getState().set({ loading: { progress, label } })),
    // The session is cheap; fetch it alongside the assets.
    service.connect(),
  ]);
  const ctl = new Controller(service, game, audio);
  await ctl.connect();
  game.sounds = audio;
  window.addEventListener('resize', game.resize);
  window.visualViewport?.addEventListener('resize', game.resize);

  const apply = () => {
    const s = useStore.getState().settings;
    audio.setLevels(s);
    game.motion = s.motion;
    game.autoQuality = s.autoQuality;
    if (s.quality !== game.quality) game.applyQuality(s.quality);
  };
  game.onQualityDrop = (to) => {
    useStore.getState().setSettings({ quality: to });
    useStore.getState().toast(`Graphics lowered to ${to} to keep the run smooth.`);
  };
  useStore.subscribe((s, prev) => {
    if (s.settings !== prev.settings) apply();
  });
  apply();

  canvas.classList.add('on');
  useStore.getState().set({ phase: 'title' });
  render(ctl);
  document.body.dataset.ready = '1';
  if (import.meta.env.DEV || params.has('qa')) Object.assign(window, { __game: game, __ctl: ctl, __store: useStore });
}

boot().catch((e: unknown) => {
  console.error(e);
  useStore.getState().set({
    fatal: /WebGL|context/i.test(String(e)) ? 'This device could not start 3D graphics. Try another browser, or enable hardware acceleration.' : 'The ruins failed to load. Please reload the page.',
    phase: 'title',
  });
});
