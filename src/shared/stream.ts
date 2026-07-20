// The one streaming primitive everything else builds on. Deliberately tiny:
// a typed emitter, nothing more. Every layer boundary in ARCHITECTURE.md is
// "a Stream of X" — audio frames, transcript events, text events.

export type Unsubscribe = () => void;

export interface Stream<T> {
  subscribe(listener: (value: T) => void): Unsubscribe;
}

export class Emitter<T> implements Stream<T> {
  private listeners = new Set<(value: T) => void>();

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of this.listeners) listener(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
