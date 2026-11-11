// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TextAttachment from '../src/components/TextAttachment';
import FormattedMarkdown from '../src/components/FormattedMarkdown';
import { decodeTextPreview, MAX_TEXT_PREVIEW_BYTES, textPreviewKind } from '../src/text-preview';
import type { Attachment } from '../src/core/types';

const fixture = (name = 'notes.MD'): Attachment => ({id: crypto.randomUUID(), name, mime: 'application/octet-stream', size: 100, storedSize: 136});
const blob = (text: string) => new NodeBlob([text]) as unknown as Blob;
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {values.set(key, value);},
    removeItem: (key: string) => {values.delete(key);},
  });
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
describe('inline document previews', () => {
  it('formats Markdown including headings, lists, tables and fenced code without executing HTML or loading images', () => {
    const {container} = render(<FormattedMarkdown text={'# Mes notes\n\n- **Important**\n\n| Nom | État |\n| --- | --- |\n| Test | OK |\n\n```js\nconst n = 1;\n```\n\n<script>alert(1)</script>\n<iframe src="https://example.com"></iframe>\n\n![secret](https://example.com/track.png)\n\n[mauvais](javascript:alert(1)) [lien](https://example.com)'} />);
    expect(screen.getByRole('heading', {name: 'Mes notes'})).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('Important');
    expect(screen.getByRole('table')).toBeTruthy();
    expect(container.querySelector('pre code')?.textContent).toContain('const n = 1;');
    expect(container.querySelector('script, iframe, img, [onerror]')).toBeNull();
    expect(screen.queryByRole('link', {name: 'mauvais'})).toBeNull();
    expect(screen.getByRole('link', {name: 'lien'}).getAttribute('rel')).toBe('noopener noreferrer');
  });
  it('opens formatted by default, switches source, collapses and remembers that choice without reloading the file', async () => {
    const attachment = fixture(), load = vi.fn(async () => blob('# Une idée\n\nDu **texte**.'));
    render(<TextAttachment attachment={attachment} load={load} onDownload={() => {}} />);
    await screen.findByRole('heading', {name: 'Une idée'});
    fireEvent.click(screen.getByRole('button', {name: 'Afficher le texte source'}));
    expect(screen.getByRole('region').querySelector('pre')?.textContent).toContain('# Une idée');
    fireEvent.click(screen.getByRole('button', {name: 'Afficher le Markdown formaté'}));
    await screen.findByRole('heading', {name: 'Une idée'});
    fireEvent.click(screen.getByRole('button', {name: `Réduire l’aperçu de ${attachment.name}`}));
    expect(screen.queryByRole('region')).toBeNull();
    cleanup();
    render(<TextAttachment attachment={attachment} load={load} onDownload={() => {}} />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', {name: `Développer l’aperçu de ${attachment.name}`}));
    await screen.findByRole('heading', {name: 'Une idée'});
  });
  it('shows TXT as literal text and keeps download available in collapsed and error states', async () => {
    const attachment = fixture('log.txt'), download = vi.fn();
    render(<TextAttachment attachment={attachment} load={async () => blob('# Titre\n<script>rien</script>')} onDownload={download} />);
    await waitFor(() => expect(screen.getByRole('region').querySelector('pre')?.textContent).toContain('<script>rien</script>'));
    expect(screen.queryByRole('heading')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: `Réduire l’aperçu de ${attachment.name}`}));
    fireEvent.click(screen.getByRole('button', {name: `Télécharger ${attachment.name}`}));
    expect(download).toHaveBeenCalledTimes(1);
    cleanup();
    render(<TextAttachment attachment={fixture('missing.txt')} load={async () => {throw new Error('Réseau indisponible.');}} onDownload={download} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Réseau indisponible.');
    fireEvent.click(screen.getByRole('button', {name: 'Télécharger le fichier'}));
    expect(download).toHaveBeenCalledTimes(2);
  });
  it('bounds large previews and clearly offers the complete original', async () => {
    render(<TextAttachment attachment={fixture('large.txt')} load={async () => blob('x'.repeat(MAX_TEXT_PREVIEW_BYTES + 100))} onDownload={() => {}} />);
    await screen.findByRole('button', {name: 'Télécharger le fichier complet'});
    expect(screen.getByRole('region').querySelector('pre')?.textContent?.length).toBe(MAX_TEXT_PREVIEW_BYTES);
  });
  it('recognizes extensions and decodes UTF-8, UTF-16 and Windows text without exposing binary data', () => {
    expect(textPreviewKind(fixture('README.MD'))).toBe('markdown');
    expect(textPreviewKind(fixture('readme.markdown'))).toBe('markdown');
    expect(textPreviewKind(fixture('fichier.TXT'))).toBe('text');
    expect(textPreviewKind(fixture('notes.md.exe'))).toBeNull();
    expect(decodeTextPreview(new TextEncoder().encode('Été'))).toBe('Été');
    expect(decodeTextPreview(new Uint8Array([0xff, 0xfe, 0xe9, 0x00]))).toBe('é');
    expect(decodeTextPreview(new Uint8Array([0xe9]))).toBe('é');
    expect(decodeTextPreview(new Uint8Array([65, 0xc3]), true)).toBe('A');
    expect(() => decodeTextPreview(new Uint8Array([0, 65]))).toThrow('texte lisible');
  });
});
