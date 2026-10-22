import test from 'node:test';
import assert from 'node:assert/strict';
import { cardKind, cardLevels, describeHierarchy, detectSeries, isSequenceEdge } from '../frontend/card-hierarchy.js';
import { levelKindStyle, levelStyles, paperNodeStyle } from '../frontend/sketch-style.js';
import { sectionGroups, seriesHull } from '../frontend/series-wash.js';
import {
  BLOCK_GAP, BLOCK_INNER_GAP, chainSlot, needsArrangement, overlaps, placeRadialNode, planRadialLayout, SERIES_GAP, sectionBlock, sideOf, withContainsEdges,
} from '../frontend/radial-layout.js';

// "Baking cupcakes" in the shape the prompt asks for.
const nodes = [
  { id: 'root', label: 'Baking cupcakes', kind: 'topic' },
  { id: 'prep', label: 'Prep', kind: 'topic', parent_id: 'root' },
  { id: 'bake', label: 'Bake', kind: 'topic', parent_id: 'root' },
  { id: 'gather', label: 'Gather ingredients', kind: 'task', parent_id: 'prep' },
  { id: 'dry', label: 'Mix dry', kind: 'task', parent_id: 'prep' },
  { id: 'wet', label: 'Mix wet', kind: 'task', parent_id: 'prep' },
  { id: 'tip', label: 'Room-temperature eggs', kind: 'idea', parent_id: 'prep' },
  { id: 'toothpick', label: 'Toothpick test', kind: 'decision', parent_id: 'bake' },
  { id: 'detail', label: 'Clean toothpick', kind: 'topic', parent_id: 'toothpick' },
  { id: 'flavour', label: 'Vanilla or chocolate?', kind: 'question', near: 'root' },
];
const edges = [
  { id: 'e1', source: 'gather', target: 'dry', label: 'then' },
  { id: 'e2', source: 'dry', target: 'wet', label: null },
  { id: 'e3', source: 'prep', target: 'bake', label: 'then' },
  { id: 'e4', source: 'tip', target: 'wet', label: 'example' },
  { id: 'contains:root:prep', source: 'root', target: 'prep', label: 'contains' },
];

test('levels follow the parent chain; loose notes are level 3', () => {
  const levels = cardLevels(nodes);
  assert.deepEqual(Object.fromEntries(levels), { root: 1, prep: 2, bake: 2, gather: 3, dry: 3, wet: 3, tip: 3, toothpick: 3, detail: 4, flavour: 3 });
});

test('levels survive cycles, missing parents and all-loose maps', () => {
  const cyclic = cardLevels([{ id: 'a', parent_id: 'b' }, { id: 'b', parent_id: 'a' }, { id: 'c', parent_id: 'missing' }]);
  assert.ok([...cyclic.values()].every(level => level >= 1 && level <= 2));
  assert.equal(cyclic.get('c'), 1);
  const loose = cardLevels([{ id: 'x', kind: 'idea' }, { id: 'y', kind: 'idea', near: 'x' }]);
  assert.equal(loose.get('x'), 1);
  assert.equal(loose.get('y'), 3);
});

test('series: sequence-linked siblings in order; other links and cousins are not series', () => {
  assert.ok(isSequenceEdge({ label: 'then' }) && isSequenceEdge({ label: null }) && isSequenceEdge({ label: 'Next step' }));
  assert.ok(!isSequenceEdge({ label: 'example' }) && !isSequenceEdge({ id: 'contains:a:b' }));
  const series = detectSeries(nodes, edges);
  assert.deepEqual(series.map(item => item.members), [['prep', 'bake'], ['gather', 'dry', 'wet']]);
  assert.equal(series[1].parent, 'prep');
  // A "then" between cards with different parents is not a series.
  assert.deepEqual(detectSeries(nodes, [{ id: 'x', source: 'wet', target: 'toothpick', label: 'then' }]), []);
  // Order comes from the edges, not input order.
  const reversed = detectSeries([nodes[0], nodes[1], nodes[5], nodes[4], nodes[3]], edges.slice(0, 2));
  assert.deepEqual(reversed[0].members, ['gather', 'dry', 'wet']);
});

test('describeHierarchy gives each card level, kind family and step', () => {
  const { cards } = describeHierarchy(nodes, edges);
  assert.deepEqual(cards.get('dry'), { level: 3, kind: 'task', series: { key: 'series:prep:gather', index: 1, size: 3 } });
  assert.equal(cards.get('tip').series, null);
  assert.equal(cards.get('flavour').kind, 'question');
  assert.equal(cardKind('decision'), 'decision');
  assert.equal(cardKind('whatever'), 'topic');
});

test('level styles step down like headings; kinds change shape not size', () => {
  const sizes = [1, 2, 3, 4].map(level => levelStyles[level].headingFontSize);
  assert.deepEqual([...sizes].sort((a, b) => b - a), sizes);
  // Levels read through size, weight and tint, not outlines or strips.
  assert.ok(!levelStyles[1].outline && !levelStyles[2].strip && levelStyles[1].headingFontWeight > levelStyles[2].headingFontWeight);
  assert.equal(levelKindStyle(3, 'task', { index: 0, size: 3 }).marker, 'number');
  assert.equal(levelKindStyle(3, 'task', null).marker, 'checkbox');
  assert.ok(levelKindStyle(3, 'decision').cutCorner);
  assert.equal(levelKindStyle(3, 'question').cornerMark, '?');
  assert.ok(levelKindStyle(3, 'idea').paperCurl > 0 && levelKindStyle(3, 'topic').paperCurl === undefined);
  assert.equal(levelKindStyle(9, 'topic').headingFontSize, levelStyles[4].headingFontSize);
});

test('paperNodeStyle sizes and marks cards by level', () => {
  const style = level => paperNodeStyle({ id: `n${level}`, label: 'Same words', kind: 'task', level, palette: 'teal' });
  const [one, two, three, four] = [1, 2, 3, 4].map(style);
  assert.ok(one.size[0] * one.size[1] > three.size[0] * three.size[1]);
  assert.ok(three.size[0] * three.size[1] > four.size[0] * four.size[1]);
  assert.ok(two.size[0] / two.size[1] > three.size[0] / three.size[1], 'sections are wider');
  assert.equal(one.nodeVariant, 'anchor');
  assert.equal(three.cardMarker, 'checkbox');
  const step = paperNodeStyle({ id: 's', label: 'Mix dry', kind: 'task', level: 3, series: { key: 'k', index: 1, size: 3 } });
  assert.equal(step.cardStep, 2);
  // Replays without a level keep their explicit variants.
  assert.equal(paperNodeStyle({ id: 'r', label: 'x', nodeVariant: 'section' }).nodeVariant, 'section');
});

test('series hull wraps every card corner with padding and is deterministic', () => {
  const boxes = [{ x: 0, y: 0, width: 200, height: 120 }, { x: 260, y: 10, width: 180, height: 100 }, { x: 500, y: -5, width: 220, height: 130 }];
  const hull = seriesHull(boxes, { seed: 'k', pad: 20 });
  assert.equal(hull.d, seriesHull(boxes, { seed: 'k', pad: 20 }).d);
  const inside = ([px, py]) => {
    let hit = false;
    for (let i = 0, j = hull.points.length - 1; i < hull.points.length; j = i++) {
      const [xi, yi] = hull.points[i], [xj, yj] = hull.points[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  for (const box of boxes) for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    assert.ok(inside([box.x + sx * (box.width / 2 + 12), box.y + sy * (box.height / 2 + 12)]));
  }
  assert.match(hull.d, /^M.*Z$/);
  assert.equal(seriesHull([]), null);
});

test('chainSlot continues a row', () => {
  const prev = { x: 300, y: 0, width: 200, height: 100 };
  const slot = chainSlot({ prev, before: { x: 0, y: 0 }, size: { width: 200, height: 100 }, angle: 0, occupied: [], outwardOf: () => 0 });
  assert.equal(slot.y, 0);
  assert.ok(Math.abs(slot.x - (300 + 200 + SERIES_GAP)) < 1);
});

// ---- Section blocks ---------------------------------------------------------
const sized = { root: [400, 120], prep: [260, 100], bake: [220, 100], cool: [300, 100], gather: [190, 64], dry: [150, 64], wet: [150, 64], tip: [210, 64], toothpick: [190, 64], detail: [130, 48], flavour: [180, 64] };
const blockMap = () => {
  const cards = describeHierarchy(nodes, edges).cards;
  return nodes.map(node => ({ ...node, width: (sized[node.id] || [200, 80])[0], height: (sized[node.id] || [200, 80])[1], series: cards.get(node.id).series || undefined }));
};
const rect = (card, p) => ({ left: p.x - card.width / 2, right: p.x + card.width / 2, top: p.y - card.height / 2, bottom: p.y + card.height / 2 });
const clearGap = (a, b) => Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
function assertClear(list, at) {
  for (const a of list) for (const b of list) {
    if (a.id < b.id) assert.ok(!overlaps(rect(a, at.get(a.id)), rect(b, at.get(b.id))), `${a.id} overlaps ${b.id}`);
  }
}

test('ordered map: sections are columns in order; items stack tightly under their section', () => {
  const list = blockMap();
  const at = new Map(planRadialLayout(list).map(p => [p.id, p]));
  const card = new Map(list.map(item => [item.id, item]));
  const box = id => rect(card.get(id), at.get(id));
  assertClear(list, at);
  // Title on top, sections in one row left to right in series order.
  assert.ok(box('root').bottom < box('prep').top && box('root').bottom < box('bake').top);
  assert.ok(Math.abs(box('prep').top - box('bake').top) < 1, 'section tops line up');
  assert.ok(at.get('prep').x < at.get('bake').x);
  // Prep's items: one column beneath Prep, series first (gather, dry, wet), then the tip.
  const column = ['prep', 'gather', 'dry', 'wet', 'tip'];
  for (let i = 1; i < column.length; i += 1) {
    const above = box(column[i - 1]), below = box(column[i]);
    const gap = below.top - above.bottom;
    assert.ok(gap >= BLOCK_INNER_GAP[0] - 1e-6 && gap <= BLOCK_INNER_GAP[1] + 1e-6, `${column[i]} gap ${gap}`);
    assert.ok(Math.abs(at.get(column[i]).x - at.get('prep').x) <= 4, `${column[i]} sits under prep`);
  }
  // A detail is tucked beside its item, not under the column.
  assert.ok(Math.abs(at.get('detail').y - at.get('toothpick').y) < 40 && at.get('detail').x > at.get('toothpick').x);
  // Gaps inside a block are smaller than the gap between blocks.
  const block = ids => ids.map(box).reduce((a, b) => ({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }));
  const between = clearGap(block(['prep', 'gather', 'dry', 'wet', 'tip']), block(['bake', 'toothpick', 'detail']));
  assert.ok(between >= BLOCK_GAP[0] - 1e-6 && between <= BLOCK_GAP[1] + 1e-6, `block gap ${between}`);
  assert.ok(between > BLOCK_INNER_GAP[1]);
  // The loose question sits beside its anchor, clear of every card.
  assert.ok(Math.hypot(at.get('flavour').x - at.get('root').x, at.get('flavour').y - at.get('root').y) < 700);
  assert.equal(needsArrangement(list.map(item => ({ ...item, ...at.get(item.id) }))), false, 'the plan is its own arrangement');
});

test('concept map: each section clusters its items on its outward side, never in a ring', () => {
  const list = [{ id: 'garden', width: 380, height: 120 }];
  for (const section of ['soil', 'light', 'water', 'pests']) {
    list.push({ id: section, parent_id: 'garden', width: 230, height: 100 });
    for (let i = 0; i < 3; i += 1) list.push({ id: `${section}${i}`, parent_id: section, width: 170, height: 62 });
  }
  const at = new Map(planRadialLayout(list).map(p => [p.id, p]));
  assertClear(list, at);
  const title = at.get('garden');
  for (const section of ['soil', 'light', 'water', 'pests']) {
    const s = at.get(section);
    const out = [s.x - title.x, s.y - title.y];
    const side = sideOf(...out);
    for (let i = 0; i < 3; i += 1) {
      const p = at.get(`${section}${i}`);
      const d = [p.x - s.x, p.y - s.y];
      assert.ok(d[0] * out[0] + d[1] * out[1] > 0, `${section}${i} is on the outward side`);
      assert.equal(sideOf(...d), side, `${section}${i} shares its block's side`);
      assert.ok(Math.hypot(...d) < 330, `${section}${i} stays close: ${Math.hypot(...d)}`);
    }
  }
  assert.equal(needsArrangement(list.map(item => ({ ...item, ...at.get(item.id) }))), false);
});

test('sectionBlock: stacks in series order, mirrors for the left and keeps reading order above', () => {
  const section = { id: 's', width: 200, height: 100 };
  const items = ['a', 'b', 'c'].map((id, index) => ({ id, parent_id: 's', width: 150, height: 60, series: { key: 'k', index: 2 - index, size: 3 } }));
  const childrenOf = new Map([['s', items]]);
  const down = sectionBlock(section, childrenOf, 'down');
  assert.deepEqual([...down.offsets.keys()], ['c', 'b', 'a'], 'series order, not input order');
  const left = sectionBlock(section, childrenOf, 'left');
  const right = sectionBlock(section, childrenOf, 'right');
  for (const id of ['a', 'b', 'c']) {
    assert.ok(right.offsets.get(id).x > 0 && Math.abs(left.offsets.get(id).x + right.offsets.get(id).x) < 1e-6);
  }
  const up = sectionBlock(section, childrenOf, 'up');
  assert.ok(up.offsets.get('c').y < up.offsets.get('b').y && up.offsets.get('a').y < -50, 'first step on top, all above');
  const many = new Map([['s', Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, width: 150, height: 60 }))]]);
  assert.equal(new Set([...sectionBlock(section, many, 'right').offsets.values()].map(p => Math.round(p.x / 50))).size > 1, true, 'many items use two columns');
  assert.equal(new Set([...sectionBlock(section, many, 'down', { grid: false }).offsets.values()].map(p => Math.round(p.x / 10))).size <= 2, true, 'ordered blocks stay one column');
});

test('live placement drops new items into their block slot; drift and overlaps ask for a glide', () => {
  const list = blockMap().filter(item => item.id !== 'flavour');
  const planned = new Map(planRadialLayout(list).map(p => [p.id, p]));
  // Sections and the title already sit in their columns; items arrive one by one.
  const placed = list.filter(item => !item.parent_id || item.parent_id === 'root').map(item => ({ ...item, ...planned.get(item.id) }));
  for (const item of list.filter(item => item.parent_id && item.parent_id !== 'root')) {
    const before = placed.map(({ id, x, y }) => [id, x, y]);
    placed.push({ ...item, ...placeRadialNode(item, placed) });
    assert.deepEqual(placed.slice(0, -1).map(({ id, x, y }) => [id, x, y]), before, 'placed cards never move');
  }
  for (const item of placed) {
    assert.ok(Math.hypot(item.x - planned.get(item.id).x, item.y - planned.get(item.id).y) < 1, `${item.id} at its slot`);
  }
  assert.equal(needsArrangement(placed), false);
  assert.equal(needsArrangement(placed.map(item => (item.id === 'dry' ? { ...item, x: item.x + 90 } : item))), true, 'drifted item');
  assert.equal(needsArrangement(placed.map(item => (item.id === 'bake' ? { ...item, x: item.x - 140 } : item))), true, 'section out of its column');
  const wet = placed.find(item => item.id === 'wet');
  assert.equal(needsArrangement(placed.map(item => (item.id === 'tip' ? { ...item, y: wet.y + 10 } : item))), true, 'overlap');
});

test('containment arrows: title to section stays; none inside a block; order arrows stay', () => {
  const cards = [
    { id: 'root' }, { id: 'prep', parent_id: 'root' }, { id: 'bake', parent_id: 'root' },
    { id: 'gather', parent_id: 'prep' }, { id: 'dry', parent_id: 'prep' }, { id: 'tip', parent_id: 'prep' }, { id: 'egg', parent_id: 'dry' },
  ];
  const links = [
    { id: 'order', source: 'prep', target: 'bake', label: 'then' },
    { id: 'step', source: 'gather', target: 'dry', label: 'then' },
    { id: 'explicit', source: 'prep', target: 'tip', label: 'contains' },
    { id: 'plain', source: 'prep', target: 'dry' },
    { id: 'why', source: 'tip', target: 'dry', label: 'example' },
  ];
  const ids = withContainsEdges(cards, links).map(edge => edge.id);
  assert.deepEqual(ids.sort(), ['contains:root:bake', 'contains:root:prep', 'order', 'step', 'why'].sort());
  // Unordered items: no arrows inside the block at all.
  assert.deepEqual(withContainsEdges(cards, []).map(edge => edge.id).sort(), ['contains:root:bake', 'contains:root:prep']);
  // Roles still see every containment link.
  const all = withContainsEdges(cards, links, 'radial', { grouped: false }).map(edge => edge.id);
  assert.ok(all.includes('contains:prep:gather') && all.includes('contains:dry:egg') && all.includes('explicit'));
});

test('section fields: one per section with children, covering its whole block', () => {
  const groups = sectionGroups(nodes);
  assert.deepEqual(groups.map(group => group.key), ['section:prep', 'section:bake']);
  assert.deepEqual(groups[1].members, ['bake', 'toothpick', 'detail']);
  assert.ok(groups[0].members.includes('tip') && !groups[0].members.includes('flavour'));
  const list = blockMap();
  const at = new Map(planRadialLayout(list).map(p => [p.id, p]));
  const card = new Map(list.map(item => [item.id, item]));
  const hulls = groups.map(group => seriesHull(group.members.map(id => ({ ...at.get(id), width: card.get(id).width, height: card.get(id).height })), { seed: group.key, pad: 24 }));
  const inside = (points, [px, py]) => {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const corners = id => {
    const b = rect(card.get(id), at.get(id));
    return [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]];
  };
  groups.forEach((group, index) => {
    for (const id of group.members) for (const corner of corners(id)) assert.ok(inside(hulls[index].points, corner), `${group.key} covers ${id}`);
    // A field never reaches into another block or onto the title.
    for (const other of ['root', ...groups.filter(item => item !== group).flatMap(item => item.members)]) {
      for (const corner of corners(other)) assert.ok(!inside(hulls[index].points, corner), `${group.key} stays off ${other}`);
    }
  });
});

test('type scale: title, section, item, detail step down in font, weight, size and tint', () => {
  assert.deepEqual([1, 2, 3, 4].map(level => levelStyles[level].headingFontSize), [44, 32, 19, 15]);
  const weights = [1, 2, 3].map(level => levelStyles[level].headingFontWeight);
  assert.ok(weights[0] > weights[1] && weights[1] > weights[2] && weights[1] >= 600);
  const style = level => paperNodeStyle({ id: 'same', label: 'Mix the dry ingredients', kind: 'topic', level, palette: 'teal' });
  const area = s => s.size[0] * s.size[1];
  const [one, two, three, four] = [1, 2, 3, 4].map(style);
  assert.ok(area(one) > area(two) && area(two) > area(three) * 1.5 && area(three) > area(four), 'items clearly smaller than sections');
  for (const s of [one, two, three, four]) {
    const look = levelStyles[s.cardLevel];
    assert.ok(s.size[0] >= look.minSize[0] && s.size[0] <= look.maxSize[0] && s.size[1] <= look.maxSize[1], `level ${s.cardLevel} within limits`);
  }
  // Items wear a lighter tint of the section colour; details lighter still.
  const depth = fill => [1, 3, 5].reduce((sum, i) => sum + (255 - parseInt(fill.slice(i, i + 2), 16)), 0);
  assert.ok(depth(two.fill) > depth(three.fill) && depth(three.fill) > depth(four.fill), `${two.fill} ${three.fill} ${four.fill}`);
  // Numbered steps keep their sticker marker.
  assert.equal(paperNodeStyle({ id: 'n', label: 'Mix', kind: 'topic', level: 3, series: { key: 'k', index: 0, size: 2 } }).cardMarker, 'number');
});
