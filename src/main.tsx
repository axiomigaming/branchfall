// Three families: Bungee for the gold block lettering on the plates and the wordmark, Marcellus
// SC for carved small-caps captions, Alegreya Sans (a warm humanist sans with tabular lining
// figures) for the interface text and every amount of money.
import '@fontsource/bungee/latin-400.css';
import '@fontsource/marcellus-sc/latin-400.css';
import '@fontsource/alegreya-sans/latin-500.css';
import '@fontsource/alegreya-sans/latin-700.css';
import '@fontsource/alegreya-sans/latin-800.css';
import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioEngine } from './audio/engine';
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
  const forced = params.get('q') as typeof store.settings.quality | null;
  if (forced && ['low', 'medium', 'high', 'ultra'].includes(forced)) store.setSettings({ quality: forced, autoQuality: false });
  const quality = useStore.getState().settings.quality;
  const audio = new AudioEngine();
  const service = new WorkerRoundService({ seed: params.get('seed') });
  // three.js and the world load as a separate chunk, so the title and loading bar paint first.
  const { Game } = await import('./render/game');
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
