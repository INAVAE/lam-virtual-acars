import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { AirlineLogo } from '@/components/airline-logo';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCreateAirline } from '@/hooks/use-airline-admin';
import { useAirlines, useMyMemberships } from '@/hooks/use-lam-data';
import { useAirlineScope } from '@/lib/airline-scope';
import { describeError } from '@/lib/errors';
import { formatRoles, operationTypeLabel } from '@/lib/format';

const createSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre').max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, 'Solo minúsculas, números y guiones; por ejemplo aero-ejemplo'),
});
type CreateForm = z.infer<typeof createSchema>;

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function CreateAirlineDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateAirline();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setValue,
    getFieldState,
    formState: { errors, isSubmitting },
  } = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { name: '', slug: '' } });

  async function onSubmit(values: CreateForm) {
    try {
      const slug = await create.mutateAsync({ name: values.name, slug: values.slug });
      toast.success('Aerolínea creada. Completa su configuración y actívala cuando esté lista.');
      onClose();
      navigate(`/airlines/${slug}`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nueva aerolínea"
      description="Se crea inactiva. Después configuras códigos, identidad y políticas."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="create-airline" loading={isSubmitting}>
            Crear aerolínea
          </Button>
        </>
      }
    >
      <form id="create-airline" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field id="na-name" label="Nombre" error={errors.name?.message}>
          <Input
            {...fieldAria('na-name', errors.name?.message)}
            {...register('name', {
              onChange: (e: ChangeEvent<HTMLInputElement>) => {
                if (!getFieldState('slug').isDirty) setValue('slug', slugify(e.target.value));
              },
            })}
          />
        </Field>
        <Field id="na-slug" label="Identificador en la dirección web" error={errors.slug?.message} hint="Aparece en /airlines/identificador.">
          <Input className="font-mono" {...fieldAria('na-slug', errors.slug?.message, 'hint')} {...register('slug')} />
        </Field>
      </form>
    </Dialog>
  );
}

export function AirlinesPage() {
  const airlines = useAirlines();
  const memberships = useMyMemberships();
  const { isOrgAdmin } = useAirlineScope();
  const [creating, setCreating] = useState(false);

  const myRoles = new Map((memberships.data ?? []).filter((m) => m.status === 'active').map((m) => [m.airline_id, m.roles]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Airlines"
        description="Aerolíneas virtuales de la alianza Líneas Aéreas Mexicanas."
        actions={
          isOrgAdmin ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              Nueva aerolínea
            </Button>
          ) : null
        }
      />

      {airlines.isError ? <Alert tone="danger">{describeError(airlines.error)}</Alert> : null}

      {airlines.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(airlines.data ?? []).map((a) => {
            const roles = myRoles.get(a.id);
            return (
              <li key={a.id}>
                <Link
                  to={`/airlines/${a.slug}`}
                  className="flex h-full flex-col gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-muted"
                  style={{ borderTopColor: a.brand_primary_color, borderTopWidth: 3 }}
                >
                  <div className="flex items-start gap-3">
                    <AirlineLogo airline={a} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xl leading-tight">{a.icao_code ?? '···'}</p>
                      <p className="truncate font-medium">{a.name}</p>
                    </div>
                    {a.is_active ? <Badge tone="ok">Activa</Badge> : <Badge tone="warn">Inactiva</Badge>}
                  </div>
                  {a.description ? <p className="line-clamp-2 text-sm text-muted">{a.description}</p> : null}
                  <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="text-muted">{operationTypeLabel(a.operation_type)}</span>
                    <span className="font-mono text-muted">{a.network}</span>
                    {roles ? <span className="text-ink">Tu rol: {formatRoles(roles)}</span> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {creating ? <CreateAirlineDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
