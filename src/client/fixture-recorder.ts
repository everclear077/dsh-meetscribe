/** Disabled diagnostic recorder retained as a no-op boundary for the derived ASR engine. */
export const fixtureRecorder = {
  isActive: false,
  begin(_env: Record<string, unknown>): void {},
  frame(..._args: unknown[]): void {},
  noteDetect(..._args: unknown[]): void {},
  noteIsSpeech(_speech?: boolean): void {},
  mark(..._args: unknown[]): void {},
  save(_reason?: string): void {},
}
