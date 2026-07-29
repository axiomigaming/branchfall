/**
 * Twelve lines of DOM helper, in place of a framework.
 *
 * The graybox re-renders the whole screen on every state change. The tree is a
 * few hundred nodes and the interactions are taps, so a diffing library would be
 * a dependency, a build step and a first-load line item bought with nothing.
 */
export type Child = Node | string | number | null | undefined | false | Child[];

/**
 * There is no `innerHTML` escape hatch here, deliberately. Every string this UI
 * renders is either authored copy or a figure computed by the server, and all of
 * it goes through `textContent`.
 */
export interface Props {
  readonly class?: string;
  readonly text?: string | number;
  readonly onClick?: (event: MouseEvent) => void;
  readonly onInput?: (event: Event) => void;
  readonly onChange?: (event: Event) => void;
  readonly [key: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'onClick') node.addEventListener('click', value as EventListener);
    else if (key === 'onInput') node.addEventListener('input', value as EventListener);
    else if (key === 'onChange') node.addEventListener('change', value as EventListener);
    else if (key === 'value' && node instanceof HTMLInputElement) node.value = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(node: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

export function frag(...children: Child[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  append(fragment, children);
  return fragment;
}
