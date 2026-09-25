/**
 * Tests de la función pura validar() de apps-script/Code.gs.
 * Node puro, sin dependencias. Corre con: node tests/logica.test.js
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
const { validar } = sandbox.module.exports;

if (typeof validar !== 'function') {
  console.error('FAIL fatal: no se pudo extraer validar() de Code.gs (¿cambió el bloque module.exports?).');
  process.exit(1);
}

// ================== FIXTURE: mismos turnos que la precarga de Code.gs ==================

const TURNOS = [
  { id: 'PRN-1', taller: 'Perfusión regional normotérmica', aula: 'Aula A', fecha: '2026-10-14', inicio: '10:00', fin: '11:30', cupo: 60, activo: 'SI' },
  { id: 'PRN-2', taller: 'Perfusión regional normotérmica', aula: 'Aula A', fecha: '2026-10-14', inicio: '11:30', fin: '13:00', cupo: 60, activo: 'SI' },
  { id: 'PRN-3', taller: 'Perfusión regional normotérmica', aula: 'Aula A', fecha: '2026-10-14', inicio: '14:00', fin: '15:30', cupo: 60, activo: 'SI' },
  { id: 'PRN-4', taller: 'Perfusión regional normotérmica', aula: 'Aula A', fecha: '2026-10-14', inicio: '15:30', fin: '17:00', cupo: 60, activo: 'SI' },
  { id: 'ECO-1', taller: 'Ultrasonografía en donación', aula: 'Aula B', fecha: '2026-10-14', inicio: '10:00', fin: '11:30', cupo: 30, activo: 'SI' },
  { id: 'ECO-2', taller: 'Ultrasonografía en donación', aula: 'Aula B', fecha: '2026-10-14', inicio: '11:30', fin: '13:00', cupo: 30, activo: 'SI' },
  { id: 'ECO-3', taller: 'Ultrasonografía en donación', aula: 'Aula B', fecha: '2026-10-14', inicio: '14:00', fin: '15:30', cupo: 30, activo: 'SI' },
  { id: 'ECO-4', taller: 'Ultrasonografía en donación', aula: 'Aula B', fecha: '2026-10-14', inicio: '15:30', fin: '17:00', cupo: 30, activo: 'SI' },
  { id: 'COM-1', taller: 'Comunicación en donación', aula: 'Aula A', fecha: '2026-10-15', inicio: '10:00', fin: '11:00', cupo: 25, activo: 'SI' },
  { id: 'COM-2', taller: 'Comunicación en donación', aula: 'Aula A', fecha: '2026-10-15', inicio: '11:00', fin: '12:00', cupo: 25, activo: 'SI' },
  { id: 'COM-3', taller: 'Comunicación en donación', aula: 'Aula A', fecha: '2026-10-15', inicio: '14:00', fin: '15:00', cupo: 25, activo: 'SI' },
  { id: 'COM-4', taller: 'Comunicación en donación', aula: 'Aula A', fecha: '2026-10-15', inicio: '15:00', fin: '16:00', cupo: 25, activo: 'SI' },
  { id: 'SOC-1', taller: 'Acompañamiento social', aula: 'Aula B', fecha: '2026-10-15', inicio: '14:00', fin: '17:00', cupo: 50, activo: 'SI' }
];

function turnoPorId(id) {
  const t = TURNOS.find((x) => x.id === id);
  if (!t) throw new Error('Turno de fixture inexistente: ' + id);
  return t;
}

/** Construye una fila de "Inscripciones" ya existente, coherente con TURNOS. */
function ins(turnoId, dni, estado) {
  const t = turnoPorId(turnoId);
  return { dni, turno_id: turnoId, taller: t.taller, fecha: t.fecha, horario: t.inicio + '-' + t.fin, estado };
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

// ================== CASOS (de la especificación) ==================

test('duplicado exacto: ya inscripto/a en ese mismo turno', () => {
  const solicitud = { dni: '30111111', turnoIds: ['PRN-1'] };
  const existentes = [ins('PRN-1', solicitud.dni, 'ACTIVA')];
  const r = validar(solicitud, existentes, TURNOS);
  assert(r.inscriptos.length === 0, 'no debería inscribir de nuevo');
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'PRN-1');
  assert(/Ya estás inscripto\/a en este taller/.test(r.rechazados[0].motivo), 'motivo: ' + r.rechazados[0].motivo);
});

test('mismo taller, otro horario: el motivo incluye el horario anterior', () => {
  const solicitud = { dni: '30222222', turnoIds: ['PRN-2'] };
  const existentes = [ins('PRN-1', solicitud.dni, 'ACTIVA')]; // PRN-1: 10:00 a 11:30
  const r = validar(solicitud, existentes, TURNOS);
  assert(r.inscriptos.length === 0);
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'PRN-2');
  assert(/10:00 a 11:30/.test(r.rechazados[0].motivo), 'debe mencionar el horario anterior. motivo: ' + r.rechazados[0].motivo);
  assert(/primero anulá esa inscripción/.test(r.rechazados[0].motivo));
});

test('COM-3 + SOC-1 en la misma solicitud: se superponen (15/10 14-15hs dentro de 14-17hs)', () => {
  const solicitud = { dni: '30333301', turnoIds: ['COM-3', 'SOC-1'] };
  const r = validar(solicitud, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'COM-3', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'SOC-1');
  assert(/Se superpone con Comunicación en donación/.test(r.rechazados[0].motivo), 'motivo: ' + r.rechazados[0].motivo);
});

test('COM-4 + SOC-1 en la misma solicitud: se superponen (15/10 15-16hs dentro de 14-17hs)', () => {
  const solicitud = { dni: '30333402', turnoIds: ['COM-4', 'SOC-1'] };
  const r = validar(solicitud, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'COM-4', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'SOC-1');
});

test('COM-1 + SOC-1: válido, sin superposición (10-11hs no toca 14-17hs)', () => {
  const solicitud = { dni: '30444444', turnoIds: ['COM-1', 'SOC-1'] };
  const r = validar(solicitud, [], TURNOS);
  assert(r.inscriptos.length === 2, JSON.stringify(r));
  assert(r.rechazados.length === 0, JSON.stringify(r));
});

test('PRN-1 (10:00-11:30) + ECO-2 (11:30-13:00): válido, caso borde (fin=inicio no superpone)', () => {
  const solicitud = { dni: '30555555', turnoIds: ['PRN-1', 'ECO-2'] };
  const r = validar(solicitud, [], TURNOS);
  assert(r.inscriptos.length === 2, JSON.stringify(r));
  assert(r.rechazados.length === 0, JSON.stringify(r));
});

test('sin cupo: turno lleno rechaza con el motivo de cupo', () => {
  const turnoChico = { id: 'TEST-CUPO-1', taller: 'Taller de prueba', aula: 'Aula X', fecha: '2026-10-14', inicio: '09:00', fin: '10:00', cupo: 1, activo: 'SI' };
  const turnosTest = TURNOS.concat([turnoChico]);
  const existentes = [{ dni: '30999901', turno_id: 'TEST-CUPO-1', taller: 'Taller de prueba', fecha: '2026-10-14', horario: '09:00-10:00', estado: 'ACTIVA' }];
  const solicitud = { dni: '30666666', turnoIds: ['TEST-CUPO-1'] };
  const r = validar(solicitud, existentes, turnosTest);
  assert(r.inscriptos.length === 0);
  assert(r.rechazados.length === 1 && /Sin cupo disponible/.test(r.rechazados[0].motivo), JSON.stringify(r));
});

test('una ANULADA no cuenta para cupo ni para duplicado', () => {
  const turnoChico = { id: 'TEST-CUPO-2', taller: 'Taller de prueba 2', aula: 'Aula X', fecha: '2026-10-14', inicio: '09:00', fin: '10:00', cupo: 1, activo: 'SI' };
  const turnosTest = TURNOS.concat([turnoChico]);
  const dniAnulado = '30777777';
  const existentes = [{ dni: dniAnulado, turno_id: 'TEST-CUPO-2', taller: 'Taller de prueba 2', fecha: '2026-10-14', horario: '09:00-10:00', estado: 'ANULADA' }];

  // La misma persona puede volver a pedirlo: la existente está ANULADA, no cuenta como duplicado.
  const r1 = validar({ dni: dniAnulado, turnoIds: ['TEST-CUPO-2'] }, existentes, turnosTest);
  assert(r1.inscriptos.length === 1, 'debería poder re-inscribirse tras anular: ' + JSON.stringify(r1));

  // Otra persona también puede entrar: el cupo=1 no está ocupado por la ANULADA.
  const r2 = validar({ dni: '30888888', turnoIds: ['TEST-CUPO-2'] }, existentes, turnosTest);
  assert(r2.inscriptos.length === 1, 'el cupo no debería contar la anulada: ' + JSON.stringify(r2));
});

test('dos turnos del mismo taller en la misma solicitud: rechaza el segundo', () => {
  const solicitud = { dni: '30101010', turnoIds: ['PRN-1', 'PRN-2'] };
  const r = validar(solicitud, [], TURNOS);
  assert(r.inscriptos.length === 1 && r.inscriptos[0].turno_id === 'PRN-1', JSON.stringify(r));
  assert(r.rechazados.length === 1 && r.rechazados[0].turno_id === 'PRN-2');
  assert(/Ya elegiste un turno de/.test(r.rechazados[0].motivo), 'motivo: ' + r.rechazados[0].motivo);
});

// ================== RESUMEN ==================

console.log('');
console.log(pasados + ' pasados, ' + fallados + ' fallados.');
process.exitCode = fallados > 0 ? 1 : 0;
