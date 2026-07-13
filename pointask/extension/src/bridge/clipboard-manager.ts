export interface ClipboardResult {
  success: boolean;
  method?: 'clipboard-api' | 'fallback';
  error?: string;
}

interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export class ClipboardManager {
  constructor(
    private readonly writer: ClipboardWriter | undefined = navigator.clipboard,
    private readonly fallbackCopy: (command: string) => boolean = (command) => document.execCommand(command),
  ) {}

  async copy(text: string): Promise<ClipboardResult> {
    if (!text) return { success: false, error: '没有可复制的提示词' };
    try {
      await this.writer?.writeText(text);
      if (this.writer) return { success: true, method: 'clipboard-api' };
    } catch {
      // Permission denial falls through to the user-gesture-compatible DOM fallback.
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const textarea = document.createElement('textarea');
    textarea.dataset.pointaskOwned = 'true';
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(textarea);
    textarea.select();
    try {
      const success = this.fallbackCopy('copy');
      return success
        ? { success: true, method: 'fallback' }
        : { success: false, error: '浏览器拒绝了复制操作' };
    } catch {
      return { success: false, error: '无法复制提示词，请检查浏览器权限' };
    } finally {
      textarea.remove();
      activeElement?.focus();
    }
  }
}
