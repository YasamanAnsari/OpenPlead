// The globals the pages see: what the two preloads expose, and the label helper case.js hangs on window.
// Both page shapes are declared together; each page uses its own part.
interface OpenPleadBridge {
  // the pet page (preload.js)
  click(): void;
  hover(over: boolean): void;
  move(dx: number, dy: number): void;
  moveEnd(): void;
  contextMenu(): void;
  focusAgent(): void;
  onView(
    cb: (view: {
      mood: string;
      tag: { line1: string; line2: string; phrase: string; dot: string; queue: string; level?: number; max?: number };
      spriteDir: string;
    }) => void,
  ): void;
  onBubble(cb: (b: { text: string; ms: number; sticky?: boolean }) => void): void;
  onSound(cb: (msg: { name: string; thanks: number }) => void): void;
  onEyes(cb: (msg: unknown) => void): void;
  // the settings page (preload-settings.js)
  read(): Promise<any>;
  set(key: string, value: unknown): Promise<any>;
  action(name: string, arg?: string): Promise<any>;
  onTab(cb: (tab: string) => void): void;
  phrases(): Promise<{ sets: Record<string, string[]>; file: string }>;
  savePhrases(sets: Record<string, string[]>): Promise<{ error?: string }>;
}
interface Window {
  openplead: OpenPleadBridge;
  labelCase: { titleCase(label: string): string; labelFor(platform: string, label: string): string };
}
