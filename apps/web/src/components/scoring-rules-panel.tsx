import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, Td, Th } from '@/components/ui/table';
import { useScoringRules, useUpdateScoringRule, type ScoringRule } from '@/hooks/use-pireps';
import { describeError } from '@/lib/errors';

interface Draft {
  enabled: boolean;
  penalty: string;
  threshold: string;
  critical: boolean;
}

function toDraft(rule: ScoringRule): Draft {
  return {
    enabled: rule.enabled,
    penalty: String(rule.penalty),
    threshold: rule.threshold === null ? '' : String(rule.threshold),
    critical: rule.critical,
  };
}

function sameDraft(a: Draft, b: Draft) {
  return a.enabled === b.enabled && a.penalty === b.penalty && a.threshold === b.threshold && a.critical === b.critical;
}

/** Reglas de puntuación del PIREP de una aerolínea (las cambia su administrador). */
export function ScoringRulesPanel({ airlineId, canManage }: { airlineId: string; canManage: boolean }) {
  const rules = useScoringRules(airlineId);
  const update = useUpdateScoringRule();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (rules.data) setDrafts(Object.fromEntries(rules.data.map((r) => [r.rule_code, toDraft(r)])));
  }, [rules.data]);

  const dirty = useMemo(
    () => (rules.data ?? []).filter((r) => drafts[r.rule_code] && !sameDraft(drafts[r.rule_code]!, toDraft(r))),
    [rules.data, drafts],
  );

  function set(code: string, changes: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [code]: { ...d[code]!, ...changes } }));
  }

  function invalid(rule: ScoringRule, draft: Draft): string | null {
    const penalty = Number(draft.penalty);
    if (!Number.isInteger(penalty) || penalty < 0 || penalty > 100) return 'La penalización va de 0 a 100';
    if (rule.definition?.threshold_unit && (draft.threshold === '' || Number.isNaN(Number(draft.threshold)) || Number(draft.threshold) < 0))
      return 'El umbral debe ser un número positivo';
    return null;
  }

  async function save() {
    setSaving(true);
    try {
      for (const rule of dirty) {
        const draft = drafts[rule.rule_code]!;
        const problem = invalid(rule, draft);
        if (problem) throw new Error(`${rule.definition?.label ?? rule.rule_code}: ${problem}`);
        await update.mutateAsync({
          airlineId,
          code: rule.rule_code,
          changes: {
            enabled: draft.enabled,
            penalty: Number(draft.penalty),
            threshold: rule.definition?.threshold_unit ? Number(draft.threshold) : rule.threshold,
            critical: draft.critical,
          },
        });
      }
      toast.success('Puntuación actualizada. Se aplica a los próximos PIREP.');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Puntuación de PIREP"
      description="Cada PIREP empieza con 100 puntos y resta la penalización de cada regla que se cumple. Una falta grave siempre manda el PIREP a revisión."
      actions={
        canManage ? (
          <Button size="sm" onClick={save} loading={saving} disabled={dirty.length === 0}>
            Guardar cambios{dirty.length > 0 ? ` (${dirty.length})` : ''}
          </Button>
        ) : (
          <Badge>Solo lectura</Badge>
        )
      }
    >
      {rules.isPending ? (
        <Skeleton className="h-64" />
      ) : rules.isError ? (
        <Alert tone="danger">{describeError(rules.error)}</Alert>
      ) : !rules.data || rules.data.length === 0 ? (
        <Alert>Solo los miembros de la aerolínea ven sus reglas.</Alert>
      ) : (
        <Table minWidth="46rem" className="border-0">
          <thead>
            <tr>
              <Th className="w-16">Activa</Th>
              <Th>Regla</Th>
              <Th className="w-36">Umbral</Th>
              <Th className="w-28">Penalización</Th>
              <Th className="w-24">Grave</Th>
            </tr>
          </thead>
          <tbody>
            {rules.data.map((rule) => {
              const draft = drafts[rule.rule_code] ?? toDraft(rule);
              const unit = rule.definition?.threshold_unit;
              const label = rule.definition?.label ?? rule.rule_code;
              return (
                <tr key={rule.rule_code} className={draft.enabled ? undefined : 'opacity-60'}>
                  <Td>
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
                      aria-label={`Activar ${label}`}
                      checked={draft.enabled}
                      disabled={!canManage}
                      onChange={(e) => set(rule.rule_code, { enabled: e.target.checked })}
                    />
                  </Td>
                  <Td>
                    <p className="font-medium">{label}</p>
                    <p className="text-xs text-muted">{rule.definition?.description}</p>
                  </Td>
                  <Td>
                    {unit ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          className="h-8 w-20 px-2 text-sm tabular-nums"
                          aria-label={`Umbral de ${label} en ${unit}`}
                          value={draft.threshold}
                          disabled={!canManage}
                          onChange={(e) => set(rule.rule_code, { threshold: e.target.value })}
                        />
                        <span className="text-xs text-muted">{unit}</span>
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted" aria-hidden>
                        −
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        className="h-8 w-16 px-2 text-sm tabular-nums"
                        aria-label={`Penalización de ${label}`}
                        value={draft.penalty}
                        disabled={!canManage}
                        onChange={(e) => set(rule.rule_code, { penalty: e.target.value })}
                      />
                    </div>
                  </Td>
                  <Td>
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
                      aria-label={`${label} es falta grave`}
                      checked={draft.critical}
                      disabled={!canManage}
                      onChange={(e) => set(rule.rule_code, { critical: e.target.checked })}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
