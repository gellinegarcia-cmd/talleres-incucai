/**
 * Prueba de concurrencia contra la URL YA DESPLEGADA del Web App.
 * Node puro (fetch nativo, Node 18+), sin dependencias.
 *
 * Uso:
 *   node tests/estres.js https://script.google.com/macros/s/AKfycb.../exec
 *
 * Dispara 80 inscripciones concurrentes (DNIs 99000001..99000080) al turno
 * PRN-1 (cupo 60) y al final verifica que action=turnos reporte exactamente
 * 60 ocupados en PRN-1 -- es decir, que el LockService haya serializado
 * bien la escritura incluso bajo concurrencia real (nadie se coló pasado el
 * cupo, y nadie se perdió por una carrera).
 *
 * IMPORTANTE: esta verificación asume que PRN-1 arranca en 0 ocupados
 * (hoja recién armada con setup(), antes de que se registre gente real).
 * Si ya hay inscripciones reales en PRN-1 al correr esto, el chequeo final
 * de "exactamente 60" va a dar falso negativo aunque el sistema esté bien
 * -- correr esto ANTES de anunciar la inscripción, o contra una copia de
 * prueba de la planilla.
 *
 * Al terminar, correr limpiarPruebas() en el editor de Apps Script para
 * borrar las filas de prueba (DNI que empieza con 99000).
 */

const API_URL = process.argv[2];
if (!API_URL) {
  console.error('Uso: node tests/estres.js <URL_DEL_WEB_APP>');
  process.exit(1);
}

const TURNO = 'PRN-1';
const CANTIDAD = 80;
const CUPO_ESPERADO = 60;
const MAX_REINTENTOS_RED = 3;

function dniDePrueba(n) {
  return '99000' + String(n).padStart(3, '0'); // 99000001..99000080
}

function param(obj) {
  return Object.keys(obj)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
    .join('&');
}

/** Reintenta SOLO errores de red (fetch que tira excepción) -- un JSON con
 * ok:false es una respuesta válida del servidor (ej. "sin cupo"), no un
 * error de red, y no se reintenta. */
async function fetchJsonConReintentoDeRed(url) {
  let ultimoError;
  for (let intento = 1; intento <= MAX_REINTENTOS_RED; intento++) {
    try {
      const resp = await fetch(url);
      return await resp.json();
    } catch (e) {
      ultimoError = e;
      await new Promise((r) => setTimeout(r, 300 * intento));
    }
  }
  throw ultimoError;
}

async function inscribirUno(n) {
  const dni = dniDePrueba(n);
  const email = 'prueba' + dni + '@example.com';
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
    const data = await fetchJsonConReintentoDeRed(url);
    const inscripto = data.ok && data.inscriptos && data.inscriptos.some((i) => i.turno_id === TURNO);
    const motivo = data.ok
      ? (data.rechazados.find((r) => r.turno_id === TURNO) || {}).motivo || null
      : data.error;
    return { dni, ok: true, inscripto: !!inscripto, motivo };
  } catch (e) {
    return { dni, ok: false, inscripto: false, motivo: 'ERROR DE RED: ' + e.message };
  }
}

async function consultarOcupadosPRN1() {
  const data = await fetchJsonConReintentoDeRed(API_URL + '?' + param({ action: 'turnos' }));
  if (!data.ok) throw new Error('action=turnos devolvió ok:false: ' + data.error);
  const turno = data.turnos.find((t) => t.id === TURNO);
  if (!turno) throw new Error('No se encontró el turno ' + TURNO + ' en la respuesta de action=turnos.');
  return turno;
}

async function main() {
  console.log('Disparando ' + CANTIDAD + ' inscripciones concurrentes a ' + TURNO + ' (cupo ' + CUPO_ESPERADO + ')...');
  const inicio = Date.now();

  const promesas = [];
  for (let n = 1; n <= CANTIDAD; n++) promesas.push(inscribirUno(n));
  const resultados = await Promise.all(promesas);

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log('Terminó en ' + segundos + 's.\n');

  const inscriptos = resultados.filter((r) => r.inscripto);
  const sinCupo = resultados.filter((r) => !r.inscripto && r.ok && /Sin cupo/.test(r.motivo || ''));
  const erroresRed = resultados.filter((r) => !r.ok);
  const otrosRechazos = resultados.filter((r) => !r.inscripto && r.ok && !/Sin cupo/.test(r.motivo || ''));

  console.log('Inscriptos:              ' + inscriptos.length);
  console.log('Rechazados por sin cupo: ' + sinCupo.length);
  console.log('Rechazados por otro motivo: ' + otrosRechazos.length);
  console.log('Errores de red (tras ' + MAX_REINTENTOS_RED + ' reintentos): ' + erroresRed.length);

  if (otrosRechazos.length > 0) {
    console.log('\nMotivos de "otro rechazo" (no debería haber ninguno en una corrida limpia):');
    otrosRechazos.forEach((r) => console.log('  ' + r.dni + ': ' + r.motivo));
  }
  if (erroresRed.length > 0) {
    console.log('\nDNIs con error de red:');
    erroresRed.forEach((r) => console.log('  ' + r.dni + ': ' + r.motivo));
  }

  console.log('\nConsultando action=turnos para verificar el cupo final de ' + TURNO + '...');
  const turno = await consultarOcupadosPRN1();
  console.log(TURNO + ': ' + turno.ocupados + '/' + turno.cupo + ' ocupados (disponibles: ' + turno.disponibles + ').');

  const pasa = turno.ocupados === CUPO_ESPERADO;
  console.log('\n' + (pasa ? 'PASS' : 'FAIL') + ': se esperaban exactamente ' + CUPO_ESPERADO + ' ocupados en ' + TURNO + ', hay ' + turno.ocupados + '.');

  if (!pasa) {
    console.log('Recordá: este chequeo asume que ' + TURNO + ' arrancó en 0 ocupados antes de correr esta prueba.');
  }
  console.log('\nNo te olvides de correr limpiarPruebas() en el editor de Apps Script para borrar estas filas de prueba (DNI 99000...).');

  process.exitCode = pasa ? 0 : 1;
}

main().catch((e) => {
  console.error('Error fatal en la prueba de estrés: ' + e.message);
  process.exit(1);
});
