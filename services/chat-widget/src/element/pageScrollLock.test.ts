import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageScrollLock } from './pageScrollLock';

describe('PageScrollLock', () => {
  afterEach(() => {
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
  });

  it('pins the page at its scroll position and restores both on unlock', () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    document.body.style.position = 'relative';
    const lock = new PageScrollLock(document.createElement('div'));

    lock.lock();

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-640px');
    expect(document.documentElement.style.overflow).toBe('hidden');

    lock.unlock();

    expect(document.body.style.position).toBe('relative');
    expect(document.body.style.top).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
    expect(scrollTo).toHaveBeenCalledWith(0, 640);
  });

  it('ignores a second lock, so unlocking restores the original styles', () => {
    const lock = new PageScrollLock(document.createElement('div'));
    lock.lock();
    lock.lock();
    lock.unlock();
    expect(document.body.style.position).toBe('');
  });
});
