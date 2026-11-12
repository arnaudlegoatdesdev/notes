// @vitest-environment jsdom
import {cleanup, render, screen, act} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, expect, it, vi} from "vitest";
import {useChatFileDrop, readNativeDroppedFile} from "../src/file-drop";
const native=vi.hoisted(()=>({listen:vi.fn(),invoke:vi.fn()}));
vi.mock('../src/desktop',()=>({isDesktop:true}));
vi.mock('@tauri-apps/api/webview',()=>({getCurrentWebview:()=>({onDragDropEvent:native.listen})}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
it('handles native file drops using physical coordinates, ignores outside drops, and disposes its listener',async()=>{
  const release=vi.fn(),paths=vi.fn();native.listen.mockResolvedValue(release);
  function Host(){const target=useRef<HTMLElement>(null);const hover=useChatFileDrop({target,enabled:true,files:vi.fn(),paths,error:vi.fn()});return <main ref={target}>Chat{hover&&<span>Déposer</span>}</main>;}
  const {container,unmount}=render(<Host/>);
  const hit=vi.fn(()=>container.querySelector('main')!);
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:hit});
  vi.stubGlobal('devicePixelRatio',2);
  await act(async()=>{await Promise.resolve();});
  const handler=native.listen.mock.calls[0][0];
  await act(async()=>handler({payload:{type:'enter',position:{x:400,y:300},paths:['/tmp/photo.png']}}));
  expect(hit).toHaveBeenLastCalledWith(200,150);expect(screen.getByText('Déposer')).toBeTruthy();
  await act(async()=>handler({payload:{type:'drop',position:{x:400,y:300},paths:['/tmp/photo.png']}}));
  expect(paths).toHaveBeenCalledWith(['/tmp/photo.png']);expect(screen.queryByText('Déposer')).toBeNull();
  vi.spyOn(navigator,'platform','get').mockReturnValue('MacIntel');
  await act(async()=>handler({payload:{type:'over',position:{x:400,y:300}}}));
  expect(hit).toHaveBeenLastCalledWith(400,300);
  hit.mockReturnValue(document.body as HTMLElement);
  await act(async()=>handler({payload:{type:'drop',position:{x:10,y:10},paths:['/tmp/ignored.png']}}));
  expect(paths).toHaveBeenCalledOnce();unmount();expect(release).toHaveBeenCalledOnce();
});
it('reads the native binary response without JSON byte expansion and retains Windows filenames and image types',async()=>{
  native.invoke.mockResolvedValue(new Uint8Array([1,2,3]).buffer);
  const file=await readNativeDroppedFile('C:\\Photos\\photo.JPG');
  expect(file.name).toBe('photo.JPG');expect(file.type).toBe('image/jpeg');expect(file.size).toBe(3);
  expect(native.invoke).toHaveBeenCalledWith('read_dropped_file',{path:'C:\\Photos\\photo.JPG'});
});
