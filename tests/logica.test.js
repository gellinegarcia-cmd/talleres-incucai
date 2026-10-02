/**
 * Tests de la lógica de validación de apps-script/Code.gs (versión
 * unificada de octubre: un solo link, tope de 2 talleres, cierre
 * automático). Node puro, sin dependencias. Corre con: node tests/logica.test.js
 *
 * Code.gs no se puede `require()` directo (extensión .gs, y además define
 * funciones que llaman a SpreadsheetApp/MailApp/etc. a nivel de módulo no
 * existen en Node) -- pero esas APIs de Google solo se INVOCAN adentro de
 * funciones que acá nunca llamamos. Evaluamos el archivo completo en un
 * sandbox de `vm`: se definen todas las funciones sin problema, y leemos
 * module.exports (que Code.gs llena al final con un guard `typeof module`).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rutaCodeGs = path.join(__dirname, '..', 'apps-script', 'Code.gs');
const codigo = fs.readFileSync(rutaCodeGs, 'utf8');
const sandbox = { module: { exports: {} }, console: console };
vm.createContext(sandbox);
vm.runInContext(codigo, sandbox, { filename: 'Code.gs' });
const { validar, validarDatosGenerales, parsearFechaHoraArg_, inscripcionesCerradas_, MAX_TALLERES_POR_PERSONA } = sandbox.module.exports;

if (typeof validar !== 'function') {
  console.error('FAIL fatal: no se pudo extraer validar() de Code.gs (¿cambió el bloque module.exports?).');
  process.exit(1);
}
if (typeof inscripcionesCerradas_ !== 'function') {
  console.error('FAIL fatal: no se pudo extraer la lógica de cierre de Code.gs (¿cambió el bloque module.exports?).');
  process.exit(1);
}

// ================== FIXTURE: los 12 turnos definitivos (A-L) ==================

const TALLER_PRN = 'Donación en asistolia controlada y perfusión regional normotérmica';
const TALLER_COM = 'Comunicación en el proceso de donación';
const TALLER_ECO = 'Ultrasonografía en el proceso de donación';
const TALLER_SOC = 'Cómo acompañar a los pacientes: redes, barreras y estrategias desde lo social';

const TURNOS = [
  { id: 'PRN-A', letra: 'A', taller: TALLER_PRN, aula: 'Sala 1', fecha: '2026-10-14', inicio: '10:00', fin: '11:30', cupo: 60, activo: 'SI' },
  { id: 'PRN-B', letra: 'B', taller: TALLER_PRN, aula: 'Sala 1', fecha: '2026-10-14', inicio: '11:30', fin: '13:00', cupo: 60, activo: 'SI' },
  { id: 'PRN-C', letra: 'C', taller: TALLER_PRN, aula: 'Sala 1', fecha: '2026-10-14', inicio: '14:00', fin: '15:30', cupo: 60, activo: 'SI' },
  { id: 'PRN-D', letra: 'D', taller: TALLER_PRN, aula: 'Sala 1', fecha: '2026-10-14', inicio: '15:30', fin: '17:00', cupo: 60, activo: 'SI' },
  { id: 'COM-E', letra: 'E', taller: TALLER_COM, aula: 'Sala 2', fecha: '2026-10-14', inicio: '10:30', fin: '12:00', cupo: 25, activo: 'SI' },
  { id: 'ECO-F', letra: 'F', taller: TALLER_ECO, aula: 'Sala 2', fecha: '2026-10-14', inicio: '14:00', fin: '15:30', cupo: 30, activo: 'SI' },
  { id: 'ECO-G', letra: 'G', taller: TALLER_ECO, aula: 'Sala 2', fecha: '2026-10-14', inicio: '15:30', fin: '17:00', cupo: 30, activo: 'SI' },
  { id: 'SOC-H', letra: 'H', taller: TALLER_SOC, aula: 'Sala 2', fecha: '2026-10-15', inicio: '14:00', fin: '17:00', cupo: 50, activo: 'SI' },
  { id: 'COM-I', letra: 'I', taller: TALLER_COM, aula: 'Sala 1', fecha: '2026-10-15', inicio: '09:30', fin: '11:00', cupo: 25, activo: 'SI' },
  { id: 'COM-J', letra: 'J', taller: TALLER_COM, aula: 'Sala 1', fecha: '2026-10-15', inicio: '11:30', fin: '13:00', cupo: 25, activo: 'SI' },
  { id: 'ECO-K', letra: 'K', taller: TALLER_ECO, aula: 'Sala 1', fecha: '2026-10-15', inicio: '14:00', fin: '15:30', cupo: 30, activo: 'SI' },
  { id: 'ECO-L', letra: 'L', taller: TALLER_ECO, aula: 'Sala 1', fecha: '2026-10-15', inicio: '15:30', fin: '17:00', cupo: 30, activo: 'SI' }
];

function turnoPorId(id) {
  const t = TURNOS.find((x) => x.id === id);
  if (!t) throw new Error('Turno de fixture inexistente: ' + id);
  return t;
}

/** Construye una fila de "Inscripciones" ya existente, coherente con TURNOS. */
function ins(turnoId, dni, estado) {
  const t = turnoPorId(turnoId);
  return { dni, turno_id: turnoId, taller: t.taller, fecha: t.fecha, horario: t.inicio + '-' + t.fin, estado, letra: t.letra };
}

// ================== RUNNER MÍNIMO ==================

let pasados = 0;
let fallados = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Falló la aserción.');
}

function test(nombre, fn) {
  try {
    fn();
    console.log('PASS - ' + nombre);
    pasados++;
  } catch (e) {
    console.log('FAIL - ' + nombre);
    console.log('       ' + e.message);
    fallados++;
  }
}

// ================== CASOS GENERALES (duplicado, cupo, ANULADA, etc.) ==================

test('duplicado exacto: ya inscripto/a en ese mismo turno', () => {
  const solicitud = { dni: '30111111', turnoIds: ['PRN-A'] };
  const existentes = [ins('PRN-A', solicitud.dni, 'ACTIVA')];
  const r = validar(solicitud, existentes, TURNOS);
  assert(r.inscriptos.length === 0, 'no debería inscribir de nuevo');
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'PRN-A');
  assert(/Ya estás inscripto\/a en este taller/.test(r.rechazados[0].motivo), 'motivo: ' + r.rechazados[0].motivo);
});

test('mismo taller, otro horario: el motivo incluye el horario anterior', () => {
  const solicitud = { dni: '30222222', turnoIds: ['PRN-B'] };
  const existentes = [ins('PRN-A', solicitud.dni, 'ACTIVA')]; // PRN-A: 10:00 a 11:30
  const r = validar(solicitud, existentes, TURNOS);
  assert(r.inscriptos.length === 0);
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'PRN-B');
  assert(/10:00 a 11:30/.test(r.rechazados[0].motivo), 'debe mencionar el horario anterior. motivo: ' + r.rechazados[0].motivo);
  assert(/primero anulá esa inscripción/.test(r.rechazados[0].motivo));
});

test('caso borde: ECO-F (14:00-15:30) + PRN-D (15:30-17:00) -- fin=inicio no superpone', () => {
  const solicitud = { dni: '30555555', turnoIds: ['ECO-F', 'PRN-D'] };
  const r = validar(solicitud, [], TURNOS);
  assert(r.inscriptos.length === 2, JSON.stringify(r));
  assert(r.rechazados.length === 0, JSON.stringify(r));
});

test('sin cupo: turno lleno rechaza con el motivo de cupo', () => {
  const turnoChico = { id: 'TEST-CUPO-1', letra: 'Z', taller: 'Taller de prueba', aula: 'Aula X', fecha: '2026-10-14', inicio: '09:00', fin: '10:00', cupo: 1, activo: 'SI' };
  const turnosTest = TURNOS.concat([turnoChico]);
  const existentes = [{ dni: '30999901', turno_id: 'TEST-CUPO-1', taller: 'Taller de prueba', fecha: '2026-10-14', horario: '09:00-10:00', estado: 'ACTIVA', letra: 'Z' }];
  const solicitud = { dni: '30666666', turnoIds: ['TEST-CUPO-1'] };
  const r = validar(solicitud, existentes, turnosTest);
  assert(r.inscriptos.length === 0);
  assert(r.rechazados.length === 1 && /Sin cupo disponible/.test(r.rechazados[0].motivo), JSON.stringify(r));
});

test('una ANULADA no cuenta para cupo ni para duplicado', () => {
  const turnoChico = { id: 'TEST-CUPO-2', letra: 'Z', taller: 'Taller de prueba 2', aula: 'Aula X', fecha: '2026-10-14', inicio: '09:00', fin: '10:00', cupo: 1, activo: 'SI' };
  const turnosTest = TURNOS.concat([turnoChico]);
  const dniAnulado = '30777777';
  const existentes = [{ dni: dniAnulado, turno_id: 'TEST-CUPO-2', taller: 'Taller de prueba 2', fecha: '2026-10-14', horario: '09:00-10:00', estado: 'ANULADA', letra: 'Z' }];

  const r1 = validar({ dni: dniAnulado, turnoIds: ['TEST-CUPO-2'] }, existentes, turnosTest);
  assert(r1.inscriptos.length === 1, 'debería poder re-inscribirse tras anular: ' + JSON.stringify(r1));

  const r2 = validar({ dni: '30888888', turnoIds: ['TEST-CUPO-2'] }, existentes, turnosTest);
  assert(r2.inscriptos.length === 1, 'el cupo no debería contar la anulada: ' + JSON.stringify(r2));
});

// ================== TOPE DE 2 TALLERES POR PERSONA ==================

test('tope: ya tiene 2 activas (de talleres distintos) -- un 3ro se rechaza con el mensaje del tope', () => {
  const dni = '30900001';
  const existentes = [ins('PRN-A', dni, 'ACTIVA'), ins('ECO-F', dni, 'ACTIVA')];
  const r = validar({ dni, turnoIds: ['SOC-H'] }, existentes, TURNOS);
  assert(r.inscriptos.length === 0, JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'SOC-H');
  assert(/máximo de 2 talleres/.test(r.rechazados[0].motivo), 'motivo: ' + r.rechazados[0].motivo);
  assert(/Ya estás inscripto\/a en:/.test(r.rechazados[0].motivo), 'motivo: ' + r.rechazados[0].motivo);
  assert(/primero anulá uno/.test(r.rechazados[0].motivo), 'motivo: ' + r.rechazados[0].motivo);
});

test('tope: en una sola solicitud, 3 turnos de talleres distintos sin solapar -- acepta los primeros 2, rechaza el 3ro por tope', () => {
  const r = validar({ dni: '30900002', turnoIds: ['PRN-A', 'ECO-F', 'COM-J'] }, [], TURNOS);
  assert(r.inscriptos.length === 2 && r.inscriptos[0].turno_id === 'PRN-A' && r.inscriptos[1].turno_id === 'ECO-F', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'COM-J');
  assert(/máximo de 2 talleres/.test(r.rechazados[0].motivo), 'motivo: ' + r.rechazados[0].motivo);
});

test('tope: con 1 activa existente + 1 en la misma solicitud ya alcanza el tope -- rechaza un 3er turno', () => {
  const dni = '30900003';
  const existentes = [ins('PRN-A', dni, 'ACTIVA')];
  const r = validar({ dni, turnoIds: ['ECO-F', 'COM-J'] }, existentes, TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'ECO-F', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'COM-J');
  assert(/máximo de 2 talleres/.test(r.rechazados[0].motivo));
});

// ================== MISMO TALLER (incluso en otro día) ==================

test('mismo taller en distinto día rechazado: ECO-F (14/10) + ECO-K (15/10)', () => {
  const r = validar({ dni: '30301001', turnoIds: ['ECO-F', 'ECO-K'] }, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'ECO-F', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'ECO-K');
  assert(/Ya elegiste un turno de/.test(r.rechazados[0].motivo), 'motivo: ' + r.rechazados[0].motivo);
});

test('mismo taller en distinto día rechazado: COM-E (14/10) + COM-I (15/10)', () => {
  const r = validar({ dni: '30301002', turnoIds: ['COM-E', 'COM-I'] }, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'COM-E', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'COM-I');
});

test('COM-I + COM-J: mismo taller, mismo día -- rechaza el segundo', () => {
  const r = validar({ dni: '30301003', turnoIds: ['COM-I', 'COM-J'] }, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'COM-I', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'COM-J');
  assert(/Ya elegiste un turno de/.test(r.rechazados[0].motivo));
});

// ================== SUPERPOSICIÓN HORARIA ENTRE TALLERES DISTINTOS ==================

test('COM-E (10:30-12:00) superpone con PRN-A (10:00-11:30)', () => {
  const r = validar({ dni: '30302001', turnoIds: ['PRN-A', 'COM-E'] }, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'PRN-A', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'COM-E');
  assert(/Se superpone con/.test(r.rechazados[0].motivo), 'motivo: ' + r.rechazados[0].motivo);
});

test('COM-E (10:30-12:00) superpone con PRN-B (11:30-13:00)', () => {
  const r = validar({ dni: '30302002', turnoIds: ['PRN-B', 'COM-E'] }, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'PRN-B', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'COM-E');
});

test('PRN-C + COM-E: válido, sin superposición (14-15:30 no toca 10:30-12)', () => {
  const r = validar({ dni: '30302003', turnoIds: ['PRN-C', 'COM-E'] }, [], TURNOS);
  assert(r.inscriptos.length === 2, JSON.stringify(r));
  assert(r.rechazados.length === 0, JSON.stringify(r));
});

test('SOC-H (14-17hs, 15/10) superpone con ECO-K (14:00-15:30, 15/10)', () => {
  const r = validar({ dni: '30302004', turnoIds: ['ECO-K', 'SOC-H'] }, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'ECO-K', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'SOC-H');
});

test('SOC-H (14-17hs, 15/10) superpone con ECO-L (15:30-17:00, 15/10)', () => {
  const r = validar({ dni: '30302005', turnoIds: ['ECO-L', 'SOC-H'] }, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'ECO-L', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'SOC-H');
});

// ================== DECLARACIÓN (checkbox nuevo, reemplaza a la de fase 1) ==================

test('validarDatosGenerales: exige la declaración de invitación (nuevo checkbox obligatorio)', () => {
  const base = { dni: '30123456', email: 'a@b.com', nombre: 'A', apellido: 'B', profesion: 'Médico/a', institucion: 'X', provincia: 'Buenos Aires', celular: '1122334455', compromiso: 'SI', turnoIds: ['PRN-A'] };
  const sinDeclaracion = validarDatosGenerales(Object.assign({}, base, { declaracion: '' }));
  assert(sinDeclaracion.ok === false, JSON.stringify(sinDeclaracion));
  assert(/invitación del Comité Organizador/.test(sinDeclaracion.error), 'error: ' + sinDeclaracion.error);

  const conDeclaracion = validarDatosGenerales(Object.assign({}, base, { declaracion: 'SI' }));
  assert(conDeclaracion.ok === true, JSON.stringify(conDeclaracion));
});

// ================== UN SOLO LINK: sin fases ni tokens ==================

test('token viejo se ignora: no queda código de gating por fase/token en Code.gs', () => {
  assert(!/resolverPrefijoToken_|validarFase1_|validarSolicitudFase_|normalizarFase_/.test(codigo), 'no debería quedar lógica de fase 1/token en el archivo');
});

// ================== CIERRE AUTOMÁTICO (Config!cierre) ==================

test('cierre: antes del 6/10 12:00 -- inscripciones siguen abiertas', () => {
  const antes = new Date('2026-10-06T11:59:00-03:00');
  assert(inscripcionesCerradas_(antes, '2026-10-06 12:00') === false);
});

test('cierre: después del 6/10 12:00 -- inscripciones cerradas', () => {
  const despues = new Date('2026-10-06T12:01:00-03:00');
  assert(inscripcionesCerradas_(despues, '2026-10-06 12:00') === true);
});

test('cierre: sin Config!cierre configurado -- nunca cierra', () => {
  const cualquiera = new Date('2030-01-01T00:00:00-03:00');
  assert(inscripcionesCerradas_(cualquiera, '') === false);
});

test('parsearFechaHoraArg_: interpreta "YYYY-MM-DD HH:MM" como hora Argentina (UTC-3)', () => {
  const d = parsearFechaHoraArg_('2026-10-06 12:00');
  assert(d.getTime() === new Date('2026-10-06T15:00:00.000Z').getTime(), '12:00 ART debe ser 15:00 UTC');
});

test('MAX_TALLERES_POR_PERSONA es 2', () => {
  assert(MAX_TALLERES_POR_PERSONA === 2);
});

// ================== MOVER (Panel admin) -- usa validar() ignorando la inscripción que se mueve ==================

test('mover: a un turno con cupo libre del mismo taller -- se acepta', () => {
  const r = validar({ dni: '30222001', turnoIds: ['PRN-B'] }, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'PRN-B', JSON.stringify(r));
  assert(r.rechazados.length === 0);
});

test('mover: a un turno sin cupo -- se rechaza por cupo', () => {
  const turnoChico = { id: 'TEST-MOVER-1', letra: 'Z', taller: 'Taller de prueba mover', aula: 'Aula X', fecha: '2026-10-14', inicio: '09:00', fin: '10:00', cupo: 1, activo: 'SI' };
  const turnosTest = TURNOS.concat([turnoChico]);
  const existentes = [{ dni: '30222002', turno_id: 'TEST-MOVER-1', taller: turnoChico.taller, fecha: turnoChico.fecha, horario: '09:00-10:00', estado: 'ACTIVA', letra: 'Z' }];
  const r = validar({ dni: '30222003', turnoIds: ['TEST-MOVER-1'] }, existentes, turnosTest);
  assert(r.inscriptos.length === 0);
  assert(r.rechazados.length === 1 && /Sin cupo disponible/.test(r.rechazados[0].motivo), JSON.stringify(r));
});

test('mover: a un turno que se superpone con otra inscripción activa de la misma persona -- se rechaza', () => {
  // La persona ya tiene COM-I (09:30-11:00, 15/10) y SOC-H (14-17hs, 15/10);
  // accionPanelMover_ excluye de "otras" la inscripción que se mueve (COM-I)
  // antes de llamar validar() -- se simula filtrando acá.
  const dni = '30222004';
  const existentesConLaPropia = [ins('COM-I', dni, 'ACTIVA'), ins('SOC-H', dni, 'ACTIVA')];
  const sinLaPropia = existentesConLaPropia.filter((i) => i.turno_id !== 'COM-I');
  const r = validar({ dni, turnoIds: ['ECO-K'] }, sinLaPropia, TURNOS); // ECO-K (14-15:30, 15/10) superpone con SOC-H
  assert(r.inscriptos.length === 0);
  assert(r.rechazados.length === 1 && /Se superpone con/.test(r.rechazados[0].motivo), JSON.stringify(r));
});

// ================== RESUMEN ==================

console.log('');
console.log(pasados + ' pasados, ' + fallados + ' fallados.');
process.exitCode = fallados > 0 ? 1 : 0;
