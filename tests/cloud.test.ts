import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleConnection } from '../src/cloud/google';
import { OneDriveConnection } from '../src/cloud/onedrive';
import { cloudFetch } from '../src/cloud/http';
import { CloudError } from '../src/cloud/types';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Google Drive immutable files', () => {
  it('reads every appdata page and requests only the app folder', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ files: [{ id: 'a', name: 'a.flion', size: '21' }], nextPageToken: 'page2' }))
      .mockResolvedValueOnce(json({ files: [{ id: 'b', name: 'b.flion', size: '42' }] }));
    vi.stubGlobal('fetch', fetcher);
    const files = await new GoogleConnection('private-token', 3600).list();
    expect(files).toEqual([{ id: 'a', name: 'a.flion', size: 21 }, { id: 'b', name: 'b.flion', size: 42 }]);
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('spaces')).toBe('appDataFolder');
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('pageToken')).toBe('page2');
  });

  it('never overwrites an existing immutable object', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ files: [{ id: 'existing', name: 'snapshot.flion', size: '12' }] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(new GoogleConnection('private-token', 3600).create('snapshot.flion', new Uint8Array([1]))).rejects.toMatchObject({ code: 'collision' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('creates encrypted bytes through a resumable session in appdata', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ files: [] }))
      .mockResolvedValueOnce(new Response('', { headers: { Location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(json({ id: 'new-id', name: 'new.flion', size: '3' }))
      .mockResolvedValueOnce(json({ files: [{ id: 'new-id', name: 'new.flion', size: '3' }] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await new GoogleConnection('private-token', 3600).create('new.flion', new Uint8Array([2, 3, 4]))).toEqual({ id: 'new-id', name: 'new.flion', size: 3 });
    expect(JSON.parse(fetcher.mock.calls[1][1].body).parents).toEqual(['appDataFolder']);
    expect(new Uint8Array(fetcher.mock.calls[2][1].body)).toEqual(new Uint8Array([2, 3, 4]));
  });

  it('keeps unlimited account quota distinct from a zero-byte quota', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ storageQuota: { usage: '123' } })));
    expect(await new GoogleConnection('private-token', 3600).quota()).toEqual({ used: 123, total: undefined });
  });

  it('discards a disconnected token and never makes another request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const connection = new GoogleConnection('private-token', 3600);
    await connection.disconnect();
    await expect(connection.read('item')).rejects.toMatchObject({ code: 'auth' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('OneDrive app folder', () => {
  it('follows pagination and ignores child folders', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ id: 'app-folder' }))
      .mockResolvedValueOnce(json({ value: [{ id: 'folder', name: 'folder', folder: {} }, { id: 'a', name: 'a.flion', size: 10, file: {} }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' }))
      .mockResolvedValueOnce(json({ value: [{ id: 'b', name: 'b.flion', size: 20, file: {} }] }));
    vi.stubGlobal('fetch', fetcher);
    const connection = new OneDriveConnection('private-token', 3600);
    await connection.initialize('person@example.com');
    expect(await connection.list()).toEqual([{ id: 'a', name: 'a.flion', size: 10 }, { id: 'b', name: 'b.flion', size: 20 }]);
  });

  it('requests a signed download URL and does not leak the bearer to its host', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ '@microsoft.graph.downloadUrl': 'https://files.1drv.com/private-download' }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5])));
    vi.stubGlobal('fetch', fetcher);
    expect(await new OneDriveConnection('private-token', 3600).read('file-id')).toEqual(new Uint8Array([4, 5]));
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer private-token');
    expect(fetcher.mock.calls[1][1].headers).toBeUndefined();
  });

  it('uploads chunks with fail-on-conflict and never sends the bearer to upload URLs', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ id: 'app-folder' }))
      .mockResolvedValueOnce(json({ value: [] }))
      .mockResolvedValueOnce(json({ uploadUrl: 'https://files.1drv.com/private-upload' }))
      .mockResolvedValueOnce(json({ nextExpectedRanges: ['3276800-'] }, 202))
      .mockResolvedValueOnce(json({ id: 'file-id', name: 'large.flion', size: 3_276_801 }, 201));
    vi.stubGlobal('fetch', fetcher);
    const connection = new OneDriveConnection('private-token', 3600);
    await connection.initialize('person@example.com');
    expect(await connection.create('large.flion', new Uint8Array(3_276_801))).toEqual({ id: 'file-id', name: 'large.flion', size: 3_276_801 });
    expect(JSON.parse(fetcher.mock.calls[2][1].body).item['@microsoft.graph.conflictBehavior']).toBe('fail');
    expect(fetcher.mock.calls[3][1].headers).toEqual({ 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 0-3276799/3276801' });
    expect(fetcher.mock.calls[4][1].headers['Content-Range']).toBe('bytes 3276800-3276800/3276801');
    expect(fetcher.mock.calls[4][1].headers.Authorization).toBeUndefined();
  });

  it('reports unavailable whole-drive quota without requesting broader rights', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code: 'accessDenied' } }, 403)));
    expect(await new OneDriveConnection('private-token', 3600).quota()).toBeNull();
  });
});

describe('cloud failures', () => {
  it.each([
    [403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } }],
    [507, { error: { code: 'quotaLimitReached' } }],
  ])('distinguishes provider storage saturation (%s)', async (status, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body, status)));
    await expect(cloudFetch('https://example.com')).rejects.toMatchObject({ code: 'quota', status });
  });

  it('turns network failures into a readable recoverable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network internals')));
    await expect(cloudFetch('https://example.com')).rejects.toBeInstanceOf(CloudError);
    await expect(cloudFetch('https://example.com')).rejects.toMatchObject({ code: 'offline' });
  });
});
