import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleWidth } from '@earendil-works/pi-tui';
import { createHarness, demoHeaders, plain } from './harness.js';

test('registers response and lifecycle handlers, and skips RPC UI', () => {
  const h = createHarness('rpc');
  assert.deepEqual([...h.handlers.keys()], ['after_provider_response', 'session_start', 'session_shutdown']);
  h.start();
  h.stop();
  assert.equal(h.state.footerCalls, 0);
});

test('renders assistant usage, cache hit rate, model, and context', t => {
  const h = createHarness();
  t.after(() => h.stop());
  h.start();
  const lines = h.state.component.render(240).map(plain);
  assert.equal(lines.length, 2);
  for (const value of ['/demo/project', '(main)', 'Rainbow demo', '↑1.2k', '↓400', 'CH88.0%', '$0.012 (sub)', '12.5%/200k', 'gpt-demo • high']) {
    assert.ok(lines[0].includes(value), `Missing ${value} in ${lines[0]}`);
  }
  assert.equal(lines[1], '....');
});

test('respects narrow terminal widths and Unicode names', t => {
  const h = createHarness();
  t.after(() => h.stop());
  h.context.sessionManager.getSessionName = () => '状态栏 🌈';
  h.start();
  assert.deepEqual(h.state.component.render(0), []);
  for (const width of [1, 2, 3, 8, 20, 40, 80, 160]) {
    for (const line of h.state.component.render(width)) {
      assert.ok(visibleWidth(line) <= width, `Line exceeds ${width} columns: ${plain(line)}`);
    }
  }
});

test('handles a missing model, missing context estimate, and an empty session', t => {
  const h = createHarness();
  t.after(() => h.stop());
  h.context.model = undefined;
  h.context.getContextUsage = () => undefined;
  h.context.sessionManager.getEntries = () => [];
  h.start();
  const line = plain(h.state.component.render(160)[0]);
  assert.ok(line.includes('no-model'));
  assert.ok(line.includes('?'));
  assert.ok(!line.includes('NaN'));
});

test('refreshes animation and releases timer and branch subscription', async t => {
  const h = createHarness();
  t.after(() => h.stop());
  h.start();
  await new Promise(resolve => setTimeout(resolve, 210));
  assert.ok(h.state.requests > 0);
  h.emit('session_shutdown');
  assert.equal(h.state.component, undefined);
  assert.equal(h.state.unsubscribes, 1);
  const requests = h.state.requests;
  await new Promise(resolve => setTimeout(resolve, 210));
  assert.equal(h.state.requests, requests);
});

test('reads mixed-case Codex quota headers and ignores unrelated responses', t => {
  const h = createHarness();
  t.after(() => h.stop());
  h.start();
  h.emit('after_provider_response', { headers: demoHeaders });
  assert.equal(plain(h.state.component.render(180)[1]), 'GPT 5h 12% ↻ 1h0m · 7d 40% ↻ 1d0h');
  assert.ok(h.state.requests > 0);
  h.emit('after_provider_response', { headers: { 'content-type': 'text/event-stream' } });
  assert.equal(plain(h.state.component.render(180)[1]), 'GPT 5h 12% ↻ 1h0m · 7d 40% ↻ 1d0h');
  h.emit('after_provider_response', { headers: { 'x-codex-primary-used-percent': 'invalid' } });
  assert.ok(!plain(h.state.component.render(180)[1]).includes('NaN'));
  assert.ok(plain(h.state.component.render(180)[1]).includes('?%'));
});
