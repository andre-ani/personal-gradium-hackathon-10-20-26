import { animate } from 'motion';

// G6 owns camera coordinates; Motion only interpolates between valid fits.
export function createViewportMotion(graph, reducedMotion, animateDriver = animate) {
  let stop = () => {};
  let generation = 0;
  const cancel = () => { generation++; stop(); };
  const element = document.getElementById('graph');
  element.addEventListener('pointerdown', cancel);
  element.addEventListener('wheel', cancel, { passive: true });

  return {
    async fit(options = {}) {
      cancel();
      const current = generation;
      const from = { zoom: graph.getZoom(), position: graph.getPosition() };
      await graph.fitView(options, false);
      if (current !== generation || reducedMotion()) return;
      const to = { zoom: graph.getZoom(), position: graph.getPosition() };
      if (Math.abs(from.zoom - to.zoom) < .001 && from.position.every((v, i) => Math.abs(v - to.position[i]) < 1)) return;
      await graph.zoomTo(from.zoom, false);
      if (current !== generation) return;
      await graph.translateTo(from.position, false);
      if (current !== generation) return;
      let latest = 0, applied = -1, pending = null, failure = null;
      const apply = () => {
        if (pending || failure) return;
        pending = (async () => {
          while (current === generation && applied !== latest) {
            const progress = latest;
            applied = progress;
            await graph.zoomTo(from.zoom + (to.zoom - from.zoom) * progress, false);
            if (current !== generation) return;
            await graph.translateTo(from.position.map((v, i) => v + (to.position[i] - v) * progress), false);
          }
        })().catch(error => {
          failure = error;
          stop();
        }).finally(() => { pending = null; });
      };
      await new Promise(resolve => {
        const controls = animateDriver(0, 1, {
          duration: .24, ease: [.22, 1, .36, 1],
          onUpdate: value => { latest = value; apply(); },
          onComplete: () => { latest = 1; apply(); resolve(); },
        });
        stop = () => { controls.stop(); resolve(); };
      });
      if (pending) await pending;
      if (failure) throw failure;
    },
    cancel,
    dispose() {
      cancel();
      element.removeEventListener('pointerdown', cancel);
      element.removeEventListener('wheel', cancel);
    },
  };
}
