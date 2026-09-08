import { describe, it, expect, beforeAll } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import BlockEditor from '@/view/BlockEditor.vue';
import { BuiltinExtensions } from '@/extensions/builtin';
import { createImageExtension, type UploadImageHandler } from '@/index';
import { START_IMAGE_UPLOAD_METHOD } from '@/extensions/Image';

/**
 * Live progress-bar regression tests.
 *
 * Verifies that the upload overlay's progress display tracks the
 * onProgress callbacks while the upload is in flight — the symptom
 * under test is "bar jumps to 1% and freezes until the upload
 * completes".
 */

function makePctText(wrapper: ReturnType<typeof mount>): string {
  const el = wrapper.element.querySelector('.image-block-progress-pct');
  return el?.textContent ?? '(no overlay)';
}

function makeBarWidth(wrapper: ReturnType<typeof mount>): string {
  const el = wrapper.element.querySelector('.image-block-progress-bar') as HTMLElement | null;
  return el?.style.width ?? '(no bar)';
}

beforeAll(() => {
  // happy-dom may lack createObjectURL; the upload pipeline needs it for
  // the temp preview URL.
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () =>
      `blob:fake-${Math.random()}`;
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  }
});

async function mountAndStartUpload(
  upload: UploadImageHandler,
): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(BlockEditor as never, {
    props: {
      extensions: [
        ...BuiltinExtensions.filter((e) => e.name !== 'image'),
        createImageExtension({ upload }),
      ],
    },
  });
  await flushPromises();

  const editor = (wrapper.vm as { editor: unknown }).editor as {
    getExtensionMethod: (name: string) => ((f: File) => Promise<unknown>) | undefined;
  };
  const start = editor.getExtensionMethod(START_IMAGE_UPLOAD_METHOD);
  expect(typeof start).toBe('function');

  const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' });
  void start!(file);
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('image upload live progress UI', () => {
  it('tracks percent-based (0–100) onProgress callbacks in real time', async () => {
    let report!: (pct: number) => void;
    const upload: UploadImageHandler = (_n, _f, _c, onProgress) =>
      new Promise((resolve) => {
        report = onProgress;
        void resolve;
      }) as unknown as Promise<Awaited<ReturnType<UploadImageHandler>>>;

    const wrapper = await mountAndStartUpload(upload);
    expect(makePctText(wrapper)).toBe('0%');

    report(40);
    await nextTick();
    expect(makePctText(wrapper)).toBe('40%');
    expect(makeBarWidth(wrapper)).toBe('40%');

    report(80);
    await nextTick();
    expect(makePctText(wrapper)).toBe('80%');
    expect(makeBarWidth(wrapper)).toBe('80%');

    wrapper.unmount();
  });

  it('reproduces the freeze when the host reports 0–1 fractions', async () => {
    let report!: (pct: number) => void;
    const upload: UploadImageHandler = (_n, _f, _c, onProgress) =>
      new Promise((resolve) => {
        report = onProgress;
        void resolve;
      }) as unknown as Promise<Awaited<ReturnType<UploadImageHandler>>>;

    const wrapper = await mountAndStartUpload(upload);

    // Host reports event.loaded / event.total (0–1) — the editor divides
    // by 100 again, so the display rounds to 0–1% for the whole upload.
    report(0.4);
    await nextTick();
    expect(makePctText(wrapper)).toBe('0%');

    report(0.9);
    await nextTick();
    expect(makePctText(wrapper)).toBe('1%');

    wrapper.unmount();
  });
});
