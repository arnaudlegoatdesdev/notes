// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {clearLinkPreviewCache, loadLinkPreview, messageLinkParts, parseLinkMetadata, previewUrls, publicPreviewUrl} from '../src/link-previews';
import MessageLinks from '../src/components/MessageLinks';
import type {Message} from '../src/core/types';
vi.mock('../src/desktop', () => ({isDesktop:false}));
beforeEach(() => {
  clearLinkPreviewCache();
  const values = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}});
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
const message = (text: string): Message => ({id:crypto.randomUUID(),channelId:'channel',text,createdAt:new Date().toISOString(),attachments:[],pinned:false});
describe('private link cards without a preview server', () => {
  it('extracts unique links without sentence punctuation and bounds previews per message', () => {
    const text = 'Voir (https://example.com/one), puis https://example.com/two. https://example.com/one https://other.example.org/3 https://example.com/4';
    expect(previewUrls(text)).toEqual(['https://example.com/one','https://example.com/two','https://other.example.org/3']);
    expect(messageLinkParts(text).map((p)=>p.text).join('')).toBe(text);
    expect(publicPreviewUrl('http://127.0.0.1/private')).toBeNull();
    expect(publicPreviewUrl('http://169.254.169.254/')).toBeNull();
    expect(publicPreviewUrl('http://example.local/')).toBeNull();
    expect(publicPreviewUrl('https://example.com:9000/')).toBeNull();
  });
  it('reads Open Graph, Twitter and ordinary titles without executing HTML or accepting unsafe image URLs', () => {
    const metadata = parseLinkMetadata('<head><meta content="Café &amp; thé > maintenant" property="og:title"><meta name="description" content="Une description"><meta property="og:image" content="/cover.png"><meta property="og:url" content="javascript:bad"><script>alert(1)</script></head><img src="https://tracker.example.com/x">', 'https://example.com/articles/test','https://example.com/original');
    expect(metadata).toMatchObject({url:'https://example.com/original',title:'Café & thé > maintenant',description:'Une description',imageUrl:'https://example.com/cover.png'});
    expect(parseLinkMetadata('<title>Simple &quot;title&quot;</title>', 'https://example.com').title).toBe('Simple "title"');
    expect(parseLinkMetadata('<meta property="og:image" content="http://localhost/private">', 'https://example.com').imageUrl).toBeUndefined();
    expect(parseLinkMetadata('<meta property="og:image" content="javascript:alert(1)">', 'https://example.com').imageUrl).toBeUndefined();
    expect(document.querySelector('script, img')).toBeNull();
  });
  it('uses direct CORS requests without credentials or referrers and deduplicates them', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response('<title>Une page</title>', {headers:{'Content-Type':'text/html; charset=utf-8'}}));
    vi.stubGlobal('fetch', fetcher);
    const [a,b] = await Promise.all([loadLinkPreview('https://example.com/one'),loadLinkPreview('https://example.com/one')]);
    expect(a?.title).toBe('Une page'); expect(b).toEqual(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',referrerPolicy:'no-referrer',mode:'cors'});
  });
  it('shows a usable simple card when CORS blocks access and can collapse it', async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('CORS blocked');}));
    render(<MessageLinks message={message('https://example.com/page')} onLoaded={vi.fn()} />);
    await waitFor(()=>expect(screen.queryByLabelText('Chargement de l’aperçu')).toBeNull());
    expect(screen.getByRole('link',{name:'Ouvrir la page'}).getAttribute('href')).toBe('https://example.com/page');
    fireEvent.click(screen.getByRole('button',{name:'Réduire l’aperçu du lien example.com'}));
    expect(screen.queryByRole('link',{name:'Ouvrir la page'})).toBeNull();
    expect(screen.getByRole('link',{name:'example.com'})).toBeTruthy();
  });
  it('reuses encrypted saved metadata and its image on another device without a network request', () => {
    const value = message('https://example.com/page');
    value.linkPreviews = [{url:'https://example.com/page',title:'Un livre à retrouver',description:'Mon aperçu enregistré',image:'data:image/png;base64,YQ=='}];
    const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher);
    const {container} = render(<MessageLinks message={value} onLoaded={vi.fn()} />);
    expect(screen.getByRole('link',{name:/Un livre à retrouver/})).toBeTruthy();
    expect(container.querySelector('img')?.src).toBe('data:image/png;base64,YQ==');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
