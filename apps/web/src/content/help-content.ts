/**
 * CONTENIDO DE LA AYUDA
 *
 * Una sola fuente: de aquí salen el manual que se consulta dentro de la web
 * (Ayuda, en la barra superior) y el manual en PDF que se descarga, que se
 * genera en cada publicación con scripts/build-manual.mjs. Si se escribieran
 * por separado, a la tercera corrección ya dirían cosas distintas.
 *
 * Reglas para mantenerlo:
 * - Cada cambio visible para el usuario actualiza el capítulo que corresponda
 *   y agrega una línea en MANUAL_CHANGES (la más reciente primero).
 * - Se escribe hablándole a quien lee. Si algo solo aplica a un rol, se dice
 *   en la propia frase.
 * - Sin imports: el generador del PDF lo lee con Node directamente.
 */

export type HelpAudience = 'all' | 'pilot' | 'staff' | 'admin' | 'super';

export interface HelpShot {
  /** Captura de scripts/visual-check.mjs (sin extensión). */
  file: string;
  caption: string;
  /** Qué señala cada número de la captura, en el mismo orden que sus marcas. */
  marks?: string[];
}

export interface HelpChapter {
  id: string;
  title: string;
  /** Para quién es y qué resuelve, en una línea. */
  summary: string;
  audience: HelpAudience;
  steps: [title: string, text: string][];
  note?: string;
  shot?: HelpShot;
}

export const audienceLabels: Record<HelpAudience, string> = {
  all: 'Todos',
  pilot: 'Pilotos',
  staff: 'Staff de aerolínea',
  admin: 'Administrador de aerolínea',
  super: 'Superadministrador',
};

/** Versión del contenido: la fecha del último cambio de MANUAL_CHANGES. */
export const MANUAL_TITLE = 'Manual de uso de LAM Virtual ACARS';
export const MANUAL_FILE = 'manual/Manual-LAM-Virtual-ACARS.pdf';

export const HELP_CHAPTERS: HelpChapter[] = [
  {
    id: 'que-es',
    title: 'Qué es LAM Virtual ACARS y qué no es',
    summary: 'Para qué sirve la plataforma y hasta dónde llega.',
    audience: 'all',
    steps: [
      ['Qué es', 'La plataforma de operaciones de las aerolíneas virtuales de LAM para Microsoft Flight Simulator 2024: reservas, plan de vuelo con SimBrief, registro automático del vuelo con el conector LAM ACARS, PIREP con puntaje, mapa en vivo, clima, tours, eventos y estadísticas.'],
      ['Las dos piezas', 'La web, que se abre en cualquier navegador sin instalar nada, y el conector LAM ACARS, una aplicación de Windows que lee el simulador y envía el vuelo a la web.'],
      ['Una cuenta, varias aerolíneas', 'Tu cuenta y tu número de piloto (LAM + 4 dígitos) son únicos en LAM. Con la misma cuenta te unes a una o varias aerolíneas, y en cada una puedes tener un rol distinto.'],
      ['Más espacio en pantalla', 'El botón junto al selector de aerolínea oculta el menú lateral y lo deja solo con iconos (pasa el puntero para ver el nombre); se recuerda en tu navegador. El mapa, las tarjetas y las gráficas tienen el botón «Ampliar» (⤢): ocupan toda la ventana, y desde ahí pasas a pantalla completa o los abres en otra pestaña. Esc o «Cerrar» los regresan.'],
      ['Idioma', 'El botón con el globo de letras (ES / EN) en la barra superior, y en las pantallas de entrada, cambia el idioma de lectura entre español e inglés; se recuerda en tu navegador. Las fechas y números también cambian de formato. Lo que escriben las personas (comentarios, descripciones, nombres) y algunos mensajes del servidor se quedan como se escribieron; el manual en PDF está en español.'],
      ['Varias pestañas, una sesión', 'Las pestañas que abras comparten tu sesión. Si cierras sesión en una, se cierra en todas y te pide entrar de nuevo.'],
      ['Qué NO es', 'No es una aerolínea real ni está relacionada con ninguna. Todo lo que muestra es para simulación: el clima, las rutas, el control de IVAO y los planes de vuelo no sirven para volar en la vida real.'],
    ],
    note: 'El selector de la barra superior cambia la aerolínea con la que trabajas. Casi todas las pantallas (reservas, flota, rutas, PIREP, estadísticas) siguen a ese selector.',
    shot: {
      file: 'm-01-dashboard',
      caption: 'El Dashboard con la barra superior y el menú.',
      marks: ['Selector de aerolínea', 'Reloj UTC y hora local', 'Ayuda: manual, preguntas frecuentes y reporte de incidencias', 'Menú de módulos'],
    },
  },
  {
    id: 'entrar',
    title: 'Crear tu cuenta y unirte a una aerolínea',
    summary: 'Lo que haces una sola vez, antes de tu primer vuelo.',
    audience: 'pilot',
    steps: [
      ['Solicita tu cuenta', 'En la página de inicio pulsa «Solicitar cuenta de piloto». Escribe tu nombre y tu correo; si quieres, la aerolínea a la que te interesa unirte, tu VID de IVAO y unas líneas sobre ti. No eliges contraseña todavía.'],
      ['Espera la invitación', 'El superadministrador revisa tu solicitud. Hasta que la aprueba no llega ningún correo. Al aprobarla te llega «Invitación a LAM Virtual ACARS»; si no la ves, revisa la carpeta de no deseados.'],
      ['Crea tu contraseña', 'Abre el enlace de la invitación: te pide una contraseña de al menos 8 caracteres y entras. El enlace vence en 24 horas; si venció, pide que te la reenvíen.'],
      ['Solicita ingreso', 'En el Dashboard, en «Mis aerolíneas», elige la aerolínea y pulsa «Solicitar ingreso». Puedes cancelarla mientras esté pendiente.'],
      ['Espera la aprobación', 'El administrador o el jefe de operaciones de la aerolínea aprueba tu solicitud en Pilots. Al aprobarla ya puedes reservar.'],
      ['Si olvidas la contraseña', 'Usa «Olvidé mi contraseña» en la pantalla de entrada. El enlace del correo te deja elegir una nueva y solo sirve una vez.'],
    ],
    note: 'Las cuentas se crean solo por invitación, para que entre únicamente quien vuela con LAM. Si entras y ves «Sin aerolínea asignada», tu cuenta está activa pero todavía nadie aprobó tu ingreso a una aerolínea.',
    shot: {
      file: 'm-09-request-account',
      caption: 'Solicitar cuenta de piloto.',
      marks: ['Nombre y correo', 'Aerolínea de interés (opcional)', 'Enviar solicitud'],
    },
  },
  {
    id: 'perfil',
    title: 'Tu cuenta y tu perfil: foto, SimBrief, hora local y seguridad',
    summary: 'El menú de tu cuenta, Mi cuenta y Settings: lo que conviene dejar listo antes de reservar.',
    audience: 'pilot',
    steps: [
      ['Menú de tu cuenta', 'Tu foto o tus iniciales, arriba a la derecha. Muestra tu correo, tu número LAM y tus roles, y lleva a tu perfil de piloto, a Mi cuenta, a Contraseña y sesiones, a Settings y a «Cerrar sesión» (se cierra en todas las pestañas).'],
      ['Mi cuenta', 'Datos personales: foto de perfil (se recorta en cuadro), nombre, país, VID de IVAO, usuario de Discord y una presentación breve. Lo ven los pilotos de tus aerolíneas; el correo solo lo ve el staff.'],
      ['Tu perfil de piloto', 'Tus totales (vuelos, horas de vuelo y block, millas, puntaje y tomas), actividad por mes, aerolíneas y roles, tipos de aeronave, rutas, historial de vuelos, habilitaciones, insignias de tours, eventos y entrenamientos completados.'],
      ['Usuario de SimBrief', 'En Settings → Perfil de piloto escribe tu usuario de SimBrief (el de navigraph.com/simbrief). Sin él no se puede importar el plan de vuelo.'],
      ['Aerolínea principal', 'Es la que se selecciona sola al entrar. Útil si vuelas en varias.'],
      ['Zona horaria', 'La operación usa UTC (Zulu). En Settings → Hora eliges tu zona y toda hora Zulu muestra también la local. Un clic en el reloj de arriba cambia cuál va primero.'],
      ['Contraseña y sesiones', 'Mi cuenta → «Contraseña y sesiones». Cambia tu contraseña cuando quieras; «Cerrar otras sesiones» saca tu cuenta de cualquier otro equipo.'],
      ['Tema claro u oscuro', 'El botón del sol o la luna en la barra superior. Se recuerda en ese navegador.'],
    ],
    shot: {
      file: 'm-02-settings',
      caption: 'Settings: perfil de piloto, hora y dispositivos ACARS.',
      marks: ['Usuario de SimBrief', 'Zona horaria', 'Código de vinculación del conector'],
    },
  },
  {
    id: 'conector',
    title: 'Instalar y vincular el conector LAM ACARS',
    summary: 'La aplicación de Windows que registra tu vuelo.',
    audience: 'pilot',
    steps: [
      ['Requisitos', 'Windows 10 u 11 de 64 bits y Microsoft Flight Simulator 2024.'],
      ['Descárgalo', 'De la página de versiones del proyecto (github.com/INAVAE/lam-virtual-acars/releases): el archivo LamAcars-<versión>-win-x64.zip de la versión más reciente. Junto a él se publica su suma SHA-256 para comprobar la descarga.'],
      ['Descomprime y abre', 'Descomprime la carpeta donde quieras y abre LamAcars.exe. Si Windows muestra «Windows protegió su PC», elige «Más información» → «Ejecutar de todas formas»: el ejecutable no está firmado.'],
      ['Vincula el equipo (una sola vez)', 'En el conector pulsa «Vincular este equipo» y aparece un código de 8 caracteres. En la web, Settings → Dispositivos ACARS, escríbelo y pulsa «Vincular equipo». En unos segundos el conector muestra tu nombre.'],
      ['Actualizaciones', 'El conector busca versiones nuevas solo cada 6 horas y con el botón «Buscar actualización» (arriba a la derecha). Si hay una, «Descargar e instalar» la descarga, comprueba su suma SHA-256, cierra el conector y lo abre ya actualizado; tu vinculación, tus vuelos pendientes y la bitácora se conservan. Con un vuelo en curso el botón se desactiva: termina o abandona el vuelo y después instala. Desde la versión 0.1.36; si tienes una anterior, descarga la 0.1.36 a mano una última vez.'],
      ['Siempre visible', 'El botón «Siempre visible» (debajo de «Buscar actualización», o en el menú del icono junto al reloj) deja la ventana del conector encima del simulador aunque estés usando MSFS. Funciona con MSFS en ventana o en pantalla completa sin bordes; en pantalla completa exclusiva Windows no deja dibujar ventanas encima. Para quitarlo pulsa «Quitar del frente». Se recuerda al volver a abrir el conector.'],
      ['Revocar', 'Si cambias de computadora o pierdes el equipo, revócalo en Settings → Dispositivos ACARS. Deja de enviar datos en su siguiente intento.'],
    ],
    note: 'PMDG 737 y 777: si el conector muestra «PMDG: falta activar los datos del SDK», pulsa «Activar» y vuelve a cargar el avión. Sin ese ajuste funciona igual, con las variables estándar del simulador.',
  },
  {
    id: 'reservar',
    title: 'Reservar un vuelo',
    summary: 'Flight Booking: elegir ruta, aeronave y callsign.',
    audience: 'pilot',
    steps: [
      ['Elige la aerolínea', 'Con el selector de la barra superior. Flight Booking muestra las rutas de esa aerolínea, con filtros por origen, destino, tipo de aeronave y estado (activas o pendientes).'],
      ['Pulsa «Reservar» en la ruta', 'Se abre la ventana de reserva con el clima actual de origen y destino y las aeronaves de la flota.'],
      ['Elige la aeronave', 'Las que no puedes usar aparecen con el motivo: tipo no permitido en la ruta, sin habilitación, ocupada o en otro aeropuerto. Qué reglas aplican depende de las políticas de la aerolínea.'],
      ['Escribe tu callsign', 'El que vas a usar en la red y en SimBrief. Lo eliges tú en cada vuelo.'],
      ['Vuelo directo', 'Si la ruta no existe, «Reservar un nuevo vuelo directo» (junto a «Registrar ruta») reserva origen, destino, número de vuelo, aeronave y callsign sin buscar una ruta. Al reservar, la misma ventana te deja crear el plan en SimBrief e importarlo. Marca «Registrar la ruta de este vuelo» si quieres que quede en las rutas de la aerolínea (pendiente hasta su primer vuelo aceptado); sin marcar, el vuelo se hace solo esa vez.'],
      ['Confirma', 'La reserva aparece en My Flights. Vence si no inicias el vuelo en el plazo que fija la aerolínea (24 horas por omisión), y la aerolínea limita cuántas reservas activas puedes tener.'],
    ],
    note: 'Las reglas las valida el servidor, no la pantalla: si una reserva se rechaza, el mensaje dice exactamente qué regla no se cumplió.',
    shot: {
      file: 'm-03-booking-dialog',
      caption: 'Ventana de reserva de una ruta.',
      marks: ['Clima actual de origen y destino', 'Aeronaves con su disponibilidad', 'Callsign del vuelo'],
    },
  },
  {
    id: 'registrar-ruta',
    title: 'Registrar una ruta nueva',
    summary: 'Cuando la ruta que quieres volar no existe todavía.',
    audience: 'pilot',
    steps: [
      ['Cuándo se puede', 'Solo si la aerolínea tiene activada la política «Los pilotos registran rutas». Entonces Flight Booking muestra el botón «Registrar ruta».'],
      ['Llena el formulario', 'Número de vuelo (el mismo que usarás en SimBrief, único en la aerolínea), origen, destino, tipo de operación y, si quieres, la duración estimada. Si ya existe una ruta con el mismo origen y destino, el formulario te la muestra.'],
      ['Queda pendiente', 'La ruta nace con la etiqueta «Pendiente» y ya se puede reservar. Pasa sola a activa con el primer PIREP aceptado que llegó a su destino.'],
      ['Quitarla', 'Mientras esté pendiente y sin reservas activas, quien la registró puede quitarla. Cada piloto puede tener hasta 20 rutas pendientes por aerolínea.'],
    ],
    note: 'Las rutas que da de alta el staff en Routes nacen activas.',
  },
  {
    id: 'preparar',
    title: 'Preparar el vuelo: plan de SimBrief y clima',
    summary: 'My Flights: lo que haces entre la reserva y el despegue.',
    audience: 'pilot',
    steps: [
      ['Abre My Flights', 'Cada vuelo reservado tiene su tarjeta con ruta, aeronave, callsign, salida programada, el METAR de origen y destino y el estado del conector.'],
      ['Crea el plan', '«Crear en SimBrief» abre SimBrief Dispatch con los datos de la reserva ya puestos. Genera el plan allá.'],
      ['Impórtalo', '«Importar de SimBrief» trae tu último plan y lo compara con la reserva: origen, destino, tipo, matrícula y número de vuelo. Si algo no coincide lo dice; genera de nuevo el plan e impórtalo otra vez.'],
      ['Listo para volar', 'Con el plan importado la tarjeta dice «Listo para iniciar en LAM ACARS». El plan también dibuja tu ruta con sus puntos en Live Flights.'],
      ['Si cambias de idea', '«Cancelar reserva» libera la ruta y la aeronave.'],
    ],
    shot: {
      file: 'm-04-my-flights',
      caption: 'Tarjeta de un vuelo reservado en My Flights.',
      marks: ['Clima de origen y destino', 'Crear el plan en SimBrief', 'Importar el plan', 'Estado del conector'],
    },
  },
  {
    id: 'volar',
    title: 'Volar con LAM ACARS',
    summary: 'Del simulador al PIREP, sin capturar nada a mano.',
    audience: 'pilot',
    steps: [
      ['Carga el avión en la puerta', 'Abre MSFS 2024 con la aeronave de la reserva en el aeropuerto de origen, con motores apagados.'],
      ['Inicia ACARS', 'En el conector elige el vuelo de la lista y pulsa «Iniciar ACARS». Desde ahí detecta solo las 15 fases: embarque, pushback, rodaje, despegue, ascenso, crucero, descenso, aproximación, aterrizaje, rodaje de llegada y llegada.'],
      ['Carga el combustible antes del pushback', 'La carga en tierra antes de quitar los calzos es normal y solo se informa. Agregar combustible después del pushback es una falta grave.'],
      ['Vuela normalmente', 'El conector envía la posición cada pocos segundos y guarda una lectura por segundo. Si se cae internet, guarda todo y lo envía al recuperar la conexión; si cierras el conector, al abrirlo el vuelo se reanuda.'],
      ['Cierra el vuelo', 'Al llegar a la puerta apaga motores y APU (si el avión la tiene) y pon el freno de estacionamiento: el vuelo se cierra solo y el PIREP se genera en segundos. Si tu avión no informa la APU al simulador (el conector la ve encendida todo el vuelo), no se exige para cerrar y el PIREP la muestra como «Sin dato».'],
      ['Terminar o abandonar', '«Terminar vuelo» cierra a mano un vuelo que ya llegó. «Abandonar vuelo» lo descarta sin PIREP.'],
    ],
    note: 'Si algo raro pasa en un vuelo, la bitácora del conector está en %LOCALAPPDATA%\\LamAcars\\logs. Adjunta su nombre y el folio del PIREP al reportar la incidencia.',
  },
  {
    id: 'pirep',
    title: 'El PIREP y su puntaje',
    summary: 'Qué se evalúa, cómo se aprueba y cómo leer el análisis.',
    audience: 'all',
    steps: [
      ['Se genera solo', 'Al cerrar el vuelo, con folio PIREP-AAAA-NNNNN, block time, distancia, combustible, toma y la trayectoria completa.'],
      ['Puntaje', 'Parte de 100 y cada falta resta según las reglas de la aerolínea (por ejemplo, rodaje rápido, toma dura, luces, alabeo excesivo o combustible agregado después del pushback). Las faltas graves se marcan aparte.'],
      ['Aprobación', 'Si la aerolínea aprueba automáticamente y el puntaje alcanza el mínimo sin faltas graves, el PIREP queda aceptado. Si no, lo revisa el jefe de operaciones o el administrador, que lo acepta o rechaza con un comentario.'],
      ['Tu comentario', 'Desde el detalle del PIREP puedes dejar un comentario para quien lo revisa: es el lugar para explicar algo que el sistema no sabe.'],
      ['Al aceptarse', 'Suma el block time y un ciclo a la aeronave y a tus horas, y cuenta para estadísticas, tours y eventos.'],
      ['El análisis', 'El mapa, las gráficas de altitud, velocidad y combustible, la APU, la actitud y el viento comparten un cursor: al pasar sobre una gráfica se marca el mismo instante en las demás.'],
    ],
    note: 'El staff puede anular una falta con un motivo (queda registrado quién y por qué) y archivar un PIREP. Uno archivado deja de verse en las listas; el superadministrador puede restaurarlo.',
    shot: {
      file: 'm-05-pirep-detail',
      caption: 'Detalle de un PIREP.',
      marks: ['Folio del PIREP', 'Estado y puntaje', 'Análisis del vuelo: mapa y gráficas'],
    },
  },
  {
    id: 'mapa',
    title: 'Live Flights: el mapa en vivo',
    summary: 'Seguir los vuelos en curso de tu aerolínea o de todas.',
    audience: 'all',
    steps: [
      ['Los aviones', 'Cada vuelo en curso aparece con la figura de su categoría, el logo de la aerolínea y el callsign. Al alejar el mapa queda solo el callsign.'],
      ['La lista de vuelos', 'Cada tarjeta lleva el logo de la aerolínea y muestra lo recorrido y lo que falta en NM, el tiempo en curso, el tiempo estimado al destino y el total estimado del vuelo. La distancia se mide por la ruta del plan de SimBrief (si el vuelo lo importó) y el tiempo considera que el avión desacelera en el descenso y la aproximación; sin plan, se mide en línea recta al destino.'],
      ['Elegir un vuelo', 'Al pulsarlo se dibuja su trayectoria por fases y la ruta que le falta, y su etiqueta se resalta con el color de la fase. Puedes elegir hasta 10 y la selección queda en el enlace de la página.'],
      ['Capas', 'Bajo el mapa se encienden y apagan: Etiquetas, Ruta del plan, Radar de precipitación, METAR de origen y destino y Control IVAO. La elección se recuerda en ese navegador.'],
      ['Ruta del plan', 'Los puntos del plan de SimBrief con su nombre, en línea punteada, y la ruta completa en texto en el detalle del vuelo. Aparece si el plan se importó en My Flights.'],
      ['Plan de SimBrief', 'En Live Flights, el detalle de un vuelo muestra la ruta y la hoja del plan de SimBrief: información del vuelo (alterno, horas de salida y llegada, tiempo en el aire y de bloque, matrícula), resumen del plan (altitud inicial, índice de costo, distancia de la ruta, viento medio y su componente, desviación ISA, AIRAC) y hoja de carga (consumo, pasajeros, pesos estimados y máximos, combustible de bloque, carga de pago). Antes de despegar, la distancia, el tiempo al destino y la llegada salen del plan. Los datos nuevos aparecen en los planes importados desde el 8 de noviembre de 2026.'],
      ['Control IVAO', 'Las posiciones de control conectadas: autorizaciones, superficie y torre en el aeropuerto, aproximación y salidas en círculo, centro de control sombreando su región. Al pulsar una estación ves su frecuencia, el tiempo en línea y el ATIS.'],
    ],
    note: 'Los datos de IVAO se actualizan cada 30 a 60 segundos y solo muestran información pública de la posición, nunca datos personales del controlador. Las regiones son aproximadas.',
    shot: {
      file: 'm-06-live',
      caption: 'Live Flights con las capas encendidas.',
      marks: ['Avión con logo y callsign', 'Estación de control de IVAO', 'Interruptores de capas'],
    },
  },
  {
    id: 'clima',
    title: 'Weather: METAR y TAF',
    summary: 'El clima de cualquier aeropuerto del mundo.',
    audience: 'all',
    steps: [
      ['Agrega aeropuertos', 'Busca en el catálogo o escribe el código ICAO. Hasta 10 a la vez; la lista se recuerda en ese navegador.'],
      ['Lee el METAR', 'Cada tarjeta muestra el reporte original, su antigüedad, la categoría de vuelo (VFR, MVFR, IFR o LIFR) y la lectura en español: viento, visibilidad, nubes, temperatura, rocío y QNH en hPa e inHg.'],
      ['El TAF', '«Ver periodos» despliega el pronóstico por bloques de tiempo.'],
      ['Se actualiza solo', 'Cada 5 minutos. El reporte avisa si tiene más de 90 minutos.'],
    ],
    note: 'Fuente: Aviation Weather Center de NOAA. Solo para simulación.',
  },
  {
    id: 'tours-eventos',
    title: 'Tours y eventos',
    summary: 'Recorridos con insignia y vuelos en grupo con ranking.',
    audience: 'all',
    steps: [
      ['Tours', 'Una serie de legs en orden. Te inscribes, reservas cada leg con la flota de tu aerolínea y al completar todos ganas la insignia, que aparece en tu Dashboard y en Settings.'],
      ['Reservar cada leg', 'En la tabla de legs del tour, cada leg tiene su botón «Reservar leg» mientras estás inscrito y aprobado. Solo ese vuelo cuenta para el tour: un vuelo normal con la misma ruta, reservado desde Flight Booking, es un vuelo de tu aerolínea y no avanza el tour. Flight Booking te avisa cuando una ruta es un leg que te falta.'],
      ['Si un leg se rechaza', 'Lo vuelves a volar. Los legs se vuelan en orden y hay un máximo en revisión a la vez.'],
      ['Eventos', 'Un vuelo en grupo con fecha y hora (folio EVT-AAAA-NNNN). Te registras, el creador aprueba tu registro y reservas desde 12 horas antes.'],
      ['Ranking', 'Cada evento premia un criterio: mejor puntaje, toma más suave, primero en llegar o mayor distancia.'],
      ['Crear uno', 'Cualquier miembro de la aerolínea propone tours y eventos; el administrador de la aerolínea los aprueba antes de publicarse.'],
      ['Modificar un tour', 'Quien lo propuso lo edita mientras es borrador o fue rechazado. Ya enviado, publicado, cerrado o con pilotos inscritos, solo lo modifican el superadministrador y el administrador de su aerolínea: código, legs, orden, aeronaves, fechas, reglas e insignia.'],
      ['Insignias', 'En Tours → «Biblioteca de insignias» hay diseños propios de LAM en oro, plata y bronce (sello, laureles, escudo, alas, hexágono, rombo, rosa de los vientos y medalla, con avión, globo, alas, estrella, brújula, audífonos, trofeo, torre o número). En el editor del tour, «Diseñar con la biblioteca» la crea con el código del tour en la cinta y la usa como su insignia; también se descarga en PNG o SVG. Recomendación: bronce para tours cortos, plata para regionales y oro para largos o exigentes.'],
      ['Medallas y reconocimientos', 'En el ranking de un evento, los tres primeros lugares llevan medalla de oro, plata y bronce. Los entrenamientos completados aparecen en el perfil con su insignia: básico bronce, intermedio plata y avanzado oro.'],
      ['Si cambian los legs', 'Los legs que siguen guardan tu avance (vuelos y PIREP ya hechos). Uno que se quita deja tus vuelos como vuelos normales; uno nuevo lo tendrás que volar. Si ya terminaste el tour, conservas la insignia.'],
    ],
  },
  {
    id: 'training',
    title: 'Training: entrenamientos',
    summary: 'Calendario de entrenamientos, inscripción con confirmación y reconocimientos en tu perfil.',
    audience: 'all',
    steps: [
      ['Calendario', 'Training muestra el mes con cada entrenamiento en su día, del color de su categoría (operaciones de vuelo, operación de aeronaves, procedimientos, navegación, ATC, meteorología, teoría, seguridad, simulador). «Lista» los ordena y filtra por próximos, tus inscripciones y anteriores. Las horas van en Zulu y en tu hora local; el clic en el reloj de arriba cambia cuál va primero y en qué fecha cae cada uno.'],
      ['Inscribirte', 'Cualquier piloto con membresía activa en cualquier aerolínea abre el entrenamiento y pulsa «Solicitar participación», con una nota opcional. Su estado se ve en la tarjeta y en el detalle: «Pendiente de confirmación», «Participación confirmada» o «No aprobada», con el comentario de quien organiza. Puedes retirarte mientras no empiece.'],
      ['Agrégalo a tu calendario', '«Agregar a mi calendario (.ics)» descarga el archivo para Outlook, Apple Calendar o cualquier calendario (con aviso 30 minutos antes); «Google Calendar» lo agrega directo. Ambos llevan el enlace de Discord y la página del entrenamiento.'],
      ['El día del entrenamiento', 'Entra al canal de Discord con el botón morado del detalle. Si hay material, también está ahí.'],
      ['Reconocimientos', 'Al terminar, el instructor marca «Completó» o «No asistió». Completar aparece en «Reconocimientos e insignias» de tu perfil de piloto.'],
      ['Programar (staff)', 'Administradores y jefes de operaciones de cualquier aerolínea (y el superadministrador) usan «Programar entrenamiento»: tema, categoría, nivel, descripción, aeronave, organizadora, fecha y hora (capturadas en Zulu o en tu hora local, se guardan en UTC), cupo, instructor (piloto de LAM o externo), enlace y canal de Discord y material. Quien programa y el instructor de LAM confirman inscripciones, pasan lista, editan o cancelan con motivo.'],
    ],
    note: 'Cada entrenamiento tiene folio TRN-AAAA-NNNN. Con cupo lleno ya no se confirma a nadie más, pero puedes dejar tu solicitud por si alguien se retira.',
    shot: {
      file: 'm-12-training-detail',
      caption: 'Detalle de un entrenamiento visto por quien lo organiza.',
      marks: ['Canal de Discord', 'Agregar al calendario (.ics)', 'Confirmar la participación'],
    },
  },
  {
    id: 'estadisticas',
    title: 'Statistics',
    summary: 'Cómo va la aerolínea y cómo vas tú.',
    audience: 'all',
    steps: [
      ['Aerolínea', 'Vuelos, horas, distancia y puntaje por mes.'],
      ['Ranking de pilotos', 'Se ordena por horas, vuelos, distancia, puntaje, toma promedio o actividad de los últimos 30 días.'],
      ['Aterrizajes', 'Promedios y proporciones de los parámetros de la toma por piloto: velocidad vertical, fuerza G y rebotes.'],
    ],
  },
  {
    id: 'staff-pilotos',
    title: 'Administrar pilotos',
    summary: 'Pilots: solicitudes, roles y habilitaciones.',
    audience: 'staff',
    steps: [
      ['Solicitudes', 'La pestaña «Solicitudes» lista a quien pidió unirse. Apruébalas o recházalas.'],
      ['Roles', 'Piloto, jefe de operaciones o administrador; valen solo dentro de esa aerolínea. Solo el superadministrador nombra administradores.'],
      ['Habilitaciones de tipo', 'Si la aerolínea exige habilitación, «Habilitaciones» define qué tipos puede reservar cada piloto. Nadie se otorga habilitaciones a sí mismo.'],
      ['Suspender', 'Una membresía suspendida conserva su historial y deja de poder reservar.'],
      ['Perfil del piloto', 'Clic en el nombre de un piloto abre su perfil completo: correo, aerolíneas y roles, totales, horas, tipos, rutas, todos sus PIREP (también los que están en revisión) e insignias.'],
    ],
  },
  {
    id: 'staff-flota-rutas',
    title: 'Flota y rutas',
    summary: 'Fleet y Routes, para el administrador de la aerolínea.',
    audience: 'admin',
    steps: [
      ['Flota', 'En Fleet das de alta cada aeronave con su matrícula, tipo y base. Las horas y ciclos los suma el sistema con cada PIREP aceptado.'],
      ['Rutas', 'En Routes, número de vuelo, origen, destino, días, horario y, si quieres, los tipos permitidos. La distancia la calcula el servidor.'],
      ['Importar rutas', '«Importar CSV» con la plantilla descargable. Antes de guardar se muestra una revisión fila por fila y se guarda todo o nada.'],
      ['Rutas pendientes', 'Las registradas por pilotos aparecen como «Pendiente» con quién las registró, y «Volada con» muestra los tipos con que se ha volado cada ruta.'],
    ],
  },
  {
    id: 'staff-politicas',
    title: 'Políticas de la aerolínea',
    summary: 'Airlines → tu aerolínea → Políticas operacionales.',
    audience: 'admin',
    steps: [
      ['Exigir habilitación de tipo', 'Apagada, cada piloto vuela el tipo que prefiera.'],
      ['Controlar la disponibilidad de la flota', 'Apagada (flota libre), cualquier piloto reserva cualquier matrícula aunque otro la tenga; se ignoran mantenimiento, fuera de servicio y ubicación.'],
      ['La aeronave debe estar en el origen', 'Encendida, solo se reserva la aeronave que está en el aeropuerto de salida.'],
      ['Los pilotos registran rutas', 'Encendida, los pilotos dan de alta rutas pendientes desde Flight Booking.'],
      ['Los pilotos reservan vuelos directos', 'Encendida, Flight Booking muestra «Reservar un nuevo vuelo directo» para volar sin una ruta registrada. El administrador siempre puede.'],
      ['Reservas y vencimiento', 'Cuántas reservas activas tiene cada piloto y en cuántas horas vence una reserva sin iniciar.'],
      ['Aprobación automática', 'Con «Aprobar PIREP automáticamente», un PIREP con el puntaje mínimo o más y sin faltas graves se acepta solo.'],
      ['Puntuación de PIREP', 'En la misma ficha se ajusta cuánto resta cada regla y su umbral.'],
    ],
    shot: {
      file: 'm-07-airline-policies',
      caption: 'Políticas operacionales de una aerolínea.',
      marks: ['Políticas de reserva y flota', 'Aprobación de PIREP'],
    },
  },
  {
    id: 'staff-operaciones',
    title: 'Operations Center y revisión de PIREP',
    summary: 'El tablero diario del jefe de operaciones.',
    audience: 'staff',
    steps: [
      ['Resumen', 'Vuelos en curso con alertas, salidas pendientes, reservas por vencer y vencidas en 24 horas.'],
      ['PIREP por revisar', 'La cola de PIREP pendientes, con los que tienen faltas graves o comentario del piloto marcados.'],
      ['Revisar', 'En el detalle del PIREP: «Aceptar» o «Rechazar» con comentario. Si una falta no aplica, «Anular falta» con el motivo.'],
      ['Rendimiento', 'Faltas frecuentes y desempeño por piloto, para saber a quién acompañar.'],
    ],
  },
  {
    id: 'super',
    title: 'Superadministración',
    summary: 'Lo que solo hace el superadministrador de LAM.',
    audience: 'super',
    steps: [
      ['Aerolíneas', 'Crear aerolíneas, activarlas y nombrar a sus administradores.'],
      ['Aeropuertos y tipos', 'Importar el catálogo de OurAirports, dar de alta aeropuertos y ajustar los tipos de aeronave, incluida la figura del mapa.'],
      ['Solicitudes de cuenta', 'Administration → «Solicitudes de cuenta» (el Dashboard avisa cuando hay pendientes). «Aprobar y enviar invitación» manda el correo de invitación; «Rechazar» la cierra con una nota opcional que la persona no ve. Una aprobada que nadie aceptó se puede reenviar; también puedes invitar a alguien directamente con su nombre y correo.'],
      ['Cuentas', 'Administration → «Cuentas» muestra a todas las personas que pueden entrar, con su número LAM, cuándo se dieron de alta, su último acceso y sus aerolíneas (activo o solicitud pendiente). El filtro «Sin aerolínea» muestra quién ya entró pero no ha pedido ingreso o aún no se lo aprueban.'],
      ['Revocar el acceso', 'En «Cuentas», «Revocar acceso» con un motivo opcional: la persona ya no puede iniciar sesión ni usar el conector y se cancelan sus reservas sin iniciar. Su historial se conserva y «Restaurar acceso» la reactiva. A otro superadministrador primero se le quita el rol; nadie se revoca a sí mismo.'],
      ['Administration', 'La bitácora de cambios administrativos de toda la plataforma (incluidas las revocaciones) y la lista de superadministradores.'],
      ['Incidencias de la plataforma', 'Los reportes que no son de una aerolínea (la web en general o el conector) llegan solo al superadministrador.'],
    ],
    note: 'Nadie puede crearse una cuenta por su cuenta, ni siquiera por la API de Supabase: el usuario solo se crea para un correo con solicitud aprobada.',
    shot: {
      file: 'm-10-account-requests',
      caption: 'Solicitudes de cuenta en Administration.',
      marks: ['Pestaña Solicitudes de cuenta', 'Datos de la solicitud', 'Aprobar y enviar invitación, o rechazar', 'Invitar a un piloto directamente'],
    },
  },
  {
    id: 'ayuda',
    title: 'Ayuda y reporte de incidencias',
    summary: 'Dónde consultar este manual y cómo reportar algo.',
    audience: 'all',
    steps: [
      ['Abre la ayuda', 'El botón del signo de interrogación en la barra superior, desde cualquier pantalla.'],
      ['Consulta', 'Guía paso a paso, preguntas frecuentes y «Si algo falla». «Descargar el manual en PDF» baja este mismo documento.'],
      ['Reporta', 'En «Reportar una incidencia» eliges el tipo (falla, mejora, duda u otro), la aerolínea, el módulo y, si aplica, el folio relacionado (PIREP, evento o callsign). El reporte lleva tu nombre y, solo, el navegador y la versión de la web.'],
      ['Sigue tu reporte', 'Cada reporte tiene folio INC-AAAA-NNNNN. En «Mis reportes» ves si está sin revisar, en revisión, resuelto o descartado, con la respuesta.'],
      ['Quién lo atiende', 'Si eliges una aerolínea, su administrador y su jefe de operaciones (y el superadministrador). Si es de la plataforma o del conector, el superadministrador.'],
      ['Para el staff', 'La pestaña «Reportes recibidos» muestra los que te tocan, con un contador en el botón de ayuda. Cambiar el estado o responder le avisa a quien lo mandó en su propia pestaña.'],
    ],
    note: 'Entre más concreto, más rápido se resuelve: en qué pantalla estabas, qué pulsaste y qué apareció. Nadie borra reportes: quedan como historial.',
    shot: {
      file: 'm-08-help-report',
      caption: 'Reportar una incidencia desde la ayuda.',
      marks: ['Botón de ayuda', 'Pestañas de la ayuda', 'Tipo, aerolínea y módulo', 'Descargar el manual en PDF'],
    },
  },
];

export const HELP_FAQ: [question: string, answer: string][] = [
  ['¿Por qué no puedo reservar ninguna aeronave?', 'La ventana de reserva dice el motivo junto a cada una: tipo no permitido en la ruta, sin habilitación, ocupada o en otro aeropuerto. Si la aerolínea exige habilitación, pídela a tu jefe de operaciones.'],
  ['La ruta que quiero volar no existe.', 'Usa «Reservar un nuevo vuelo directo» en Flight Booking: eliges origen, destino y número de vuelo. Si marcas «Registrar la ruta de este vuelo», queda guardada para otros pilotos.'],
  ['¿Puedo usar el callsign que yo quiera?', 'Sí. El callsign lo eliges en cada reserva; usa el mismo en SimBrief y en la red.'],
  ['Mi reserva desapareció.', 'Venció: si no inicias el vuelo en el plazo de la aerolínea (24 horas por omisión), se libera sola. Aparece en el historial de My Flights como vencida.'],
  ['El plan de SimBrief «no coincide con la reserva».', 'Algún dato del plan (origen, destino, tipo, matrícula o número de vuelo) es distinto al de la reserva. Usa «Crear en SimBrief» para generarlo con los datos correctos e impórtalo otra vez.'],
  ['¿Tengo que importar el plan de SimBrief?', 'Sí: es lo que deja el vuelo listo para iniciar en el conector, se compara con lo que vuelas en el PIREP y dibuja tu ruta en el mapa.'],
  ['Cargué combustible y me marcó falta grave.', 'Solo si lo cargaste después del pushback. Antes de quitar los calzos la carga es normal y solo se informa en el PIREP.'],
  ['El conector no muestra mi vuelo.', 'Solo muestra vuelos reservados con el plan importado. Revisa en My Flights que diga «Listo para iniciar en LAM ACARS» y que el equipo esté vinculado a tu cuenta.'],
  ['Se me cayó internet a medio vuelo.', 'No pasa nada: el conector guarda todo y lo envía al recuperar la conexión, sin duplicar ni perder datos.'],
  ['Cerré el conector por error.', 'Ábrelo de nuevo: el vuelo se reanuda donde iba.'],
  ['El vuelo no se cierra al llegar.', 'Necesita motores y APU apagados y el freno de estacionamiento puesto. Si aun así no cierra, usa «Terminar vuelo».'],
  ['¿Por qué mi PIREP está «pendiente»?', 'La aerolínea no aprueba automáticamente, el puntaje quedó bajo el mínimo o tiene faltas graves. Lo revisa el staff; mientras tanto puedes dejar un comentario.'],
  ['Volé la ruta de un leg y no me contó para el tour.', 'Solo cuentan los vuelos reservados desde el tour con «Reservar leg». Un vuelo reservado en Flight Booking con la misma ruta es un vuelo normal de tu aerolínea. Abre el tour y reserva ese leg desde ahí.'],
  ['Cambiaron los legs de un tour en el que voy a la mitad.', 'El administrador de la aerolínea puede ajustarlo en cualquier momento. Lo que ya volaste en los legs que siguen te cuenta; vuela los que falten. Si quitaron los que te faltaban, el tour queda terminado y ganas la insignia.'],
  ['¿Cómo actualizo el conector?', 'Pulsa «Buscar actualización» en el conector. Si hay una versión nueva y no tienes un vuelo en curso, «Descargar e instalar» lo actualiza solo. Si tienes un vuelo en curso, termínalo o abandónalo primero.'],
  ['¿Cómo me inscribo a un tour o evento?', 'En Tours o Events abre el que te interese y pulsa inscribirte o registrarte. Algunos requieren la aprobación de su creador.'],
  ['No veo la ruta del plan en el mapa.', 'Aparece para planes importados desde el 5 de noviembre de 2026. Si tu reserva es anterior, vuelve a importar el plan en My Flights.'],
  ['El control de IVAO tarda en aparecer.', 'Si nadie había abierto el mapa en un rato, la primera carga puede tardar hasta un minuto.'],
  ['¿Quién ve mis reportes de incidencia?', 'Tú y quien los atiende: el staff de la aerolínea que elegiste y el superadministrador.'],
  ['Pedí mi cuenta y no me llega ningún correo.', 'Es normal hasta que el superadministrador aprueba tu solicitud: el único correo es la invitación. Si ya pasó un tiempo, pide a tu aerolínea que la revisen. Revisa también no deseados.'],
  ['La invitación dice que el enlace venció.', 'Los enlaces duran 24 horas. Pide que te reenvíen la invitación; el nuevo enlace sustituye al anterior.'],
  ['¿Cómo sé si me confirmaron en un entrenamiento?', 'En Training, tu tarjeta muestra «Pendiente de confirmación», «Participación confirmada» o «No aprobada». También en «Mis inscripciones» y en el detalle, con el comentario del instructor.'],
  ['El entrenamiento sale a otra hora en mi calendario.', 'El archivo .ics guarda la hora en UTC y tu calendario la convierte a tu zona. Revisa que la zona de tu calendario sea la tuya; en LAM la eliges en Settings → Hora.'],
  ['¿Quién ve mi perfil de piloto?', 'Tú, el staff de tus aerolíneas, el superadministrador y los pilotos que comparten aerolínea contigo. Los demás pilotos no ven tu correo ni tus PIREP en revisión o rechazados.'],
  ['¿Cómo cambio mi foto?', 'Menú de tu cuenta → Mi cuenta → «Subir foto». PNG, JPG o WebP; se recorta en cuadro y se reduce a 256 px.'],
  ['¿Puedo volar en varias aerolíneas?', 'Sí. Solicita ingreso en cada una desde el Dashboard. Tu número de piloto es el mismo en todas.'],
];

export const HELP_TROUBLESHOOTING: [symptom: string, cause: string, fix: string][] = [
  ['La página se queda cargando', 'Se interrumpió la conexión con el servidor o una extensión del navegador bloquea la petición.', 'Recarga. Si sigue, prueba en una ventana privada para descartar las extensiones.'],
  ['«Correo o contraseña incorrectos»', 'La contraseña no coincide, o tu cuenta aún no existe porque no has aceptado la invitación.', 'Usa «Olvidé mi contraseña». Si nunca creaste tu contraseña, abre el enlace de la invitación o pide que te la reenvíen.'],
  ['«Sin aerolínea asignada»', 'Tu solicitud de ingreso sigue pendiente o no has pedido ninguna.', 'Solicita ingreso desde el Dashboard y espera la aprobación del staff.'],
  ['La reserva se rechaza', 'Una regla de la aerolínea no se cumple: tipo, habilitación, disponibilidad, máximo de reservas o membresía.', 'Lee el mensaje: dice qué regla falló. Elige otra aeronave o ruta.'],
  ['«Configura tu usuario de SimBrief»', 'Falta tu usuario de SimBrief en el perfil.', 'Escríbelo en Settings → Perfil de piloto e importa de nuevo.'],
  ['SimBrief no devuelve un plan', 'No has generado ningún plan en SimBrief o el usuario está mal escrito.', 'Genera el plan en SimBrief y revisa el usuario en Settings.'],
  ['El conector pide vincular de nuevo', 'El equipo se revocó desde la web o se borraron sus archivos.', 'Pulsa «Vincular este equipo» y escribe el código en Settings → Dispositivos ACARS.'],
  ['Windows bloquea LamAcars.exe', 'El ejecutable no está firmado.', '«Más información» → «Ejecutar de todas formas». Descárgalo solo de la página oficial de versiones.'],
  ['El conector no ve el simulador', 'MSFS no está abierto o falta SimConnect.dll junto a LamAcars.exe.', 'Abre el simulador primero y verifica que SimConnect.dll esté en la carpeta del conector.'],
  ['El avión no aparece en Live Flights', 'El conector no ha iniciado el vuelo o no hay conexión.', 'Revisa que el conector diga la fase actual y que «Pendientes de enviar» baje.'],
  ['El conector ve la APU encendida aunque la apagaste', 'Tu avión usa su propia APU y no se lo informa al simulador.', 'Con la versión más reciente del conector no impide cerrar el vuelo; si no, usa «Terminar vuelo». El PIREP la muestra como «Sin dato». Repórtalo con el nombre del avión.'],
  ['Las fases del vuelo salen raras', 'Algunos aviones publican sus datos de forma distinta.', 'Reporta una incidencia con el folio del PIREP, el avión y la bitácora de %LOCALAPPDATA%\\LamAcars\\logs.'],
  ['«Tu acceso fue revocado»', 'Un superadministrador revocó el acceso de tu cuenta.', 'Escribe al staff de tu aerolínea; solo un superadministrador puede restaurarlo.'],
  ['La página se ve vieja o rara', 'El navegador guardó una versión anterior.', 'Recarga forzando la actualización: Ctrl+Shift+R, o Cmd+Shift+R en Mac.'],
  ['Guardo algo y no se queda', 'La sesión caducó con la pestaña abierta.', 'Recarga y vuelve a entrar; lo guardado antes no se pierde.'],
];

export type TicketKind = 'error' | 'improvement' | 'question' | 'other';
export type TicketStatus = 'new' | 'in_review' | 'resolved' | 'dismissed';

export const ticketKinds: Record<TicketKind, { label: string; hint: string }> = {
  error: { label: 'Falla', hint: 'Algo no funciona como debería.' },
  improvement: { label: 'Mejora', hint: 'Funciona, pero podría servir mejor.' },
  question: { label: 'Duda', hint: 'No sabes cómo se usa algo.' },
  other: { label: 'Otro', hint: 'Cualquier otra cosa.' },
};

export const ticketStatuses: Record<TicketStatus, { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' }> = {
  new: { label: 'Sin revisar', tone: 'warn' },
  in_review: { label: 'En revisión', tone: 'info' },
  resolved: { label: 'Resuelto', tone: 'ok' },
  dismissed: { label: 'Descartado', tone: 'neutral' },
};

/** Módulos que se pueden elegir al reportar (incluye el conector, que no es una pantalla). */
export const ticketModules = [
  'Dashboard',
  'Live Flights',
  'Flight Booking',
  'My Flights',
  'Weather',
  'PIREP',
  'Events',
  'Tours',
  'Training',
  'Pilots',
  'Airlines',
  'Fleet',
  'Routes',
  'Airports',
  'Statistics',
  'Operations Center',
  'Administration',
  'Settings',
  'Conector LAM ACARS',
  'Cuenta y acceso',
  'Otro',
];

/** Cambios del manual y de la plataforma, el más reciente primero. */
export const MANUAL_CHANGES: [date: string, text: string][] = [
  ['2026-11-08', 'Biblioteca de insignias en oro, plata y bronce: diseñador para la insignia del tour, medallas del podio en los eventos e insignias de entrenamientos por nivel.'],
  ['2026-11-08', 'Conector 0.1.42: registra cada cambio de flaps (en el Fenix A320 con el nombre del retén, por ejemplo 1+F) y los muestra en la gráfica del vuelo y en la bitácora del PIREP.'],
  ['2026-11-08', 'Conector 0.1.40: botón «Siempre visible» para dejar la ventana encima del simulador.'],
  ['2026-11-08', 'Conector 0.1.36: botón «Buscar actualización» e instalación de la versión nueva desde el conector (después de terminar o abandonar el vuelo en curso).'],
  ['2026-11-08', 'Conector 0.1.34: la APU del Fenix A320 se detecta por su panel (MASTER SW y luz AVAIL).'],
  ['2026-11-08', 'Live Flights y My Flights: hoja completa del plan de SimBrief (información del vuelo, resumen del plan y hoja de carga); antes de despegar, distancia, tiempo y llegada salen del plan.'],
  ['2026-11-08', 'Tours: botón «Reservar leg» en cada leg. Solo el vuelo reservado desde el tour cuenta para el tour; Flight Booking avisa cuando una ruta es un leg que te falta.'],
  ['2026-11-08', 'Tours: el superadministrador y el administrador de la aerolínea los modifican por completo aunque estén publicados, cerrados o con pilotos con avance; el avance se conserva.'],
  ['2026-11-07', 'Idioma de lectura: español o inglés desde la barra superior (y en las pantallas de entrada).'],
  ['2026-11-07', 'Training: calendario de entrenamientos con instructor, inscripción con confirmación, horas Zulu y local, archivo .ics y Google Calendar, canal de Discord y reconocimientos en el perfil.'],
  ['2026-11-07', 'Menú de la cuenta con foto, Mi cuenta (datos personales, foto, contraseña y sesiones) y perfil completo del piloto desde Pilots.'],
  ['2026-11-07', 'Menú lateral que se oculta y botón «Ampliar» en el mapa, las tarjetas y las gráficas: pantalla completa u otra pestaña. Cerrar sesión cierra todas las pestañas.'],
  ['2026-11-07', 'PIREP: «Cambio de aeronave» solo cuando cambia el avión cargado; ya no cuando el mismo avión cambia su matrícula ATC (A380 de iniBuilds).'],
  ['2026-11-06', 'Administration → Cuentas: todas las cuentas con su último acceso y sus aerolíneas, filtro «Sin aerolínea», y revocar o restaurar el acceso.'],
  ['2026-11-06', 'Cuentas por invitación: quien quiere entrar solicita su cuenta, el superadministrador la aprueba y solo entonces llega el correo para crear la contraseña.'],
  ['2026-11-06', 'Live Flights: distancia restante por la ruta del plan de SimBrief y tiempo al destino que considera el descenso y la aproximación.'],
  ['2026-11-05', 'Flight Booking: «Reservar un nuevo vuelo directo», sin ruta registrada, con opción de registrar la ruta y plan de SimBrief en la misma ventana.'],
  ['2026-11-05', 'Live Flights: ruta del plan de SimBrief en el detalle del vuelo; distancia recorrida y por volar y tiempos en cada tarjeta.'],
  ['2026-11-05', 'Live Flights: el avión elegido ya no lleva un círculo alrededor; se resalta su etiqueta.'],
  ['2026-11-05', 'APU no informada: si la aeronave deja la APU fija en «encendida» todo el vuelo, el PIREP no cuenta esas horas y, con el conector nuevo, el vuelo se cierra sin exigir apagarla.'],
  ['2026-11-05', 'Centro de ayuda: este manual dentro de la web y en PDF, preguntas frecuentes, «Si algo falla» y reporte de incidencias con folio INC.'],
  ['2026-11-05', 'Live Flights al estilo Webeye: logo y callsign fijos, ruta del plan de SimBrief, radar, METAR y control activo de IVAO.'],
  ['2026-11-05', 'Weather: METAR y TAF de cualquier aeropuerto; clima en My Flights y en la ventana de reserva.'],
  ['2026-11-04', 'Flota libre, habilitaciones opcionales y rutas registradas por los pilotos.'],
  ['2026-11-03', 'La carga de combustible antes del pushback es normal; después del pushback es falta grave. Folio de PIREP.'],
];

export const MANUAL_UPDATED = MANUAL_CHANGES[0]![0];
