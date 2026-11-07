/**
 * Traductor de la interfaz: la web está escrita en español y, con el idioma
 * inglés, reemplaza los textos visibles (y los atributos title, placeholder,
 * aria-label y alt) por su traducción del diccionario. Un MutationObserver
 * traduce lo que React vuelve a pintar. Lo que escriben las personas y lo que
 * no está en el diccionario se queda como está.
 */

export interface Dictionary {
  /** Texto exacto (espacios normalizados) → traducción. */
  strings: Record<string, string>;
  /** Plantillas con {0}, {1}…: "Hay {0} vuelos" → "There are {0} flights". */
  patterns: [string, string][];
}

const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'] as const;
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);

interface CompiledPattern {
  re: RegExp;
  out: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compilePatterns(patterns: [string, string][]): CompiledPattern[] {
  return patterns
    .filter(([from]) => /\{\d+\}/.test(from))
    .map(([from, to]) => {
      const source = escapeRe(from).replace(/\\\{(\d+)\\\}/g, '(?<g$1>.+?)');
      return { re: new RegExp(`^${source}$`, 's'), out: to };
    })
    // Las plantillas más largas (más específicas) primero.
    .sort((a, b) => b.re.source.length - a.re.source.length);
}

export function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Traduce un texto ya normalizado; null si no hay traducción. */
export function translateText(text: string, dict: Dictionary, compiled: CompiledPattern[], depth = 0): string | null {
  if (!text) return null;
  const direct = dict.strings[text];
  if (direct !== undefined) return direct;
  if (depth > 2) return null;
  for (const p of compiled) {
    const m = p.re.exec(text);
    if (!m || !m.groups) continue;
    const groups = m.groups;
    return p.out.replace(/\{(\d+)\}/g, (_, i: string) => {
      const value = groups[`g${i}`] ?? '';
      return translateText(normalize(value), dict, compiled, depth + 1) ?? value;
    });
  }
  return null;
}

export class DomTranslator {
  private observer: MutationObserver | null = null;
  private readonly originals = new Map<Text, string>();
  private readonly attrOriginals = new Map<Element, Map<string, string>>();
  private readonly compiled: CompiledPattern[];
  private readonly reverse: Set<string>;
  private readonly dict: Dictionary;

  constructor(dict: Dictionary) {
    this.dict = dict;
    this.compiled = compilePatterns(dict.patterns);
    this.reverse = new Set(Object.values(dict.strings));
  }

  private skip(el: Element | null): boolean {
    for (let e = el; e; e = e.parentElement) {
      if (SKIP.has(e.tagName)) return true;
      if (e.getAttribute('translate') === 'no' || e.hasAttribute('data-no-translate')) return true;
    }
    return false;
  }

  private translateNode(node: Text) {
    const raw = node.data;
    const text = normalize(raw);
    if (!text || this.reverse.has(text) || !/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(text)) return;
    if (this.skip(node.parentElement)) return;
    const out = translateText(text, this.dict, this.compiled);
    if (out === null || out === text) return;
    const lead = /^\s*/.exec(raw)?.[0] ?? '';
    const trail = /\s*$/.exec(raw)?.[0] ?? '';
    this.originals.set(node, raw);
    node.data = `${lead}${out}${trail}`;
  }

  private translateAttrs(el: Element) {
    if (this.skip(el)) return;
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (!value) continue;
      const text = normalize(value);
      if (this.reverse.has(text)) continue;
      const out = translateText(text, this.dict, this.compiled);
      if (out === null || out === text) continue;
      let saved = this.attrOriginals.get(el);
      if (!saved) {
        saved = new Map();
        this.attrOriginals.set(el, saved);
      }
      saved.set(name, value);
      el.setAttribute(name, out);
    }
  }

  private walk(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) {
      this.translateNode(root as Text);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) this.translateAttrs(root as Element);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) this.translateNode(n as Text);
      else this.translateAttrs(n as Element);
    }
  }

  start() {
    this.walk(document.body);
    const title = translateText(normalize(document.title), this.dict, this.compiled);
    if (title) document.title = title;
    this.observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') this.translateNode(r.target as Text);
        else if (r.type === 'attributes') this.translateAttrs(r.target as Element);
        else r.addedNodes.forEach((n) => this.walk(n));
      }
    });
    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRS],
    });
  }

  /** Deja de traducir y regresa los textos que siguen en pantalla a su original. */
  stop() {
    this.observer?.disconnect();
    this.observer = null;
    for (const [node, raw] of this.originals) if (node.isConnected) node.data = raw;
    for (const [el, saved] of this.attrOriginals) if (el.isConnected) for (const [name, value] of saved) el.setAttribute(name, value);
    this.originals.clear();
    this.attrOriginals.clear();
  }
}
