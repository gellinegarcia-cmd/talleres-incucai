/**
 * Prueba de concurrencia REALISTA contra la URL YA DESPLEGADA del Web App.
 * Node puro (fetch nativo, Node 18+), sin dependencias.
 *
 * Uso:
 *   node tests/estres.js https://script.google.com/macros/s/AKfycb.../exec
 *
 * A diferencia de la versión anterior (80 requests literalmente
 * simultáneos), esto simula 80 personas llegando en un rango de 20
 * segundos -- cada una con la MISMA lógica de reintentos que usa
 * index.html (timeout 45s, backoff ~2,4,7,10,10s ±1.5s, chequeo de
 * action=mis antes de reintentar por timeout/error de red).
 *
 * Antes de arrancar, verifica que PRN-1 esté en 0 ocupados -- si no, FRENA
 * (correr limpiarPruebas() en el editor de Apps Script primero).
 *
 * Criterio de éxito: exactamente 60 ACTIVAS, exactamente 20 rechazadas por
 * "Sin cupo", 0 sin respuesta definitiva (tras agotar reintentos).
 */

const API_URL = process.argv[2];
if (!API_URL) {
  console.error('Uso: node tests/estres.js <URL_DEL_WEB_APP>');
  process.exit(1);
}

const TURNO = 'PRN-1';
const CANTIDAD = 80;
const CUPO_ESPERADO = 60;
const RECHAZADOS_ESPERADOS = 20;
const ARRANQUE_MAX_MS = 20000; // cada cliente arranca en algun punto de esta ventana

// Misma configuracion que index.html.
const TIMEOUT_MS = 45000;
const RETRY_DELAYS_MS = [2000, 4000, 7000, 10000, 10000];
const RETRY_JITTER_MS = 1500;

function dniDePrueba(n) {
  return '99000' + String(n).padStart(3, '0'); // 99000001..99000080
}

function param(obj) {
  return Object.keys(obj)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
    .join('&');
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayConJitter(baseMs) {
  const jitter = (Math.random() * 2 - 1) * RETRY_JITTER_MS;
  return Math.max(500, baseMs + jitter);
}

function esRespuestaOcupado(data) {
  return !!data && data.ok === false && /muy ocupado/i.test(data.error || '');
}

async function fetchUnaVez(url) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controlador.signal });
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Mismo algoritmo que llamarConReintentos() en index.html. */
async function llamarConReintentos(url, dniParaCheck, emailParaCheck, onCheckMis) {
  const totalIntentos = RETRY_DELAYS_MS.length + 1;
  let ultimaRespuestaOcupado = null;
  let ultimoErrorRed = null;

  for (let intento = 1; intento <= totalIntentos; intento++) {
    let fueTimeoutORed = false;
    try {
      const data = await fetchUnaVez(url);
      if (!esRespuestaOcupado(data)) return data;
      ultimaRespuestaOcupado = data;
    } catch (e) {
      fueTimeoutORed = true;
      ultimoErrorRed = e;
    }

    if (intento === totalIntentos) break;

    if (fueTimeoutORed && dniParaCheck && emailParaCheck) {
      try {
        const mis = await fetchUnaVez(API_URL + '?' + param({ action: 'mis', dni: dniParaCheck, email: emailParaCheck }));
        if (mis && mis.ok) {
          const exito = onCheckMis ? onCheckMis(mis.mis) : null;
          if (exito) return exito;
        }
      } catch (e2) {
        // el chequeo tambien fallo -- seguimos al reintento normal.
      }
    }

    await esperar(delayConJitter(RETRY_DELAYS_MS[intento - 1]));
  }

  if (ultimaRespuestaOcupado) return ultimaRespuestaOcupado;
  throw ultimoErrorRed;
}

async function consultarTurno(id) {
  const data = await fetchUnaVez(API_URL + '?' + param({ action: 'turnos' }));
  if (!data.ok) throw new Error('action=turnos devolvio ok:false: ' + data.error);
  const t = data.turnos.find((x) => x.id === id);
  if (!t) throw new Error('No se encontro el turno ' + id + ' en la respuesta de action=turnos.');
  return t;
}

async function inscribirUno(n) {
  const dni = dniDePrueba(n);
  const email = 'prueba' + dni + '@example.com';
  const arranque = Math.random() * ARRANQUE_MAX_MS;
  await esperar(arranque);

  const t0 = Date.now();
  const datos = {
    action: 'inscribir',
    dni: dni,
    email: email,
    nombre: 'Prueba',
    apellido: 'Estres' + n,
    profesion: 'Otro',
    institucion: 'Test de carga',
    provincia: 'Buenos Aires',
    celular: '1100000000',
    turnos: TURNO,
    compromiso: 'SI'
  };
  const url = API_URL + '?' + param(datos);

  try {
    const data = await llamarConReintentos(url, dni, email, (misActuales) => {
      const activo = misActuales.some((m) => m.turno_id === TURNO);
      if (!activo) return null;
      return { ok: true, inscriptos: [{ turno_id: TURNO }], rechazados: [], mis: misActuales };
    });
    const latenciaMs = Date.now() - t0;
    const inscripto = data.ok && data.inscriptos && data.inscriptos.some((i) => i.turno_id === TURNO);
    const motivo = data.ok
      ? ((data.rechazados || []).find((r) => r.turno_id === TURNO) || {}).motivo || null
      : data.error;
    return { dni: dni, arranqueMs: arranque, latenciaMs: latenciaMs, definitiva: true, inscripto: !!inscripto, motivo: inscripto ? null : motivo };
  } catch (e) {
    const latenciaMs = Date.now() - t0;
    return { dni: dni, arranqueMs: arranque, latenciaMs: latenciaMs, definitiva: false, inscripto: false, motivo: 'SIN RESPUESTA DEFINITIVA: ' + (e && e.message ? e.message : e) };
  }
}

async function main() {
  console.log('Chequeando estado inicial de ' + TURNO + '...');
  const inicial = await consultarTurno(TURNO);
  if (inicial.ocupados > 0) {
    console.log('\nFRENADO: ' + TURNO + ' ya tiene ' + inicial.ocupados + ' ocupados (debería estar en 0 para esta prueba).');
    console.log('Corré limpiarPruebas() en el editor de Apps Script (o revisá si hay inscripciones reales en ese turno) antes de repetir.');
    process.exit(1);
  }
  console.log(TURNO + ' arranca en 0 ocupados. OK para continuar.\n');

  console.log('Lanzando ' + CANTIDAD + ' clientes (arranque aleatorio 0-' + (ARRANQUE_MAX_MS / 1000) + 's, reintentos con backoff igual que el frontend)...\n');
  const inicioTotal = Date.now();

  const promesas = [];
  for (let n = 1; n <= CANTIDAD; n++) promesas.push(inscribirUno(n));
  const resultados = await Promise.all(promesas);

  const segundosTotal = ((Date.now() - inicioTotal) / 1000).toFixed(1);

  const inscriptos = resultados.filter((r) => r.inscripto);
  const sinCupo = resultados.filter((r) => !r.inscripto && r.definitiva && /Sin cupo/.test(r.motivo || ''));
  const otroRechazo = resultados.filter((r) => !r.inscripto && r.definitiva && !/Sin cupo/.test(r.motivo || ''));
  const sinRespuesta = resultados.filter((r) => !r.definitiva);

  const latencias = resultados.map((r) => r.latenciaMs);
  const promedioMs = latencias.reduce((a, b) => a + b, 0) / latencias.length;
  const maxMs = Math.max.apply(null, latencias);

  console.log('=== RESULTADO ===');
  console.log('Tiempo total de la corrida: ' + segundosTotal + 's');
  console.log('Latencia promedio por cliente: ' + (promedioMs / 1000).toFixed(1) + 's');
  console.log('Latencia máxima: ' + (maxMs / 1000).toFixed(1) + 's');
  console.log('');
  console.log('Inscriptos:                 ' + inscriptos.length + ' (esperado ' + CUPO_ESPERADO + ')');
  console.log('Rechazados por sin cupo:    ' + sinCupo.length + ' (esperado ' + RECHAZADOS_ESPERADOS + ')');
  console.log('Rechazados por otro motivo: ' + otroRechazo.length + ' (esperado 0)');
  console.log('Sin respuesta definitiva:   ' + sinRespuesta.length + ' (esperado 0)');

  if (otroRechazo.length > 0) {
    console.log('\nOtros motivos de rechazo (no debería haber ninguno):');
    otroRechazo.forEach((r) => console.log('  ' + r.dni + ': ' + r.motivo));
  }
  if (sinRespuesta.length > 0) {
    console.log('\nSin respuesta definitiva tras agotar reintentos:');
    sinRespuesta.forEach((r) => console.log('  ' + r.dni + ': ' + r.motivo));
  }

  console.log('\nConsultando action=turnos para verificar el cupo final de ' + TURNO + '...');
  const final = await consultarTurno(TURNO);
  console.log(TURNO + ': ' + final.ocupados + '/' + final.cupo + ' ocupados (disponibles: ' + final.disponibles + ').');

  const pasa =
    inscriptos.length === CUPO_ESPERADO &&
    sinCupo.length === RECHAZADOS_ESPERADOS &&
    otroRechazo.length === 0 &&
    sinRespuesta.length === 0 &&
    final.ocupados === CUPO_ESPERADO;

  console.log('\n' + (pasa ? 'PASS' : 'FAIL'));
  console.log('\nNo te olvides de correr limpiarPruebas() en el editor de Apps Script para borrar estas filas de prueba (DNI 99000...).');

  process.exitCode = pasa ? 0 : 1;
}

main().catch((e) => {
  console.error('Error fatal en la prueba de estrés: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
