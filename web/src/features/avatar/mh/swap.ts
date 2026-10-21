/**
 * The characters a stage holds, by instance: the one on screen and the one
 * assembling off screen to replace it. Callbacks name the instance they come
 * from, so a late one from an instance that was unmounted, or from a character
 * the stage has moved past, changes nothing. Browsing faces back and forth
 * remounts the same character key; only its live instance may be promoted.
 */
export class StageSwap<T extends object> {
  private requested: string | null = null;
  private swapping = false;
  private incoming: T | null = null;
  private onScreen: T | null = null;
  /** The character key each instance has settled for; absent while it (re)loads. */
  private readonly settled = new WeakMap<T, string>();

  /** The stage committed: the key its config asks for, and whether it is still swapping to it. */
  request(key: string | null, swapping: boolean): void {
    this.requested = key;
    this.swapping = swapping;
  }

  /** The incoming slot's mounted instance (null once it unmounts or is promoted). */
  setIncoming(instance: T | null): void {
    this.incoming = instance;
  }

  /** The on-screen slot's mounted instance (null while none is mounted). */
  setOnScreen(instance: T | null): void {
    this.onScreen = instance;
  }

  settle(instance: T, key: string): void {
    this.settled.set(instance, key);
  }

  unsettle(instance: T): void {
    this.settled.delete(instance);
  }

  /**
   * Whether a settled instance may replace the character on screen: it is the
   * incoming instance mounted now, and its character is still the one asked for.
   */
  canPromote(instance: T, key: string): boolean {
    return (
      instance === this.incoming && key === this.requested && this.settled.get(instance) === key
    );
  }

  /** The character on screen is the one the config asks for, with skin, hair and clothes on. */
  get caughtUp(): boolean {
    return (
      !this.swapping &&
      this.requested !== null &&
      this.onScreen !== null &&
      this.settled.get(this.onScreen) === this.requested
    );
  }
}
