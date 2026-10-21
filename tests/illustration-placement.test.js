import test from 'node:test';
import assert from 'node:assert/strict';
import { illustrationCandidates, planIllustrationPlacements } from '../frontend/illustration-layer.js';

const W = 250, H = 148;
const card = (id, x = 0, y = 0) => ({ id, x, y, width: W, height: H });
const rect = (c, p) => { const s = 160 * p.scale * .8; const x = c.x + p.dx, y = c.y + p.dy;
  return { left: x - s / 2, top: y - s / 2, right: x + s / 2, bottom: y + s / 2, area: s * s }; };
const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const cardRect = c => ({ left: c.x - c.width / 2, top: c.y - c.height / 2, right: c.x + c.width / 2, bottom: c.y + c.height / 2 });

test('placement is deterministic per node id and independent of input order', () => {
  const cards = [card('a'), card('b', 600), card('c', 0, 400), card('d', 600, 400)];
  const ids = cards.map(c => c.id);
  const first = planIllustrationPlacements(cards, ids);
  assert.deepEqual(planIllustrationPlacements([...cards].reverse(), [...ids].reverse()), first);
  assert.deepEqual(illustrationCandidates('a', W, H), illustrationCandidates('a', W, H));
  assert.notDeepEqual(illustrationCandidates('a', W, H), illustrationCandidates('b', W, H));
});

test('a still-valid previous spot is kept when neighbours change', () => {
  const cards = [card('a'), card('b', 900)];
  const before = planIllustrationPlacements(cards, ['a']);
  const after = planIllustrationPlacements([...cards, card('zz', 0, 900)], ['a', 'zz'], { previous: before });
  assert.deepEqual(after.get('a'), before.get('a'));
});

test('variety: images land all around their cards, no single spot dominates; varied rotation and scale', () => {
  const counts = { right: 0, left: 0, corner: 0, above: 0, below: 0 };
  const rotations = [], scales = [];
  for (let i = 0; i < 600; i++) {
    const p = planIllustrationPlacements([card(`node-${i}`)], [`node-${i}`]).get(`node-${i}`);
    counts[p.kind]++; rotations.push(p.rotation); scales.push(p.scale);
  }
  for (const [kind, count] of Object.entries(counts)) {
    assert.ok(count > 600 * .08, `${kind} too rare ${JSON.stringify(counts)}`);
    assert.ok(count < 600 * .4, `${kind} dominates ${JSON.stringify(counts)}`);
  }
  assert.ok(Math.min(...rotations) >= -8 && Math.max(...rotations) <= 8);
  assert.ok(Math.min(...rotations) < -6 && Math.max(...rotations) > 6);
  assert.ok(Math.min(...scales) >= .8 && Math.max(...scales) <= 1.15);
  assert.ok(Math.max(...scales) - Math.min(...scales) > .3);
});

test('images tuck close to their card but stay mostly visible under it (at most 35% covered)', () => {
  let touching = 0;
  for (let i = 0; i < 400; i++) {
    const c = card(`n${i}`, 0, 0);
    const p = planIllustrationPlacements([c], [c.id]).get(c.id);
    const r = rect(c, p);
    const share = area(r, cardRect(c)) / r.area;
    assert.ok(share <= .35 + 1e-9, `n${i} share ${share}`);
    if (share > 0) touching++;
  }
  assert.ok(touching > 100, `images should often sit close enough to touch their card (${touching})`);
});

test('crowded layouts never stack doodles, and cards cover at most ~35% of one', () => {
  for (let trial = 0; trial < 40; trial++) {
    const cards = [];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++)
      cards.push(card(`t${trial}-${row}-${col}`, col * 520, row * 420));
    const ids = cards.map(c => c.id);
    const edges = cards.slice(1).map((c, i) => ({ source: cards[i].id, target: c.id }));
    const plan = planIllustrationPlacements(cards, ids, { edges });
    const rects = ids.map(id => rect(cards.find(c => c.id === id), plan.get(id)));
    rects.forEach((r, i) => {
      assert.equal(plan.get(ids[i]).crowded, false);
      const covered = cards.reduce((sum, other) => sum + area(r, cardRect(other)), 0) / r.area;
      assert.ok(covered <= .35 + 1e-9, `covered ${covered}`);
      rects.forEach((o, j) => { if (j !== i) assert.equal(area(r, o), 0); });
    });
  }
  // A neighbour hugging the right side pushes the doodle elsewhere.
  const id = [...Array(200).keys()].map(i => `r${i}`).find(i => planIllustrationPlacements([card(i)], [i]).get(i).kind === 'right');
  const blocked = planIllustrationPlacements([card(id), card('wall', W + 60)], [id]).get(id);
  const coveredByWall = area(rect(card(id), blocked), cardRect(card('wall', W + 60))) / rect(card(id), blocked).area;
  assert.ok(coveredByWall <= .35 + 1e-9, `wall covers ${coveredByWall}`);
});

test('an arrow leaving the card steers the doodle away from its path', () => {
  const ids = [...Array(300).keys()].map(i => `e${i}`)
    .filter(i => planIllustrationPlacements([card(i)], [i]).get(i).kind === 'right').slice(0, 20);
  for (const id of ids) {
    const target = card(`${id}-t`, 700);
    const p = planIllustrationPlacements([card(id), target], [id], { edges: [{ source: id, target: target.id }] }).get(id);
    const r = rect(card(id), p);
    // The arrow runs along y=0 from the right edge (125) to the target's left edge (575).
    assert.ok(!(r.top < 0 && r.bottom > 0 && r.right > W / 2 && r.left < 575), `${id} ${p.kind}`);
  }
});
