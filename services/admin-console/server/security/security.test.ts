import { LoginThrottle } from './loginThrottle.ts';
import { hashPassword, isPasswordHash, verifyPassword } from './passwordHash.ts';
import { SessionStore } from './sessionStore.ts';

function fakeClock(startMilliseconds = 1_000_000) {
  let now = startMilliseconds;
  return { now: () => now, advanceSeconds: (seconds: number) => (now += seconds * 1000) };
}

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const passwordHash = await hashPassword('correct-horse-battery-staple');

    expect(isPasswordHash(passwordHash)).toBe(true);
    await expect(verifyPassword('correct-horse-battery-staple', passwordHash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', passwordHash)).resolves.toBe(false);
  });

  it('never matches a malformed hash', async () => {
    await expect(verifyPassword('anything', 'plain-text')).resolves.toBe(false);
  });
});

describe('SessionStore', () => {
  it('expires a session after the idle timeout but keeps an active one', () => {
    const clock = fakeClock();
    const sessions = new SessionStore({ ttlSeconds: 3600, idleTimeoutSeconds: 60 }, clock.now);
    const session = sessions.create('operator');

    clock.advanceSeconds(50);
    expect(sessions.touch(session.id)).toBeDefined();
    clock.advanceSeconds(50);
    expect(sessions.touch(session.id)).toBeDefined();
    clock.advanceSeconds(61);
    expect(sessions.touch(session.id)).toBeUndefined();
  });

  it('expires every session at its absolute lifetime', () => {
    const clock = fakeClock();
    const sessions = new SessionStore({ ttlSeconds: 300, idleTimeoutSeconds: 200 }, clock.now);
    const session = sessions.create('operator');

    for (let minute = 0; minute < 5; minute += 1) {
      clock.advanceSeconds(60);
      sessions.touch(session.id);
    }

    expect(sessions.touch(session.id)).toBeUndefined();
  });

  it('issues unique ids and CSRF tokens and forgets deleted sessions', () => {
    const sessions = new SessionStore({ ttlSeconds: 300, idleTimeoutSeconds: 200 });
    const first = sessions.create('operator');
    const second = sessions.create('operator');

    expect(first.id).not.toBe(second.id);
    expect(first.csrfToken).not.toBe(first.id);
    sessions.delete(first.id);
    expect(sessions.touch(first.id)).toBeUndefined();
    expect(sessions.touch(undefined)).toBeUndefined();
  });
});

describe('LoginThrottle', () => {
  it('blocks a client after the limit until its oldest failure leaves the window', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(3, clock.now);

    throttle.recordFailure('10.0.0.1');
    clock.advanceSeconds(10);
    throttle.recordFailure('10.0.0.1');
    throttle.recordFailure('10.0.0.1');

    expect(throttle.retryAfterSeconds('10.0.0.1')).toBe(50);
    expect(throttle.retryAfterSeconds('10.0.0.2')).toBe(0);
    clock.advanceSeconds(51);
    expect(throttle.retryAfterSeconds('10.0.0.1')).toBe(0);
  });

  it('forgets failures after a successful sign-in', () => {
    const throttle = new LoginThrottle(1);
    throttle.recordFailure('10.0.0.1');
    throttle.reset('10.0.0.1');

    expect(throttle.retryAfterSeconds('10.0.0.1')).toBe(0);
  });
});
