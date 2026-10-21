import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CardWords, chooseCardLayout, diffWords, estimateCardSize, layoutCard, planWordMotion, wrapWords, WORD_EXIT,
} from '../frontend/card-text.js';

// Deterministic metrics: every character is half the font size wide.
const measure = (text, font) => text.length * font.size * 0.5;
const headingFont = { size: 26, family: 'Patrick Hand' };
const bodyFont = { size: 13, family: 'Patrick Hand' };
const card = (overrides) => layoutCard({ width: 280, height: 134, padding: 20, hasIcon: true, headingFont, bodyFont, measure, ...overrides });

test('layout choice: sparse for short headings, rich once body text arrives', () => {
  assert.equal(chooseCardLayout({ heading: 'Making tea' }), 'sparse');
  assert.equal(chooseCardLayout({ heading: 'Making tea', body: 'A small job.' }), 'rich');
  assert.equal(chooseCardLayout({ heading: 'A heading that keeps on going for a while' }), 'rich');
});

test('layout choice has hysteresis between the thresholds', () => {
  const middling = 'Tea bags near kettle';
  assert.equal(chooseCardLayout({ heading: middling + ' too', previous: 'rich' }), 'rich');
  assert.equal(chooseCardLayout({ heading: middling + ' too', previous: 'sparse' }), 'sparse');
  assert.equal(chooseCardLayout({ heading: 'Tea', previous: 'rich' }), 'sparse');
});

test('wrapWords breaks greedily on measured widths and ellipsizes overflow', () => {
  const font = { size: 10 };
  const lines = wrapWords('aaaa bbbb cccc dddd', { maxWidth: 50, measure, font });
  assert.deepEqual(lines.map((line) => line.words.map((word) => word.text)), [['aaaa', 'bbbb'], ['cccc', 'dddd']]);
  assert.deepEqual(lines[0].words.map((word) => word.x), [0, 25]);
  const cut = wrapWords('aaaa bbbb cccc dddd', { maxWidth: 50, measure, font, maxLines: 1 });
  assert.equal(cut.length, 1);
  assert.equal(cut[0].words.at(-1).text.endsWith('…'), true);
  assert.ok(cut[0].width <= 50);
});

test('sparse layout centres the icon above a centred heading', () => {
  const layout = card({ mode: 'sparse', heading: 'Making tea' });
  assert.ok(layout.icon);
  assert.equal(layout.icon.x + layout.icon.size / 2, 140);
  const words = layout.words;
  const left = words[0].x;
  const right = words.at(-1).x + words.at(-1).width;
  assert.ok(Math.abs((left + right) / 2 - 140) < 0.2);
  assert.ok(words[0].y > layout.icon.y + layout.icon.size);
});

test('rich layout puts a smaller heading top-left beside the icon and body below', () => {
  const sparse = card({ mode: 'sparse', heading: 'Making tea' });
  const rich = card({ mode: 'rich', heading: 'Making tea', body: 'A very small job reveals the search.' });
  const heading = rich.words.filter((word) => word.role === 'heading');
  const body = rich.words.filter((word) => word.role === 'body');
  assert.ok(heading[0].font.size < sparse.words[0].font.size);
  assert.equal(rich.icon.x, 20);
  assert.ok(heading[0].x > rich.icon.x + rich.icon.size);
  assert.equal(body[0].x, 20);
  assert.ok(body[0].y > heading[0].y);
});

test('diff keeps unchanged words and replaces moved or edited ones', () => {
  const before = card({ mode: 'rich', heading: 'Making tea', body: 'A small job.' });
  const same = card({ mode: 'rich', heading: 'Making tea', body: 'A small job.' });
  assert.deepEqual(diffWords(before.words, same.words).enter, []);
  const relabel = card({ mode: 'rich', heading: 'Making coffee', body: 'A small job.' });
  const diff = diffWords(before.words, relabel.words);
  assert.deepEqual(diff.leave.map((word) => word.text), ['tea']);
  assert.deepEqual(diff.enter.map((word) => word.text), ['coffee']);
  assert.equal(diff.stay.length, before.words.length - 1);
  // A layout switch moves every heading word, so they all leave and re-enter.
  const sparse = card({ mode: 'sparse', heading: 'Making tea' });
  assert.equal(diffWords(sparse.words, before.words).stay.length, 0);
});

test('motion plan: leavers sink one by one, then enterers rise one by one', () => {
  const words = (texts) => texts.map((text) => ({ key: text }));
  const plan = planWordMotion({ leave: words(['a', 'b', 'c']), enter: words(['x', 'y']) });
  const leaveDelays = plan.leave.map((item) => item.delay);
  assert.deepEqual(leaveDelays, [...leaveDelays].sort((a, b) => a - b));
  assert.ok(leaveDelays[1] > 0);
  assert.equal(plan.enter[0].delay, leaveDelays.at(-1) + WORD_EXIT.duration);
  const step = plan.enter[1].delay - plan.enter[0].delay;
  assert.ok(step >= 40 && step <= 70);
  assert.equal(planWordMotion({ enter: words(['x']) }).enter[0].delay, 0);
});

test('CardWords leaves unchanged words alone on unrelated redraws', () => {
  const created = [];
  const removed = [];
  const words = new CardWords({
    createText: (style) => { const shape = { style, attr(next) { Object.assign(this.style, next); } }; created.push(shape); return shape; },
    removeText: (shape) => removed.push(shape),
    reducedMotion: () => true,
  });
  const layout = card({ mode: 'rich', heading: 'Making tea', body: 'A small job.' });
  words.sync(layout.words, { opacity: 0.5 });
  const count = created.length;
  words.sync(layout.words, { opacity: 0.86 });
  assert.equal(created.length, count);
  assert.equal(removed.length, 0);
  assert.equal(created[0].style.opacity, 0.86);
  words.sync(card({ mode: 'rich', heading: 'Making coffee', body: 'A small job.' }).words);
  assert.equal(created.length, count + 1);
  assert.equal(removed.length, 1);
  words.destroy();
});

const sizing = { minSize: [140, 110], maxSize: [380, 270], sparseMaxWidth: 260, hasIcon: true, headingFont: { size: 24, family: 'Patrick Hand' }, bodyFont, measure };
const aspect = ([width, height]) => width / height;
const longBody = 'Mug, kettle, tea bag, spoon, maybe milk — spread across corners means a little tour each morning. '.repeat(3);

test('a short sparse heading gives a compact, near-square card', () => {
  for (const heading of ['Tea', 'Making tea', 'Kettle on now']) {
    const size = estimateCardSize({ ...sizing, heading });
    assert.ok(aspect(size) >= 1 && aspect(size) <= 4 / 3 + 0.01, `${heading}: ${size}`);
    assert.ok(size[0] >= 140 && size[0] <= 260, `${heading}: ${size}`);
  }
  assert.deepEqual(estimateCardSize({ ...sizing, heading: 'Tea' }), [140, 110]);
  // Width follows the measured heading.
  assert.ok(estimateCardSize({ ...sizing, heading: 'Making tea' })[0] < estimateCardSize({ ...sizing, heading: 'Kettle on now' })[0]);
});

test('a longer sparse heading wraps before the card grows wide', () => {
  const heading = 'Steeping tea leaves';
  const [width, height] = estimateCardSize({ ...sizing, heading });
  assert.ok(width <= 260);
  assert.ok(aspect([width, height]) <= 4 / 3 + 0.01);
  const layout = layoutCard({ width, height, mode: 'sparse', heading, hasIcon: true, headingFont: sizing.headingFont, bodyFont, measure });
  assert.equal(new Set(layout.words.map((word) => word.y)).size, 2);
  assert.equal(layout.words.map((word) => word.text).join(' '), heading);
});

test('long body text gives a wider card with a balanced text block', () => {
  const sparse = estimateCardSize({ ...sizing, heading: 'Tea kit' });
  const size = estimateCardSize({ ...sizing, heading: 'Tea kit', body: longBody });
  assert.ok(size[0] > sparse[0] && size[1] > sparse[1]);
  assert.ok(aspect(size) >= 1.3 && aspect(size) <= 1.65, String(size));
  assert.ok(size[0] <= 380 && size[1] <= 270);
  const layout = layoutCard({ width: size[0], height: size[1], mode: 'rich', heading: 'Tea kit', body: longBody, hasIcon: true, headingFont: sizing.headingFont, bodyFont, measure });
  assert.ok(layout.contentHeight <= size[1] + 0.5);
  assert.equal(layout.words.filter((word) => word.role === 'body').at(-1).text.endsWith('…'), false);
  // A sentence of body stays smaller than a paragraph.
  const short = estimateCardSize({ ...sizing, heading: 'Tea kit', body: 'A small job.' });
  assert.ok(short[0] < size[0]);
  assert.ok(aspect(short) >= 1.2 && aspect(short) <= 1.65, String(short));
});

test('sizes are deterministic and the wobble never squeezes the text', () => {
  const args = { ...sizing, heading: 'Making tea', wobble: [0.95, 0.95] };
  assert.deepEqual(estimateCardSize(args), estimateCardSize(args));
  const plain = estimateCardSize({ ...sizing, heading: 'Making tea' });
  const wide = estimateCardSize({ ...args, wobble: [1.05, 1.05] });
  assert.ok(wide[0] > plain[0] && wide[1] > plain[1]);
  const narrow = estimateCardSize(args);
  const layout = layoutCard({ width: narrow[0], height: narrow[1], mode: 'sparse', heading: 'Making tea', hasIcon: true, headingFont: sizing.headingFont, bodyFont, measure });
  assert.equal(layout.words.length, 2);
});

test('variant scale keeps bigger fonts on bigger cards', () => {
  const anchor = estimateCardSize({ ...sizing, minSize: [200, 150], sparseMaxWidth: 340, headingFont: { size: 32, family: 'Patrick Hand' }, heading: 'Morning' });
  const annotation = estimateCardSize({ ...sizing, minSize: [120, 90], sparseMaxWidth: 220, headingFont: { size: 18, family: 'Patrick Hand' }, heading: 'Morning' });
  assert.ok(anchor[0] > annotation[0] && anchor[1] > annotation[1]);
});
