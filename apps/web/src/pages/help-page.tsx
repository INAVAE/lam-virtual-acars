import { ChevronDown, Download, FileText, LifeBuoy, Search, Send } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  audienceLabels,
  HELP_CHAPTERS,
  HELP_FAQ,
  HELP_TROUBLESHOOTING,
  MANUAL_CHANGES,
  MANUAL_FILE,
  MANUAL_UPDATED,
  ticketKinds,
  ticketModules,
  ticketStatuses,
  type HelpChapter,
  type TicketKind,
  type TicketStatus,
} from '@/content/help-content';
import { useMyMemberships } from '@/hooks/use-lam-data';
import {
  useCanHandleTickets,
  useCreateTicket,
  useMyTickets,
  useTicketInbox,
  useUpdateTicket,
  type SupportTicket,
} from '@/hooks/use-support';
import { useAirlineScope } from '@/lib/airline-scope';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { formatLocalDateTime, formatPilotNumber } from '@/lib/format';
import { chapterVisible, moduleForPath, normalizeReference, searchChapters, searchPairs, ticketContext } from '@/lib/help';
import { useTheme } from '@/lib/theme';

type HelpTab = 'guide' | 'faq' | 'troubleshooting' | 'report' | 'inbox' | 'changes';
const TABS: readonly HelpTab[] = ['guide', 'faq', 'troubleshooting', 'report', 'inbox', 'changes'];
const PLATFORM = '__platform__';

export const APP_VERSION = import.meta.env.VITE_APP_VERSION?.trim() || 'desarrollo';

// -----------------------------------------------------------------------------
// Piezas
// -----------------------------------------------------------------------------
function Accordion({ title, meta, children, defaultOpen = false }: { title: string; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-md border border-line bg-surface open:bg-surface" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-medium leading-snug">{title}</span>
          {meta ? <span className="mt-0.5 block text-sm text-muted">{meta}</span> : null}
        </span>
        <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line px-4 py-3">{children}</div>
    </details>
  );
}

function Note({ title = 'Ten en cuenta.', children }: { title?: string; children: ReactNode }) {
  return (
    <p className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
      <strong className="font-semibold">{title} </strong>
      {children}
    </p>
  );
}

function ChapterBody({ chapter }: { chapter: HelpChapter }) {
  return (
    <div>
      <ol className="list-decimal space-y-2 pl-5 text-[15px]">
        {chapter.steps.map(([t, d]) => (
          <li key={t}>
            <strong className="font-semibold">{t}. </strong>
            {d}
          </li>
        ))}
      </ol>
      {chapter.note ? <Note>{chapter.note}</Note> : null}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

// -----------------------------------------------------------------------------
// Guía, preguntas frecuentes y fallas
// -----------------------------------------------------------------------------
function GuideTab({ query, roles }: { query: string; roles: { staff: boolean; admin: boolean; superadmin: boolean } }) {
  const chapters = searchChapters(
    HELP_CHAPTERS.filter((c) => chapterVisible(c.audience, roles)),
    query,
  );
  if (chapters.length === 0) return <Empty>Nada en la guía coincide con «{query}». Prueba con otras palabras o revisa las preguntas frecuentes.</Empty>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        {chapters.length} capítulos, del primer ingreso a la administración. Es el mismo contenido del manual en PDF.
      </p>
      {chapters.map((c) => (
        <Accordion
          key={c.id}
          title={c.title}
          defaultOpen={Boolean(query.trim())}
          meta={
            <>
              {c.summary}
              {c.audience !== 'all' ? (
                <Badge tone="info" className="ml-2 align-middle">
                  {audienceLabels[c.audience]}
                </Badge>
              ) : null}
            </>
          }
        >
          <ChapterBody chapter={c} />
        </Accordion>
      ))}
    </div>
  );
}

function FaqTab({ query }: { query: string }) {
  const rows = searchPairs(HELP_FAQ, query);
  if (rows.length === 0) return <Empty>Ninguna pregunta coincide con «{query}». Si lo tuyo no está, mándalo como duda en «Reportar una incidencia».</Empty>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">Lo que más se pregunta. Si lo tuyo no está aquí, mándalo como duda y lo agregamos.</p>
      {rows.map(([q, a]) => (
        <Accordion key={q} title={q} defaultOpen={Boolean(query.trim())}>
          <p className="text-[15px]">{a}</p>
        </Accordion>
      ))}
    </div>
  );
}

function TroubleshootingTab({ query }: { query: string }) {
  const rows = searchPairs(HELP_TROUBLESHOOTING, query);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Busca el síntoma, no la causa: la causa viene explicada.</p>
      {rows.length === 0 ? <Empty>Ningún síntoma coincide con «{query}».</Empty> : null}
      <div className="grid gap-2">
        {rows.map(([symptom, cause, fix]) => (
          <div key={symptom} className="grid gap-x-4 gap-y-1 rounded-md border border-line bg-surface px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)]">
            <p className="font-medium">{symptom}</p>
            <p className="text-sm text-muted">
              <span className="font-medium md:hidden">Por qué pasa: </span>
              {cause}
            </p>
            <p className="text-sm">
              <span className="font-medium md:hidden">Cómo se arregla: </span>
              {fix}
            </p>
          </div>
        ))}
      </div>
      <Note title="Si nada de esto lo resuelve.">
        Repórtalo en «Reportar una incidencia» con el mayor detalle que puedas: en qué pantalla estabas, qué pulsaste y qué apareció. Se adjuntan solos el navegador y la versión de la web.
      </Note>
    </div>
  );
}

function ChangesTab() {
  return (
    <Panel title="Novedades" description="Cambios de la plataforma que modificaron este manual, el más reciente primero.">
      <ul className="space-y-2">
        {MANUAL_CHANGES.map(([date, text]) => (
          <li key={`${date}-${text}`} className="grid gap-x-4 sm:grid-cols-[7rem_1fr]">
            <span className="font-mono text-sm text-muted">{date}</span>
            <span className="text-[15px]">{text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// Reportes
// -----------------------------------------------------------------------------
function TicketCard({ ticket, showAuthor, children }: { ticket: SupportTicket; showAuthor?: boolean; children?: ReactNode }) {
  const status = ticketStatuses[ticket.status] ?? ticketStatuses.new;
  const ctx = ticket.context ?? {};
  const ctxLine = [ctx.browser, ctx.viewport, ctx.version ? `web ${String(ctx.version)}` : null, ctx.path].filter(Boolean).join(' · ');
  return (
    <article className="rounded-md border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="font-mono text-muted">{ticket.folio}</span>
        <span className="text-muted">
          {ticketKinds[ticket.kind]?.label ?? ticket.kind}
          {ticket.module ? ` · ${ticket.module}` : ''}
          {` · ${ticket.airline ? (ticket.airline.icao_code ?? ticket.airline.name) : 'Plataforma'}`}
        </span>
        <span className="ml-auto text-xs text-muted">{formatLocalDateTime(ticket.created_at)}</span>
      </div>
      <h3 className="mt-1.5 font-medium">{ticket.title}</h3>
      {showAuthor ? (
        <p className="text-sm text-muted">
          de <strong className="font-medium text-ink">{ticket.author_name}</strong>
          {ticket.author_pilot_number ? ` · ${formatPilotNumber(ticket.author_pilot_number)}` : ''}
          {ticket.reference ? (
            <>
              {' · '}
              <span className="font-mono">{ticket.reference}</span>
            </>
          ) : null}
        </p>
      ) : ticket.reference ? (
        <p className="font-mono text-sm text-muted">{ticket.reference}</p>
      ) : null}
      <p className="mt-1.5 whitespace-pre-line text-[15px]">{ticket.details}</p>
      {showAuthor && ctxLine ? <p className="mt-1.5 text-xs text-muted">{ctxLine}</p> : null}
      {ticket.response ? (
        <p className="mt-2 rounded-md border border-cyan/40 bg-cyan/10 px-3 py-2 text-sm">
          <strong className="font-semibold">Respuesta{ticket.handler_name ? ` de ${ticket.handler_name}` : ''}. </strong>
          <span className="whitespace-pre-line">{ticket.response}</span>
        </p>
      ) : null}
      {children}
    </article>
  );
}

function ReportTab({ fromPath }: { fromPath: string | null }) {
  const memberships = useMyMemberships();
  const { options, selected } = useAirlineScope();
  const { theme } = useTheme();
  const mine = useMyTickets();
  const create = useCreateTicket();

  const myAirlines = useMemo(() => {
    const active = new Set((memberships.data ?? []).filter((m) => m.status === 'active').map((m) => m.airline_id));
    return options.filter((a) => active.has(a.id));
  }, [memberships.data, options]);

  const [kind, setKind] = useState<TicketKind>('error');
  const [airline, setAirline] = useState<string>('');
  const [module, setModule] = useState<string>(() => (fromPath ? (moduleForPath(fromPath) ?? '') : ''));
  const [reference, setReference] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [errors, setErrors] = useState<{ title?: string; details?: string }>({});

  // La aerolínea seleccionada arriba, si eres miembro; si no, la plataforma.
  useEffect(() => {
    if (airline) return;
    setAirline(selected && myAirlines.some((a) => a.id === selected.id) ? selected.id : (myAirlines[0]?.id ?? PLATFORM));
  }, [airline, selected, myAirlines]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (title.trim().length < 3) next.title = 'Escribe en una línea qué pasa.';
    if (details.trim().length < 10) next.details = 'Cuéntalo con detalle: sin eso es difícil resolverlo.';
    setErrors(next);
    if (next.title || next.details) return;
    try {
      const saved = await create.mutateAsync({
        kind,
        airline_id: airline && airline !== PLATFORM ? airline : null,
        module: module || null,
        reference: normalizeReference(reference),
        title: title.trim(),
        details: details.trim(),
        context: ticketContext({
          userAgent: navigator.userAgent,
          width: window.innerWidth,
          height: window.innerHeight,
          theme,
          path: fromPath ?? '',
          version: APP_VERSION,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
        }),
      });
      toast.success(`Reporte ${saved.folio} enviado. Aquí verás cuando lo atiendan.`);
      setTitle('');
      setDetails('');
      setReference('');
    } catch (err) {
      toast.error(describeError(err));
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Panel title="Reportar una incidencia" description="Una falla, una mejora o una duda. Llega firmada con tu nombre para poder preguntarte si algo no queda claro.">
        <form className="space-y-4" onSubmit={submit} noValidate>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">De qué se trata</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {(Object.keys(ticketKinds) as TicketKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm',
                    kind === k ? 'border-accent bg-accent/15 font-medium text-ink' : 'border-line text-muted hover:text-ink',
                  )}
                >
                  {ticketKinds[k].label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-sm text-muted">{ticketKinds[kind].hint}</p>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tk-airline" label="Aerolínea" hint={airline === PLATFORM ? 'Lo atiende el superadministrador de LAM.' : 'Lo atienden su administrador y su jefe de operaciones.'}>
              <Select id="tk-airline" value={airline} onChange={(e) => setAirline(e.target.value)}>
                {myAirlines.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.icao_code ? ` (${a.icao_code})` : ''}
                  </option>
                ))}
                <option value={PLATFORM}>La plataforma o el conector (LAM)</option>
              </Select>
            </Field>
            <Field id="tk-module" label="Módulo o pantalla">
              <Select id="tk-module" value={module} onChange={(e) => setModule(e.target.value)}>
                <option value="">Sin especificar</option>
                {ticketModules.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field id="tk-reference" label="Folio relacionado (opcional)" hint="PIREP, evento, callsign o número de vuelo, si tiene que ver con uno.">
            <Input id="tk-reference" value={reference} maxLength={60} placeholder="PIREP-2026-00006" onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field id="tk-title" label="En una línea, qué pasa" error={errors.title}>
            <Input
              id="tk-title"
              value={title}
              maxLength={140}
              placeholder="El conector no muestra mi vuelo reservado"
              aria-invalid={Boolean(errors.title)}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field id="tk-details" label="Cuéntalo con detalle" error={errors.details} hint="Qué hiciste, qué esperabas que pasara y qué pasó en realidad. Si fue una falla, di qué pulsaste justo antes.">
            <Textarea
              id="tk-details"
              rows={6}
              value={details}
              maxLength={4000}
              aria-invalid={Boolean(errors.details)}
              onChange={(e) => setDetails(e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted">
            Se adjuntan solos el navegador, el tamaño de la ventana, el tema, la pantalla de origen y la versión de la web ({APP_VERSION}). Solo tú y quien lo atiende lo verán.
          </p>
          <Button type="submit" loading={create.isPending}>
            <Send className="size-4" aria-hidden />
            Enviar reporte
          </Button>
        </form>
      </Panel>

      <Panel title="Mis reportes" description={mine.data?.length ? `${mine.data.length} enviados. Aquí ves si ya los atendieron.` : 'Aquí verás el estado y la respuesta de lo que mandes.'}>
        {mine.isLoading ? <p className="text-sm text-muted">Cargando…</p> : null}
        {mine.error ? <Alert tone="danger">{describeError(mine.error)}</Alert> : null}
        {mine.data && mine.data.length === 0 ? <Empty>Todavía no has mandado ninguno.</Empty> : null}
        <div className="space-y-2">
          {(mine.data ?? []).map((t) => (
            <TicketCard key={t.id} ticket={t} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function InboxItem({ ticket }: { ticket: SupportTicket }) {
  const update = useUpdateTicket();
  const [response, setResponse] = useState(ticket.response ?? '');
  useEffect(() => setResponse(ticket.response ?? ''), [ticket.response]);

  async function save(status?: TicketStatus) {
    try {
      await update.mutateAsync({ id: ticket.id, status, response: response.trim() || null });
      toast.success(status ? `${ticket.folio}: ${ticketStatuses[status].label.toLowerCase()}` : 'Respuesta guardada');
    } catch (err) {
      toast.error(describeError(err));
    }
  }

  return (
    <TicketCard ticket={ticket} showAuthor>
      <div className="mt-3 space-y-2">
        <label htmlFor={`tk-resp-${ticket.id}`} className="sr-only">
          Respuesta para {ticket.author_name}
        </label>
        <Textarea
          id={`tk-resp-${ticket.id}`}
          rows={2}
          maxLength={4000}
          value={response}
          placeholder="Respuesta para quien lo mandó…"
          onChange={(e) => setResponse(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ticketStatuses) as TicketStatus[])
            .filter((s) => s !== ticket.status && s !== 'new')
            .map((s) => (
              <Button key={s} size="sm" variant="secondary" disabled={update.isPending} onClick={() => save(s)}>
                {s === 'in_review' ? 'En revisión' : s === 'resolved' ? 'Marcar resuelto' : 'Descartar'}
              </Button>
            ))}
          <Button size="sm" variant="ghost" disabled={update.isPending || response.trim() === (ticket.response ?? '')} onClick={() => save()}>
            Guardar respuesta
          </Button>
        </div>
      </div>
    </TicketCard>
  );
}

function InboxTab() {
  const inbox = useTicketInbox(true);
  const [filter, setFilter] = useState<TicketStatus | ''>('new');
  const all = inbox.data ?? [];
  const rows = filter ? all.filter((t) => t.status === filter) : all;
  const count = (s: TicketStatus) => all.filter((t) => t.status === s).length;

  return (
    <Panel
      title="Reportes recibidos"
      description="Los de tus aerolíneas (y los de la plataforma si eres superadministrador). Cambiar el estado o responder le avisa a quien lo mandó en su pestaña de reportes."
      actions={
        <Select aria-label="Estado" className="h-9 w-auto" value={filter} onChange={(e) => setFilter(e.target.value as TicketStatus | '')}>
          {(Object.keys(ticketStatuses) as TicketStatus[]).map((s) => (
            <option key={s} value={s}>
              {ticketStatuses[s].label} ({count(s)})
            </option>
          ))}
          <option value="">Todos ({all.length})</option>
        </Select>
      }
    >
      {inbox.isLoading ? <p className="text-sm text-muted">Cargando…</p> : null}
      {inbox.error ? <Alert tone="danger">{describeError(inbox.error)}</Alert> : null}
      {inbox.data && rows.length === 0 ? <Empty>{filter ? 'No hay reportes en ese estado.' : 'Todavía no llega ningún reporte.'}</Empty> : null}
      <div className="space-y-2">
        {rows.map((t) => (
          <InboxItem key={t.id} ticket={t} />
        ))}
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// Página
// -----------------------------------------------------------------------------
export function HelpPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const fromPath = (location.state as { from?: string } | null)?.from ?? null;
  const canHandle = useCanHandleTickets();
  const { isOrgAdmin } = useAirlineScope();
  const memberships = useMyMemberships();
  const inbox = useTicketInbox(canHandle);
  const [query, setQuery] = useState('');

  const requested = params.get('tab') as HelpTab | null;
  const tab: HelpTab = requested && TABS.includes(requested) && (requested !== 'inbox' || canHandle) ? requested : 'guide';
  const setTab = (t: HelpTab) => setParams(t === 'guide' ? {} : { tab: t }, { replace: true, state: location.state });

  const roles = useMemo(() => {
    const active = (memberships.data ?? []).filter((m) => m.status === 'active');
    return {
      staff: active.some((m) => m.roles.includes('ops_chief') || m.roles.includes('airline_admin')),
      admin: active.some((m) => m.roles.includes('airline_admin')),
      superadmin: isOrgAdmin,
    };
  }, [memberships.data, isOrgAdmin]);

  const pending = (inbox.data ?? []).filter((t) => t.status === 'new').length;
  const items: { value: HelpTab; label: string; count?: number }[] = [
    { value: 'guide', label: 'Guía paso a paso' },
    { value: 'faq', label: 'Preguntas frecuentes' },
    { value: 'troubleshooting', label: 'Si algo falla' },
    { value: 'report', label: 'Reportar una incidencia' },
    ...(canHandle ? [{ value: 'inbox' as const, label: 'Reportes recibidos', count: pending }] : []),
    { value: 'changes', label: 'Novedades' },
  ];
  const searchable = tab === 'guide' || tab === 'faq' || tab === 'troubleshooting';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ayuda"
        description={
          <>
            Manual de uso, preguntas frecuentes y reporte de incidencias. Manual actualizado el <span className="font-mono">{MANUAL_UPDATED}</span>.
          </>
        }
        actions={
          <a className={buttonClasses('secondary')} href={`${import.meta.env.BASE_URL}${MANUAL_FILE}`} target="_blank" rel="noopener" download>
            <Download className="size-4" aria-hidden />
            Descargar el manual en PDF
          </a>
        }
      />

      <div className="-mx-1 overflow-x-auto px-1">
        <Tabs label="Secciones de la ayuda" value={tab} onChange={setTab} items={items} />
      </div>

      {searchable ? (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Buscar en la ayuda" className="pl-9" placeholder="Buscar: SimBrief, combustible, habilitación…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      ) : null}

      {tab === 'guide' ? <GuideTab query={query} roles={roles} /> : null}
      {tab === 'faq' ? <FaqTab query={query} /> : null}
      {tab === 'troubleshooting' ? <TroubleshootingTab query={query} /> : null}
      {tab === 'report' ? <ReportTab fromPath={fromPath} /> : null}
      {tab === 'inbox' && canHandle ? <InboxTab /> : null}
      {tab === 'changes' ? <ChangesTab /> : null}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <LifeBuoy className="size-3.5" aria-hidden />
          LAM Virtual ACARS · versión de la web {APP_VERSION}
        </span>
        <span className="inline-flex items-center gap-1">
          <FileText className="size-3.5" aria-hidden />
          El manual en PDF se genera con este mismo contenido en cada publicación.
        </span>
      </p>
    </div>
  );
}
