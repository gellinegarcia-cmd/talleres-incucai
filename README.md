# Talleres — Encuentro Nacional Innovación y Nuevas Tecnologías en Donación y Trasplante

App de inscripción a talleres simultáneos (14 y 15 de octubre 2026, Centro
Cultural de la Ciencia). Frontend estático (GitHub Pages) + backend Google
Apps Script (Web App) + Google Sheets como base de datos. Sin frameworks,
sin build. Zona horaria `America/Argentina/Buenos_Aires` en todo.

## ESTADO AL 02/10

Versión unificada: **un solo link, sin fases ni tokens**. Reemplaza por
completo el esquema de fase 1 (prioritaria, por token) que describía esta
sección hasta el 27/09.

**En producción:**

- **Un solo link para todos**, sin `?t=...` ni preasignación. El concepto
  de fase 1/tokens/"Inscripción prioritaria" se sacó del flujo visible;
  un link viejo con `?t=...` muestra exactamente lo mismo que el link
  general (el parámetro se ignora).
- **Tope de 2 talleres por persona** (antes no había tope, solo "no
  repetir el mismo taller"). Se valida en `validar()` — una sola fuente
  de verdad para self-service, alta manual y mover desde el Panel.
- **12 turnos definitivos, letras A-L** (reemplazan los 13 anteriores,
  numerados 1-4 por taller). Ver `TURNOS_DEFINITIVOS` en `Code.gs`. Cada
  turno tiene además una columna `letra` (en Turnos e Inscripciones,
  agregada al final para no romper las fórmulas de Resumen/hojas de
  taller/Por persona, que referencian columnas A..G/A..R por letra fija).
- **Cierre automático** (`Config!cierre`, formato `YYYY-MM-DD HH:MM` hora
  Argentina): pasada esa fecha/hora, el servidor rechaza inscripciones
  nuevas y la app muestra el mensaje de cierre en vez del formulario.
  Anular sigue funcionando después del cierre (libera cupo); el Panel
  (alta manual y mover) también sigue funcionando — es el admin.
- **Panel compartido con el jefe del comité** (hoja `Panel`, primera
  pestaña): ve cupos, da de baja, mueve de turno y da altas manuales.
  Solo esa hoja es editable para él — el resto de las hojas de datos
  están protegidas (solo el dueño de la planilla edita).
- **Log completo de mails en `ColaMails`**: todo envío (exitoso,
  pendiente o con error) queda registrado ahí con estado
  `ENVIADO`/`PENDIENTE`/`ERROR`. Correr `probarMail()` en el editor si
  hace falta diagnosticar un problema de envío puntual.
- La hoja `Prioridad` sigue existiendo (no se borró, por si queda algo
  cargado de antes) pero ya no la lee ningún código.

**URLs y despliegue:**

- Frontend (GitHub Pages): `https://gellinegarcia-cmd.github.io/talleres-incucai/`
- Backend (Web App `/exec`) y `deploymentId`: ver el bloque
  "Despliegue con clasp" más abajo (misma URL/ID que usa `index.html` en
  `API_URL` — no cambiaron durante todo el proyecto).
- Regla de deploy: **`clasp push` y después `clasp deploy -i <deploymentId>` — nunca `clasp deploy` sin `-i`** (crea una URL nueva y
  rompe el frontend, que tiene la URL vieja hardcodeada).

**Migración (una sola vez):** correr `migrarOctubre()` desde el editor de
Apps Script -- hace backup de Turnos/Inscripciones (hojas nuevas
`Backup ...`, quedan ocultas), reemplaza Turnos por los 12 definitivos,
vacía Inscripciones/ColaMails (quedan los encabezados), actualiza
`Config!nombre_remitente`/`Config!cierre`, y regenera el Panel. Ver
"Migración a la versión unificada" más abajo.

**PENDIENTES:**

a. **Mail de confirmación + recordatorio a todos los inscriptos**, a
   mandar entre el **9 y el 12/10**, en tandas por el límite de
   ~100 mails/día de una cuenta Gmail común (`MailApp.getRemainingDailyQuota()`).
   No hay una función lista para esto todavía — cuando se retome, hay que
   escribir el envío masivo respetando ese límite diario (podría
   apoyarse en el mismo mecanismo de cola de `ColaMails`/`procesarCola`).
b. **Confirmar horario y aula de "Cómo acompañar a los pacientes..."**
   (`SOC-H` en la hoja `Turnos`): quedó cargado como único turno del
   taller (14:00-17:00, Sala B, 15/10, cupo 50) pero falta la
   confirmación final del comité — si cambia, hay que actualizar esa
   fila en `Turnos` (la hoja `Resumen` y el Panel se actualizan solos a
   partir de ahí, no hace falta tocar código).

## Estructura

```
index.html                    frontend (single file, CSS y JS inline)
apps-script/Code.gs            backend — se sube con clasp (ver "Despliegue con clasp")
apps-script/appsscript.json    manifest del proyecto de Apps Script (timezone, webapp, runtime)
.clasp.json                    config de clasp (scriptId, rootDir) — sin credenciales
tests/logica.test.js           tests de la lógica de validación (Node, sin deps)
tests/estres.js                prueba de concurrencia contra la URL desplegada
```

## Despliegue con clasp (regla permanente)

**De acá en más, el repo es la única fuente de verdad para `Code.gs`.
Nadie edita directo en el editor de Apps Script** — todo cambio pasa por
el repo:

1. Editar `apps-script/Code.gs` (y `apps-script/appsscript.json` si hace
   falta) en el repo. Commit y push como cualquier otro cambio.
2. `clasp push` — sube el contenido de `apps-script/` (según `rootDir` en
   `.clasp.json`) al proyecto de Apps Script.
3. `clasp deploy -i AKfycby3w-MGZTKiwp7rZK169t-0GQ7ebHvcbyAHyL_HVPbgovDNaALXWbWtf2gFOAs2Gob4mw -d "descripción del cambio"`
   — actualiza la implementación **existente** (la de la URL `/exec` real
   que ya usa `index.html`).

**NUNCA `clasp deploy` sin `-i`.** Sin ese flag, clasp crea una
implementación nueva con una URL `/exec` **distinta** — el frontend, que
ya tiene la URL vieja hardcodeada en `API_URL`, deja de funcionar contra
el código nuevo.

Después de cada deploy, verificar que haya salido bien:

```
curl -sL "https://script.google.com/macros/s/AKfycby3w-MGZTKiwp7rZK169t-0GQ7ebHvcbyAHyL_HVPbgovDNaALXWbWtf2gFOAs2Gob4mw/exec?action=turnos"
```

Tiene que devolver JSON con `"ok":true` y un array `"turnos"` con 12
elementos (`PRN-A..D`, `COM-E`, `ECO-F..G`, `SOC-H`, `COM-I..J`, `ECO-K..L`).
Un `?t=` con cualquier valor (o ninguno) tiene que devolver exactamente lo
mismo -- el token ya no afecta nada.

Requiere estar logueado una vez con `clasp login` (cuenta
`jornadas.donacion.incucai@gmail.com` — elegirla en el navegador que abre
el login). Las credenciales quedan en `~/.clasprc.json`, **nunca se
commitean** (vive en el home del usuario, fuera del repo).

## 1. Crear la planilla y pegar Code.gs

*(Paso histórico — la planilla y el proyecto de Apps Script ya existen.
Esto queda como referencia de cómo se armó la primera vez; para cambios
nuevos usar la sección "Despliegue con clasp" de arriba, no este paso.)*

1. Creá una Google Sheet nueva (en blanco), ponele el nombre que quieras.
2. `Extensiones` → `Apps Script`.
3. Borrá el contenido de `Código.gs` que trae por defecto y pegá **todo**
   el contenido de [`apps-script/Code.gs`](apps-script/Code.gs) de este repo.
4. Guardá (ícono de disquete o `Ctrl+S`).

## 2. Correr el setup (en este orden)

En el editor de Apps Script, con `Code.gs` abierto:

1. En el desplegable de funciones (arriba, al lado del ícono ▶️), elegí
   **`setup`** y hacé clic en **Ejecutar**.
   - La primera vez va a pedir autorización: `Revisar permisos` → elegí tu
     cuenta → `Avanzado` → `Ir a (nombre del proyecto), no seguro` →
     `Permitir`. Es tu propio script, el aviso de "no seguro" es el
     estándar de Google para cualquier Apps Script sin verificar.
   - `setup()` es idempotente: podés volver a correrlo después sin miedo a
     duplicar hojas, encabezados ni los turnos precargados.
2. Elegí **`instalarTrigger`** y ejecutá. Esto crea el trigger horario que
   procesa la cola de mails pendientes (`procesarCola`). También es
   idempotente — no crea un segundo trigger si ya existe uno.

Después de esto, la planilla va a tener las hojas: `Config`, `Turnos`,
`Inscripciones`, `Resumen`, `PRN`, `ECO`, `COM`, `SOC`, `Por persona`,
`ColaMails` — las 4 hojas de taller y "Resumen" son de **solo lectura**
(fórmulas); no cargues nada a mano ahí.

## 3. Desplegar como Web App

*(Paso histórico — la implementación ya existe, con `deploymentId`
`AKfycby3w-MGZTKiwp7rZK169t-0GQ7ebHvcbyAHyL_HVPbgovDNaALXWbWtf2gFOAs2Gob4mw`
y esa es la URL `/exec` que ya tiene cargada `index.html`. Para volver a
desplegar después de un cambio, usar `clasp deploy -i` — ver "Despliegue
con clasp" arriba, **no** el flujo manual de `Implementar` en el editor.)*

1. Arriba a la derecha, `Implementar` → `Nueva implementación`.
2. Ícono de engranaje junto a "Seleccionar tipo" → `Aplicación web`.
3. Configuración:
   - **Ejecutar como:** `Yo` (tu cuenta).
   - **Quién tiene acceso:** `Cualquier persona`.
4. `Implementar`. Copiá la **URL de la aplicación web** (termina en
   `/exec`) — la vas a necesitar en dos lugares:
   - En `index.html`, reemplazando `PEGAR_URL_APPS_SCRIPT` en la constante
     `API_URL` (arriba del `<script>`).
   - En la hoja `Config`, fila `url_app` — se usa en el link del mail de
     inscripción para que la gente pueda anular.

## 4. Configurar `Config`

En la hoja `Config` de la planilla:

| clave | qué poner |
|---|---|
| `inscripcion_abierta` | `SI` o `NO` — apagado manual total (independiente del cierre por fecha) |
| `nombre_remitente` | ya viene con el valor correcto, se puede editar |
| `reply_to` | opcional — un email al que responder los mails automáticos |
| `url_app` | la URL pública de GitHub Pages (ver paso siguiente) |
| `cierre` | `YYYY-MM-DD HH:MM`, hora Argentina (ej: `2026-10-06 12:00`). Vacío = nunca cierra solo. |

## 5. Publicar el frontend en GitHub Pages

1. `Settings` del repo → `Pages`.
2. `Source`: `Deploy from a branch`.
3. `Branch`: `main` / `(root)` → `Save`.
4. GitHub tarda uno o dos minutos en publicar. La URL queda con el formato
   `https://gellinegarcia-cmd.github.io/talleres-incucai/`.
5. Cargá esa URL en `Config!url_app` (paso 4) para que el mail de
   inscripción linkee a la app real.

## 6. Tests

### Lógica de validación (local, sin tocar la planilla)

```
node tests/logica.test.js
```

Corre casos de duplicado, superposición horaria, cupo, ANULADAs, tope de 2
talleres por persona, mismo taller en distinto día, y cierre automático
(antes/después de `Config!cierre`) -- todo contra la misma función
`validar()`/`inscripcionesCerradas_()` que usa el backend real.

### Prueba de concurrencia (contra la URL ya desplegada)

```
node tests/estres.js https://script.google.com/macros/s/AKfycb.../exec
```

Dispara 80 inscripciones concurrentes al turno `PRN-A` (cupo 60) y verifica
que el `LockService` haya serializado bien la escritura. **Corré esto antes
de anunciar la inscripción** (o contra una copia de prueba de la planilla)
— el chequeo final asume que `PRN-A` arranca en 0 ocupados.

## Migración a la versión unificada

`migrarOctubre()` (en `Code.gs`) se corre UNA sola vez, a mano, desde el
editor de Apps Script -- no tiene UI ni se dispara sola:

1. Backup (solo valores) de `Turnos` e `Inscripciones` en hojas nuevas
   `Backup Turnos <fecha_hora>` / `Backup Inscripciones <fecha_hora>`
   (quedan ocultas automáticamente).
2. Reemplaza `Turnos` por los 12 definitivos (A-L).
3. Vacía `Inscripciones` y `ColaMails` (quedan los encabezados).
4. Actualiza `Config!nombre_remitente` y `Config!cierre` (`2026-10-06 12:00`).
5. Regenera el Panel.

Al terminar, el log (`Ver` → `Registros de ejecución` en el editor) muestra
cuántas filas de datos se movieron a cada backup.

Al terminar, en el editor de Apps Script corré **`limpiarPruebas`** para
borrar las filas de prueba (DNI que empieza con `99000`).

## Notas de diseño

- El cupo ocupado se calcula siempre contando filas `ACTIVA` en el momento
  de cada consulta — nunca con un contador guardado. Anular una fila (o
  editarla a mano en la planilla) libera el cupo al instante.
- Todas las peticiones del frontend son `GET` con parámetros
  `encodeURIComponent` (nunca `POST` con JSON) para evitar preflight CORS
  contra el Web App de Apps Script.
- `validar()` en `Code.gs` es una función pura (sin `SpreadsheetApp`,
  `MailApp` ni ninguna API de Google) — por eso se puede testear con el
  mismo código en Node.
