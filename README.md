# Talleres — 1era Jornada Nacional de Donación y Trasplante INCUCAI

App de inscripción a talleres simultáneos (14 y 15 de octubre 2026, Centro
Cultural de la Ciencia). Frontend estático (GitHub Pages) + backend Google
Apps Script (Web App) + Google Sheets como base de datos. Sin frameworks,
sin build. Zona horaria `America/Argentina/Buenos_Aires` en todo.

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

Tiene que devolver JSON con `"ok":true` y un array `"turnos"` con 13
elementos (`PRN-1..4`, `ECO-1..4`, `COM-1..4`, `SOC-1`).

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
| `inscripcion_abierta` | `SI` o `NO` |
| `nombre_remitente` | ya viene con el valor correcto, se puede editar |
| `reply_to` | opcional — un email al que responder los mails automáticos |
| `url_app` | la URL pública de GitHub Pages (ver paso siguiente) |

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

Corre casos de duplicado, superposición horaria, cupo, ANULADAs, etc.
contra la misma función `validar()` que usa el backend real.

### Prueba de concurrencia (contra la URL ya desplegada)

```
node tests/estres.js https://script.google.com/macros/s/AKfycb.../exec
```

Dispara 80 inscripciones concurrentes al turno `PRN-1` (cupo 60) y verifica
que el `LockService` haya serializado bien la escritura. **Corré esto antes
de anunciar la inscripción** (o contra una copia de prueba de la planilla)
— el chequeo final asume que `PRN-1` arranca en 0 ocupados.

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
