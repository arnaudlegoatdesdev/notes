// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {waitFor} from '@testing-library/react';
const state = vi.hoisted(() => ({native: true, invoke: vi.fn()}));
vi.mock('../src/desktop', () => ({get isDesktop() {return state.native;}}));
vi.mock('@tauri-apps/api/core', () => ({invoke: state.invoke}));
import {externalUrl, handleNativeLinks} from '../src/external-links';
let stop = () => {};
beforeEach(() => {state.native = true; state.invoke.mockReset().mockResolvedValue(undefined);});
afterEach(() => {stop(); document.body.replaceChildren(); vi.restoreAllMocks();});
function click(href: string, options: {download?: boolean; middle?: boolean} = {}) {
  const anchor = document.createElement('a');
  anchor.href = href; anchor.target = '_blank';
  const nested = document.createElement('strong'); nested.textContent = 'Un lien'; anchor.append(nested);
  if (options.download) anchor.download = 'file.png';
  document.body.append(anchor);
  // Suppress jsdom's unrelated navigation stub after the application has processed the click.
  document.addEventListener(options.middle ? 'auxclick' : 'click', (e) => e.preventDefault(), {once: true});
  nested.dispatchEvent(new MouseEvent(options.middle ? 'auxclick' : 'click', {bubbles: true, cancelable: true, button: options.middle ? 1 : 0}));
}
describe('system browser links in both desktop apps', () => {
  it('opens nested HTTP links and middle clicks through the native command', async () => {
    stop = handleNativeLinks(vi.fn());
    click('https://example.com/page?q=test');
    await waitFor(() => expect(state.invoke).toHaveBeenCalledWith('open_external', {url:'https://example.com/page?q=test'}));
    click('https://example.com/other', {middle:true});
    await waitFor(() => expect(state.invoke).toHaveBeenCalledWith('open_external', {url:'https://example.com/other'}));
  });
  it('opens Markdown mail links and maps the presentation page to the public website, preserving downloads', async () => {
    stop = handleNativeLinks(vi.fn());
    click('mailto:hello@example.com');
    click('./privacy.html');
    click('blob:https://notes.example/file', {download:true});
    await waitFor(() => expect(state.invoke.mock.calls).toEqual(expect.arrayContaining([["open_external", {url:'mailto:hello@example.com'}], ["open_external", {url:'https://notes.flion.fr/privacy.html'}]])));
    expect(state.invoke).toHaveBeenCalledWith('open_external', {url:'https://notes.flion.fr/privacy.html'});
    expect(state.invoke).toHaveBeenCalledWith('open_external', {url:'mailto:hello@example.com'});
  });
  it('surfaces an actionable opening failure and keeps browser behavior unchanged on the web', async () => {
    const report = vi.fn(); state.invoke.mockRejectedValue(new Error('OS failure'));
    stop = handleNativeLinks(report); click('https://example.com');
    await waitFor(() => expect(report).toHaveBeenCalledWith(expect.stringContaining('navigateur par défaut')));
    stop(); state.native = false; state.invoke.mockClear();
    stop = handleNativeLinks(report); click('https://example.com');
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it('rejects executable, local file and credential-bearing schemes', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,test', 'cmd.exe /c calc', 'https://name:secret@example.com', 'https://example.com/\n']) expect(externalUrl(url)).toBeNull();
    expect(externalUrl('https://example.com/path?q=a&b=c')).toBe('https://example.com/path?q=a&b=c');
  });
});
