import { animate } from 'motion';

// Icon-only controls get a handwritten label: the button's own text is
// written onto the paper just above it while hovered or focused.
export function mountInkTooltips(buttons, { isReduced = () => false } = {}) {
  const tip = document.createElement('div');
  tip.className = 'ink-tip';
  tip.setAttribute('aria-hidden', 'true');
  document.body.append(tip);
  let current = null, motion = null;
  const label = button => (button.textContent || button.getAttribute('aria-label') || '').trim();

  function show(button) {
    const text = label(button);
    if (!text) return;
    current = button;
    tip.textContent = text;
    const box = button.getBoundingClientRect();
    tip.style.left = `${box.left + box.width / 2}px`;
    tip.style.top = `${box.top - 6}px`;
    motion?.stop();
    if (isReduced()) { tip.style.opacity = '1'; tip.style.clipPath = 'none'; return; }
    // Written left to right, settling a touch like fresh ink.
    motion = animate(tip, { opacity: [0, 1], clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'], y: [3, 0] },
      { duration: .38, ease: [.22, 1, .36, 1] });
  }
  function hide(button) {
    if (button !== current) return;
    current = null;
    motion?.stop();
    if (isReduced()) { tip.style.opacity = '0'; return; }
    motion = animate(tip, { opacity: 0 }, { duration: .15, ease: 'easeIn' });
  }
  const cleanups = [...buttons].map(button => {
    const on = () => show(button), off = () => hide(button);
    button.addEventListener('pointerenter', on);
    button.addEventListener('pointerleave', off);
    button.addEventListener('focus', on);
    button.addEventListener('blur', off);
    // Labels can change while hovered (e.g. "Close conversation").
    const watcher = new MutationObserver(() => { if (current === button) tip.textContent = label(button); });
    watcher.observe(button, { subtree: true, characterData: true, childList: true });
    return () => {
      button.removeEventListener('pointerenter', on);
      button.removeEventListener('pointerleave', off);
      button.removeEventListener('focus', on);
      button.removeEventListener('blur', off);
      watcher.disconnect();
    };
  });
  return { dispose() { motion?.stop(); cleanups.forEach(fn => fn()); tip.remove(); } };
}
