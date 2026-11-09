import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { BadgeArt, badgePngFile, downloadFile } from '@/components/badge-art';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import {
  BADGE_EMBLEMS,
  BADGE_METALS,
  BADGE_PRESETS,
  BADGE_SHAPES,
  renderBadgeSvg,
  type BadgeEmblem,
  type BadgeMetal,
  type BadgeShape,
  type BadgeSpec,
} from '@/lib/badge-art';
import { cn } from '@/lib/cn';

const METALS: BadgeMetal[] = ['gold', 'silver', 'bronze'];

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'insignia';
}

/**
 * Diseñador de insignias: se parte de un diseño de la biblioteca, se elige el
 * metal y se ajustan forma, emblema y textos. Se descarga en PNG o SVG o se usa
 * directo (por ejemplo, como la insignia de un tour).
 */
export function BadgeDesigner({
  open,
  onClose,
  initial,
  onUse,
  useLabel = 'Usar esta insignia',
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<BadgeSpec>;
  onUse?: (file: File, spec: BadgeSpec) => void | Promise<void>;
  useLabel?: string;
}) {
  const [spec, setSpec] = useState<BadgeSpec>(() => ({
    shape: 'seal',
    emblem: 'plane',
    metal: 'gold',
    top: 'LAM',
    ribbon: null,
    label: '1',
    ribbonColor: null,
    ...initial,
  }));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<BadgeSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const name = slug(`${spec.ribbon || BADGE_SHAPES[spec.shape]}-${BADGE_METALS[spec.metal].name}`);

  async function png(): Promise<File> {
    return badgePngFile(spec, name);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Diseñar insignia"
      description="Elige un diseño de la biblioteca y su metal. Ajusta la forma, el emblema y los textos; el resultado se puede descargar o usar directo."
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => downloadFile(new Blob([renderBadgeSvg(spec, 'svg', 512)], { type: 'image/svg+xml' }), `${name}.svg`)}
          >
            <Download className="size-4" aria-hidden />
            SVG
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                downloadFile(await png(), `${name}.png`);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'No se pudo crear la imagen');
              }
            }}
          >
            <Download className="size-4" aria-hidden />
            PNG
          </Button>
          {onUse ? (
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onUse(await png(), spec);
                  onClose();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'No se pudo crear la imagen');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {useLabel}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-3">
          <BadgeArt spec={spec} size={220} title="Vista previa de la insignia" />
          <div className="flex gap-1.5" role="radiogroup" aria-label="Metal">
            {METALS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={spec.metal === m}
                onClick={() => set({ metal: m })}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm font-medium',
                  spec.metal === m ? 'border-ink bg-surface-2' : 'border-line text-muted hover:text-ink',
                )}
              >
                <span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: BADGE_METALS[m].mid }} aria-hidden />
                {BADGE_METALS[m].name}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">Biblioteca</p>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
              {BADGE_PRESETS.map((p) => {
                const active = p.shape === spec.shape && p.emblem === spec.emblem;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => set({ shape: p.shape, emblem: p.emblem })}
                      title={`${p.name}: ${p.use}`}
                      aria-pressed={active}
                      className={cn('flex w-full flex-col items-center rounded-md border p-1 text-[11px]', active ? 'border-ink bg-surface-2' : 'border-line hover:bg-surface-2')}
                    >
                      <BadgeArt spec={{ shape: p.shape, emblem: p.emblem, metal: spec.metal, top: null, ribbon: null, label: spec.label }} size={56} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="bd-shape" label="Forma">
              <Select id="bd-shape" value={spec.shape} onChange={(e) => set({ shape: e.target.value as BadgeShape })}>
                {Object.entries(BADGE_SHAPES).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="bd-emblem" label="Emblema">
              <Select id="bd-emblem" value={spec.emblem} onChange={(e) => set({ emblem: e.target.value as BadgeEmblem })}>
                {Object.entries(BADGE_EMBLEMS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="bd-ribbon" label="Texto de la cinta" hint="Código del tour, folio o nivel. Vacío, sin cinta.">
              <Input id="bd-ribbon" value={spec.ribbon ?? ''} maxLength={18} onChange={(e) => set({ ribbon: e.target.value || null })} className="uppercase" />
            </Field>
            <Field id="bd-top" label="Texto superior">
              <Input id="bd-top" value={spec.top ?? ''} maxLength={14} onChange={(e) => set({ top: e.target.value || null })} className="uppercase" />
            </Field>
            {spec.emblem === 'number' ? (
              <Field id="bd-label" label="Número" hint="Lugar del podio, meta (100) o año.">
                <Input id="bd-label" value={spec.label ?? ''} maxLength={4} onChange={(e) => set({ label: e.target.value || null })} />
              </Field>
            ) : null}
            <Field id="bd-ribbon-color" label="Color de la cinta">
              <div className="flex items-center gap-2">
                <input
                  id="bd-ribbon-color"
                  type="color"
                  value={spec.ribbonColor ?? '#243045'}
                  onChange={(e) => set({ ribbonColor: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent"
                />
                {spec.ribbonColor ? (
                  <Button size="sm" variant="ghost" onClick={() => set({ ribbonColor: null })}>
                    Original
                  </Button>
                ) : null}
              </div>
            </Field>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
