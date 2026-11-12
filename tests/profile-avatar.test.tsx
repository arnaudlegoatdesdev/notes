// @vitest-environment jsdom
import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, expect, it} from "vitest";
import ProfileAvatar from "../src/components/ProfileAvatar";
import {validateUser} from "../src/session-storage";
const user = {id:"person",email:"sophie@example.com",name:"Sophie Martin"};
afterEach(cleanup);
it("uses the Google picture, falls back on the person's initials and retries a new picture", () => {
  const picture="https://lh3.googleusercontent.com/a/photo";
  const {container,rerender}=render(<ProfileAvatar user={{...user,picture}}/>);
  expect(container.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  fireEvent.error(container.querySelector('img')!); expect(container.textContent).toBe('SM');
  rerender(<ProfileAvatar user={{...user,picture:picture+'2'}}/>);
  expect(container.querySelector('img')?.src).toBe(picture+'2');
});
it("keeps valid Google photos while rejecting untrusted profile image addresses without breaking old sessions", () => {
  expect(validateUser(user)).toEqual(user);
  const picture="https://lh3.googleusercontent.com/a/photo";
  expect(validateUser({...user,picture}).picture).toBe(picture);
  for(const picture of ['https://evil.example/photo','https://googleusercontent.com.evil.example/photo','http://lh3.googleusercontent.com/photo','https://user:pass@lh3.googleusercontent.com/photo','data:image/svg+xml,test']) expect(validateUser({...user,picture}).picture).toBeUndefined();
});
