import { afterEach, describe, expect, it } from 'vitest';
import { placeBelow, popupViewport } from '@/view/ui/popup';

const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
const originalClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
const originalClientHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight');

function setLayoutViewport(width: number, height: number): void {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height });
}

function setVisualViewport(viewport: Partial<VisualViewport> | undefined): void {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  });
}

afterEach(() => {
  if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport);
  else delete (window as Window & { visualViewport?: VisualViewport }).visualViewport;
  if (originalClientWidth) Object.defineProperty(document.documentElement, 'clientWidth', originalClientWidth);
  else delete (document.documentElement as HTMLElement & { clientWidth?: number }).clientWidth;
  if (originalClientHeight) Object.defineProperty(document.documentElement, 'clientHeight', originalClientHeight);
  else delete (document.documentElement as HTMLElement & { clientHeight?: number }).clientHeight;
});

describe('popup viewport positioning', () => {
  it('uses the visual viewport height when the keyboard reduces the visible area', () => {
    setLayoutViewport(390, 844);
    setVisualViewport({ offsetLeft: 0, offsetTop: 0, width: 390, height: 420 });

    const placement = placeBelow(
      document.body,
      new DOMRect(20, 330, 40, 36),
      { width: 260, height: 280 },
    );

    expect(placement.above).toBe(true);
    expect(placement.top).toBe(44);
    expect(placement.bottom).toBe(324);
    expect(popupViewport().bottom).toBe(420);
  });

  it('keeps popup coordinates inside a panned visual viewport', () => {
    setLayoutViewport(844, 1180);
    setVisualViewport({ offsetLeft: 120, offsetTop: 180, width: 390, height: 500 });

    const placement = placeBelow(
      document.body,
      new DOMRect(150, 230, 40, 36),
      { width: 200, height: 120 },
    );

    expect(placement.top).toBe(272);
    expect(placement.left).toBe(150);
    expect(placement.above).toBe(false);
    expect(placement.bottom).toBe(392);
  });
});
