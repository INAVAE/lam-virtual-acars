import { ArrowLeft, Paintbrush } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { BadgeArt } from '@/components/badge-art';
import { BadgeDesigner } from '@/components/badge-designer';
import { Button, buttonClasses } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { BADGE_METALS, BADGE_PRESETS, presetSpec, type BadgeMetal, type BadgePreset } from '@/lib/badge-art';

const METALS: BadgeMetal[] = ['gold', 'silver', 'bronze'];

const RULES: { title: string; text: string }[] = [
  { title: 'Tours', text: 'Cada tour lleva su propia insignia: elige un diseño, ponle el código del tour en la cinta y el metal según la dificultad (bronce para los cortos, plata para los regionales, oro para los largos o exigentes).' },
  { title: 'Eventos', text: 'Los tres primeros lugares del ranking reciben la medalla de podio: 1.º oro, 2.º plata y 3.º bronce. Se dibuja sola en el ranking del evento.' },
  { title: 'Entrenamientos', text: 'Al completar un entrenamiento, el reconocimiento usa el metal de su nivel: básico bronce, intermedio plata y avanzado oro. Aparece solo en el perfil del piloto.' },
];

/** Biblioteca de insignias de LAM: diseños propios en oro, plata y bronce, y el diseñador. */
export function BadgeLibraryPage() {
  const [designing, setDesigning] = useState<{ preset: BadgePreset; metal: BadgeMetal } | 'blank' | null>(null);
  return (
    <div className="space-y-5">
      <Link to="/tours" className={buttonClasses('ghost', 'sm')}>
        <ArrowLeft className="size-4" aria-hidden />
        Tours
      </Link>
      <PageHeader
        title="Biblioteca de insignias"
        description="Insignias de LAM en oro, plata y bronce para tours, eventos y entrenamientos. Todas se dibujan aquí mismo: elige una, ajústala y descárgala o úsala en tu tour."
        actions={
          <Button onClick={() => setDesigning('blank')}>
            <Paintbrush className="size-4" aria-hidden />
            Diseñar insignia
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {RULES.map((r) => (
          <div key={r.title} className="rounded-lg border border-line bg-surface p-4">
            <p className="font-semibold">{r.title}</p>
            <p className="mt-1 text-sm text-muted">{r.text}</p>
          </div>
        ))}
      </div>

      <Panel title="Diseños" description="Pulsa una insignia para abrirla en el diseñador con ese metal.">
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {BADGE_PRESETS.map((p) => (
            <li key={p.id} className="rounded-lg border border-line bg-bg p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted">{p.use}</p>
                </div>
              </div>
              <div className="mt-2 flex justify-between">
                {METALS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDesigning({ preset: p, metal: m })}
                    className="rounded-md p-1 hover:bg-surface-2"
                    title={`${p.name} · ${BADGE_METALS[m].name}`}
                  >
                    <BadgeArt
                      spec={presetSpec(p, m, p.emblem === 'number' ? null : p.id === 'instructor' ? 'AVANZADO' : 'TOUR-01', p.id === 'podium' ? (m === 'gold' ? '1' : m === 'silver' ? '2' : '3') : '100')}
                      size={96}
                      title={`${p.name} · ${BADGE_METALS[m].name}`}
                    />
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {designing ? (
        <BadgeDesigner
          open
          onClose={() => setDesigning(null)}
          initial={
            designing === 'blank'
              ? undefined
              : presetSpec(designing.preset, designing.metal, designing.preset.emblem === 'number' ? null : 'TOUR-01', designing.preset.id === 'podium' ? '1' : '100')
          }
        />
      ) : null}
    </div>
  );
}
