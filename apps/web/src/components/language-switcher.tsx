import { Check, Languages } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { LANGUAGES, useLang } from '@/lib/i18n';

/** Idioma de lectura de la página (español o inglés). */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = LANGUAGES.find((l) => l.value === lang) ?? LANGUAGES[0]!;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)} translate="no">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Idioma / Language: ${current.label}`}
        title="Idioma / Language"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-muted hover:bg-surface-2 hover:text-ink"
      >
        <Languages className="size-[18px]" aria-hidden />
        <span className="font-mono text-xs font-medium">{current.short}</span>
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label="Idioma / Language" className="absolute right-0 z-40 mt-1 w-44 rounded-md border border-line bg-surface p-1 shadow-lg shadow-black/20">
          {LANGUAGES.map((l) => (
            <button
              key={l.value}
              type="button"
              role="menuitemradio"
              aria-checked={l.value === lang}
              onClick={() => {
                setOpen(false);
                if (l.value !== lang) setLang(l.value);
              }}
              className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-surface-2"
            >
              <span className="w-6 font-mono text-xs text-muted">{l.short}</span>
              <span className="flex-1">{l.label}</span>
              {l.value === lang ? <Check className="size-4 text-accent" aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
