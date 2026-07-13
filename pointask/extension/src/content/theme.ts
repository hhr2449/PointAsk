function visibleBackground(element: Element | null): string {
  for (let current = element; current; current = current.parentElement) {
    const color = getComputedStyle(current).backgroundColor;
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
  }
  return getComputedStyle(document.body).backgroundColor;
}

export function applyPointAskTheme(host: HTMLElement, reference: Element | null = document.body): void {
  const computed = getComputedStyle(reference ?? document.body);
  host.style.setProperty('--pointask-font', computed.fontFamily || 'system-ui, sans-serif');
  const match = visibleBackground(reference).match(/[\d.]+/g)?.map(Number);
  if (match && match.length >= 3) {
    const luminance = match[0]! * .2126 + match[1]! * .7152 + match[2]! * .0722;
    host.dataset.pointaskTheme = luminance < 110 ? 'dark' : 'light';
  }
}
