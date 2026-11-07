import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAirlines } from '@/hooks/use-lam-data';
import { describeError } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import { AuthLayout } from './auth-layout';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Solicitud de cuenta de piloto. No crea la cuenta: un superadministrador la
 * revisa y, al aprobarla, llega el correo de invitación para elegir contraseña.
 */
export function SignUpPage() {
  const airlines = useAirlines();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [airlineId, setAirlineId] = useState('');
  const [vid, setVid] = useState('');
  const [message, setMessage] = useState('');
  // Campo trampa: invisible para las personas; los robots lo llenan.
  const [website, setWebsite] = useState('');
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const errors = {
    name: name.trim().length >= 2 ? undefined : 'Escribe tu nombre',
    email: EMAIL.test(email.trim()) ? undefined : 'Escribe un correo válido',
    vid: !vid.trim() || /^[0-9]{4,8}$/.test(vid.trim()) ? undefined : 'Solo números, de 4 a 8',
  };
  const show = (e: string | undefined) => (touched ? e : undefined);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setServerError(null);
    if (errors.name || errors.email || errors.vid) return;
    if (website) {
      setSentTo(email.trim());
      return;
    }
    setSending(true);
    const { error } = await getSupabase().rpc('request_pilot_account', {
      p_email: email.trim(),
      p_display_name: name.trim(),
      ...(airlineId ? { p_airline_id: airlineId } : {}),
      ...(message.trim() ? { p_message: message.trim() } : {}),
      ...(vid.trim() ? { p_ivao_vid: vid.trim() } : {}),
    });
    setSending(false);
    if (error) {
      setServerError(describeError(error));
      return;
    }
    setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <AuthLayout title="Solicitud enviada">
        <div className="flex flex-col gap-4">
          <MailCheck className="size-10 text-cyan" aria-hidden />
          <p>
            Recibimos tu solicitud para <strong className="font-medium">{sentTo}</strong>. Un administrador de LAM la revisará.
          </p>
          <p>
            Cuando la aprueben te llegará un correo de invitación. Ábrelo en este navegador, elige tu contraseña y después solicita unirte a
            una aerolínea desde «Mis aerolíneas».
          </p>
          <p className="text-sm text-muted">Si no lo ves en unos días, revisa la carpeta de correo no deseado.</p>
          <Link to="/bienvenida" className="text-sm font-medium underline underline-offset-4">
            Volver al inicio
          </Link>
        </div>
      </AuthLayout>
    );
  }

  const activeAirlines = (airlines.data ?? []).filter((a) => a.is_active);
  return (
    <AuthLayout
      title="Solicitar cuenta de piloto"
      subtitle="Las cuentas de LAM se aprueban una por una. Cuando un administrador apruebe la tuya, recibirás un correo para elegir tu contraseña."
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link to="/entrar" className="font-medium text-ink underline underline-offset-4">
            Iniciar sesión
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        <Field id="displayName" label="Nombre" error={show(errors.name)}>
          <Input
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...fieldAria('displayName', show(errors.name))}
          />
        </Field>
        <Field id="email" label="Correo" error={show(errors.email)}>
          <Input
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...fieldAria('email', show(errors.email))}
          />
        </Field>
        <Field id="airline" label="Aerolínea a la que quieres unirte (opcional)" hint="Solo como referencia; el ingreso lo pides ya con tu cuenta.">
          <Select id="airline" value={airlineId} onChange={(e) => setAirlineId(e.target.value)}>
            <option value="">Todavía no lo sé</option>
            {activeAirlines.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.icao_code ? ` (${a.icao_code})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="vid" label="VID de IVAO (opcional)" error={show(errors.vid)}>
          <Input
            inputMode="numeric"
            maxLength={8}
            className="font-mono"
            value={vid}
            onChange={(e) => setVid(e.target.value)}
            {...fieldAria('vid', show(errors.vid))}
          />
        </Field>
        <Field id="message" label="Cuéntanos de ti (opcional)" hint="Tu experiencia en simulación, quién te invitó o cualquier dato que ayude a aprobarte.">
          <Textarea id="message" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Sitio web</label>
          <input id="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <Button type="submit" loading={sending} className="mt-1">
          Enviar solicitud
        </Button>
      </form>
    </AuthLayout>
  );
}
