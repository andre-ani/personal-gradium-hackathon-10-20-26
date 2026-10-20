import test from 'node:test';
import assert from 'node:assert/strict';
import { planBrushStrokes, scribbleGestures, strokeEase } from '../frontend/raster-reveal.js';

test('brush gestures stay short even when ink regions are far apart', () => {
  const points = [{x:5,y:5,angle:0}, {x:300,y:300,angle:1}, {x:20,y:15,angle:.5}];
  const strokes = planBrushStrokes(points, 'bicycle');
  assert.equal(strokes.length, points.length * 4);
  for (const stroke of strokes) {
    assert.ok(Math.hypot(stroke.x2-stroke.x1, stroke.y2-stroke.y1) <= 14.4 + 1e-9);
    assert.ok(stroke.radius >= 4.08 && stroke.radius <= 5.28);
    assert.ok([0,1,2,3].includes(stroke.pass));
  }
  for (let pass=0;pass<4;pass++) assert.equal(strokes.filter(s=>s.pass===pass).length, points.length);
});

test('replaying the same drawing is stable; different drawings get different jitter', () => {
  const points = [{x:10,y:15}, {x:15,y:18}, {x:25,y:28}];
  assert.deepEqual(planBrushStrokes(points, 'one'), planBrushStrokes(points, 'one'));
  assert.notDeepEqual(planBrushStrokes(points, 'one'), planBrushStrokes(points, 'two'));
  assert.deepEqual(planBrushStrokes([], 'empty'), []);
});


test('local return passes finish a small patch before moving to the next', () => {
  const points = Array.from({length:12}, (_,i) => ({x:i*4,y:10}));
  const gestures = scribbleGestures(planBrushStrokes(points, 'patches'), 4);
  assert.equal(gestures.length, 15);
  const firstPatch = new Set(gestures[0].map(stroke => stroke.point));
  for (let pass=0;pass<5;pass++) {
    assert.equal(gestures[pass][0].pass, pass);
    assert.deepEqual(new Set(gestures[pass].map(stroke => stroke.point)), firstPatch);
  }
  assert.ok(gestures[5].every(stroke => !firstPatch.has(stroke.point)));
  assert.deepEqual(scribbleGestures([]), []);
});

test('each gesture has a fast start and slower finish without reversal', () => {
  assert.equal(strokeEase(0), 0); assert.equal(strokeEase(1), 1);
  assert.ok(strokeEase(.25) > .5);
  assert.ok(strokeEase(.25)-strokeEase(0) > strokeEase(1)-strokeEase(.75));
  let previous=0;
  for (let i=0;i<=100;i++) { const value=strokeEase(i/100); assert.ok(value>=previous && value<=1); previous=value; }
});
