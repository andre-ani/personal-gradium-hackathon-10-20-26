import { animate } from 'motion';

// Preview the 4:5 image, then post or save it. Posting uses the system share
// sheet when it can carry files; otherwise it copies the image and opens X's
// composer so it can be pasted straight in. No backend involved.
const POST_TEXT = 'I thought out loud and Cara drew it. Made with thread, powered by Gradium.';
const EASE = [.22, 1, .36, 1];
const FILE_NAME = 'thread-map.png';

function save(blob) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: FILE_NAME });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function createShareDialog({ isReduced = () => false } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'share-dialog';
  dialog.setAttribute('aria-label', 'Share your map');
  dialog.innerHTML = `
    <div class="share-card">
      <button class="share-close" type="button" aria-label="Close">×</button>
      <h2>Share your map</h2>
      <div class="share-frame"><img alt="Your map"></div>
      <p class="share-status" role="status"></p>
      <div class="share-actions">
        <button class="share-primary" type="button" data-action="post">Post on X</button>
        <button class="quiet" type="button" data-action="download">Download image</button>
      </div>
    </div>`;
  document.body.append(dialog);
  const image = dialog.querySelector('img');
  const status = dialog.querySelector('.share-status');
  const card = dialog.querySelector('.share-card');
  let still = null, url = null;
  const say = text => {
    status.textContent = text;
    if (!isReduced()) animate(status, { opacity: [0, 1] }, { duration: .35, ease: EASE });
  };

  async function post() {
    const file = new File([still], FILE_NAME, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text: POST_TEXT }); return; }
      catch (error) { if (error.name === 'AbortError') return; }
    }
    let copied = false;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': still })]); copied = true; } catch { save(still); }
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(POST_TEXT)}`, '_blank', 'noopener');
    say(copied ? 'Image copied. Paste it into the post that just opened.' : `Saved ${FILE_NAME}. Add it to the post that just opened.`);
  }
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'post') void post();
    else if (action === 'download') { save(still); say(`Saved ${FILE_NAME}.`); }
    else if (event.target === dialog || event.target.closest('.share-close')) void close();
  });
  dialog.addEventListener('close', () => { if (url) URL.revokeObjectURL(url); url = null; });

  async function close() {
    if (!isReduced()) await animate(card, { opacity: 0, y: 12 }, { duration: .22, ease: 'easeIn' });
    dialog.close();
  }

  return {
    /** Open immediately, then fill once the image is rendered. */
    async open(makeImage) {
      still = null;
      dialog.dataset.state = 'working';
      status.textContent = 'Drawing your card…';
      image.removeAttribute('src');
      dialog.querySelectorAll('[data-action]').forEach(button => { button.disabled = true; });
      dialog.showModal();
      if (!isReduced()) animate(card, { opacity: [0, 1], y: [16, 0] }, { duration: .45, ease: EASE });
      try {
        ({ still } = await makeImage());
        url = URL.createObjectURL(still);
        image.src = url;
        dialog.dataset.state = 'ready';
        dialog.querySelectorAll('[data-action]').forEach(button => { button.disabled = false; });
        say('4:5, ready to post.');
      } catch (error) {
        dialog.dataset.state = 'error';
        say(error.message || 'The image could not be made.');
      }
    },
    dispose() { dialog.remove(); },
  };
}
