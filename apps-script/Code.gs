/**
 * Encuentro Nacional Innovación y Nuevas Tecnologías en Donación y Trasplante
 * Backend Google Apps Script (Web App) + Google Sheets como base de datos.
 * Zona horaria: America/Argentina/Buenos_Aires en todo.
 * Versión unificada (octubre 2026): un solo link sin fases/tokens, tope de
 * 2 talleres por persona, cierre automático de inscripciones, turnos A-L.
 */

// ================== CONSTANTES ==================

var SHEET_CONFIG = 'Config';
var SHEET_TURNOS = 'Turnos';
var SHEET_INSCRIPCIONES = 'Inscripciones';
var SHEET_RESUMEN = 'Resumen';
var SHEET_POR_PERSONA = 'Por persona';
var SHEET_COLA_MAILS = 'ColaMails';
var SHEET_PRIORIDAD = 'Prioridad';
var SHEET_PANEL = 'Panel';
var HOJAS_TALLER = ['PRN', 'ECO', 'COM', 'SOC']; // prefijo de id de turno == nombre de hoja

// Hojas de datos: solo el dueño edita (protegidas en setup). El Panel es
// la única superficie de escritura para el jefe del comité.
var HOJAS_SOLO_LECTURA = [SHEET_INSCRIPCIONES, SHEET_TURNOS, SHEET_RESUMEN, SHEET_POR_PERSONA].concat(HOJAS_TALLER);
// Hojas internas: ocultas para cualquiera que no sea el dueño.
var HOJAS_OCULTAS = [SHEET_CONFIG, SHEET_COLA_MAILS, SHEET_PRIORIDAD];

// ---- Layout fijo del Panel (filas 1-indexadas; ver regenerarPanel_) ----
// PANEL_MAX_TURNOS ajustado al número real de turnos (12, fijos para este
// evento) para que los totales queden inmediatamente debajo del resumen,
// sin huecos. Si la cantidad de turnos ACTIVOS en Turnos cambia (se
// agrega o saca uno), regenerarPanel_() lo detecta sola comparando contra
// PROP_PANEL_TURNOS_COUNT y reconstruye el Panel entero antes de escribir
// datos -- no hace falta tocar este número a mano ni correr nada aparte.
var PANEL_MAX_TURNOS = 12;
var PANEL_MAX_LISTADO = 550; // listado: inscripciones activas filtradas (cupo total hoy = 510)

var PANEL_FILA_TITULO = 1;
var PANEL_FILA_ACTUALIZADO = 2;
var PANEL_FILA_RESUMEN_BANNER = 4;
var PANEL_FILA_RESUMEN_HEADERS = 5;
var PANEL_FILA_RESUMEN_DATOS = 6; // .. + PANEL_MAX_TURNOS - 1
var PANEL_FILA_TOTALES_BANNER = PANEL_FILA_RESUMEN_DATOS + PANEL_MAX_TURNOS + 1;
var PANEL_FILA_TOTALES_DATOS = PANEL_FILA_TOTALES_BANNER + 1; // 5 filas: PRN,ECO,COM,SOC,TOTAL GENERAL
var PANEL_FILA_FILTRO_BANNER = PANEL_FILA_TOTALES_DATOS + 5 + 1;
var PANEL_FILA_FILTRO_TALLER = PANEL_FILA_FILTRO_BANNER + 1;
var PANEL_FILA_FILTRO_TURNO = PANEL_FILA_FILTRO_TALLER + 1;
var PANEL_FILA_FILTRO_MAIL = PANEL_FILA_FILTRO_TURNO + 1;
var PANEL_FILA_ALTA_BANNER = PANEL_FILA_FILTRO_MAIL + 2;
var PANEL_FILA_ALTA_HEADERS = PANEL_FILA_ALTA_BANNER + 1;
var PANEL_FILA_ALTA_DATOS = PANEL_FILA_ALTA_HEADERS + 1; // 1 fila de carga
var PANEL_FILA_LISTADO_BANNER = PANEL_FILA_ALTA_DATOS + 2;
var PANEL_FILA_LISTADO_HEADERS = PANEL_FILA_LISTADO_BANNER + 1;
var PANEL_FILA_LISTADO_DATOS = PANEL_FILA_LISTADO_HEADERS + 1; // .. + PANEL_MAX_LISTADO - 1

// Columnas del bloque LISTADO (A=1).
var PANEL_COL_ACCION = 10;
var PANEL_COL_LISTADO_ID = 12; // id_inscripcion, oculta

// Columnas del bloque ALTA MANUAL (A=1): DNI,Email,Nombre,Apellido,Celular,
// Institución,Profesión,Provincia,Turno,Inscribir,Resultado.
var PANEL_COL_ALTA_PROFESION = 7;
var PANEL_COL_ALTA_PROVINCIA = 8;
var PANEL_COL_ALTA_TURNO = 9;
var PANEL_COL_ALTA_INSCRIBIR = 10;
var PANEL_COL_ALTA_RESULTADO = 11;
var PANEL_ALTA_ANCHO = 11;

// Mismas opciones que los <select> de index.html (in-profesion / in-provincia).
var PROFESIONES = ['Médico/a', 'Enfermero/a', 'Licenciado/a en Kinesiología', 'Trabajador/a social', 'Psicólogo/a', 'Bioquímico/a', 'Técnico/a', 'Otro'];
var PROVINCIAS = ['Buenos Aires', 'Ciudad Autónoma de Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];

// Anchos fijos (px) para A..K -- pensados para el LISTADO (lo más usado);
// RESUMEN/FILTRO/ALTA MANUAL se adaptan a esta misma grilla de columnas.
var PANEL_ANCHOS_COLUMNAS = [150, 120, 95, 240, 115, 170, 230, 70, 105, 190, 260];

var TZ = 'America/Argentina/Buenos_Aires';

var COLOR_AZUL = '#2B3A67';
var COLOR_DORADO = '#E3B868';

var MAX_INTENTOS_MAIL = 3;
var PREFIJO_DNI_PRUEBA = '99000';

// 'letra' va AL FINAL en los dos (columna S en Inscripciones, columna I en
// Turnos) a propósito: las fórmulas de Resumen/hojas de taller/Por persona
// referencian columnas A..R de Inscripciones y A..G de Turnos por letra
// fija -- agregar una columna en el medio las rompería.
var INSCRIPCIONES_HEADERS = ['id_inscripcion', 'timestamp', 'dni', 'email', 'nombre', 'apellido', 'profesion', 'institucion', 'provincia', 'celular', 'turno_id', 'taller', 'fecha', 'horario', 'aula', 'estado', 'fecha_anulacion', 'fase', 'letra'];
var TURNOS_HEADERS = ['id', 'taller', 'aula', 'fecha', 'inicio', 'fin', 'cupo', 'activo', 'letra'];
var CONFIG_HEADERS = ['clave', 'valor'];
var COLA_MAILS_HEADERS = ['timestamp', 'email', 'asunto', 'cuerpo_html', 'estado', 'intentos'];
var PRIORIDAD_HEADERS = ['dni', 'email', 'taller'];

// ================== SETUP (idempotente) ==================

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupConfig(ss);
  setupTurnos(ss);
  setupInscripciones(ss);
  setupResumen(ss);
  HOJAS_TALLER.forEach(function (prefijo) {
    setupHojaTaller(ss, prefijo);
  });
  setupPorPersona(ss);
  setupColaMails(ss);
  setupPrioridad(ss);
  setupPanel(ss);
  protegerHojasDeSoloLectura_(ss);
  ocultarHojasInternas_(ss);
  borrarHojaInicialVacia_(ss);
  SpreadsheetApp.flush();
  regenerarPanel_();
}

/** Borra "Hoja 1"/"Sheet1" si quedó vacía (solo estética). */
function borrarHojaInicialVacia_(ss) {
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(function (nombre) {
    var h = ss.getSheetByName(nombre);
    if (h && h.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(h);
  });
}

function getOrCreateSheet_(ss, nombre) {
  var sheet = ss.getSheetByName(nombre);
  if (!sheet) sheet = ss.insertSheet(nombre);
  return sheet;
}

function asegurarEncabezado_(sheet, headers) {
  var primera = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var yaEsta = headers.every(function (h, i) { return primera[i] === h; });
  if (!yaEsta) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground(COLOR_AZUL).setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }
}

function setupConfig(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_CONFIG);
  asegurarEncabezado_(sheet, CONFIG_HEADERS);
  var claves = ['inscripcion_abierta', 'nombre_remitente', 'reply_to', 'url_app', 'cierre'];
  var valoresPorDefecto = {
    inscripcion_abierta: 'SI',
    nombre_remitente: 'Comité Organizador – Encuentro Nacional Innovación y Nuevas Tecnologías en Donación y Trasplante',
    reply_to: '',
    url_app: '',
    cierre: ''
  };
  var existentes = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; })
    : [];
  var filaLibre = sheet.getLastRow() + 1;
  claves.forEach(function (clave) {
    if (existentes.indexOf(clave) === -1) {
      sheet.getRange(filaLibre, 1, 1, 2).setValues([[clave, valoresPorDefecto[clave]]]);
      filaLibre++;
    }
  });
  sheet.autoResizeColumns(1, 2);
}

function setupPrioridad(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_PRIORIDAD);
  asegurarEncabezado_(sheet, PRIORIDAD_HEADERS);
  sheet.autoResizeColumns(1, PRIORIDAD_HEADERS.length);
}

function setupTurnos(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_TURNOS);
  asegurarEncabezado_(sheet, TURNOS_HEADERS);
  // Formato texto plano ("@") en fecha/inicio/fin para que Sheets no las convierta a Date.
  var filasFormato = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 4, filasFormato, 3).setNumberFormat('@');

  var existentesIds = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); })
    : [];

  var precarga = construirPrecargaTurnos_();
  var filaLibre = sheet.getLastRow() + 1;
  var nuevas = precarga.filter(function (t) { return existentesIds.indexOf(t[0]) === -1; });
  if (nuevas.length > 0) {
    sheet.getRange(filaLibre, 1, nuevas.length, TURNOS_HEADERS.length).setValues(nuevas);
  }
  sheet.autoResizeColumns(1, TURNOS_HEADERS.length);
}

// Turnos definitivos (octubre 2026): A-L, sin saltos. Única fuente de
// verdad reusada por setupTurnos() (instalación nueva) y migrarOctubre()
// (reemplazo total de una planilla existente) -- ver TURNOS_DEFINITIVOS.
var TALLER_PRN = 'Donación en asistolia controlada y perfusión regional normotérmica';
var TALLER_COM = 'Comunicación en el proceso de donación';
var TALLER_ECO = 'Ultrasonografía en el proceso de donación';
var TALLER_SOC = 'Cómo acompañar a los pacientes: redes, barreras y estrategias desde lo social';

var TURNOS_DEFINITIVOS = [
  ['PRN-A', TALLER_PRN, 'Sala A', '2026-10-14', '10:00', '11:30', 60, 'SI', 'A'],
  ['PRN-B', TALLER_PRN, 'Sala A', '2026-10-14', '11:30', '13:00', 60, 'SI', 'B'],
  ['PRN-C', TALLER_PRN, 'Sala A', '2026-10-14', '14:00', '15:30', 60, 'SI', 'C'],
  ['PRN-D', TALLER_PRN, 'Sala A', '2026-10-14', '15:30', '17:00', 60, 'SI', 'D'],
  ['COM-E', TALLER_COM, 'Sala B', '2026-10-14', '10:30', '12:00', 25, 'SI', 'E'],
  ['ECO-F', TALLER_ECO, 'Sala B', '2026-10-14', '14:00', '15:30', 30, 'SI', 'F'],
  ['ECO-G', TALLER_ECO, 'Sala B', '2026-10-14', '15:30', '17:00', 30, 'SI', 'G'],
  ['SOC-H', TALLER_SOC, 'Sala B', '2026-10-15', '14:00', '17:00', 50, 'SI', 'H'],
  ['COM-I', TALLER_COM, 'Sala A', '2026-10-15', '09:30', '11:00', 25, 'SI', 'I'],
  ['COM-J', TALLER_COM, 'Sala A', '2026-10-15', '11:30', '13:00', 25, 'SI', 'J'],
  ['ECO-K', TALLER_ECO, 'Sala A', '2026-10-15', '14:00', '15:30', 30, 'SI', 'K'],
  ['ECO-L', TALLER_ECO, 'Sala A', '2026-10-15', '15:30', '17:00', 30, 'SI', 'L']
];

function construirPrecargaTurnos_() {
  return TURNOS_DEFINITIVOS.slice();
}

function setupInscripciones(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_INSCRIPCIONES);
  asegurarEncabezado_(sheet, INSCRIPCIONES_HEADERS);
  sheet.autoResizeColumns(1, INSCRIPCIONES_HEADERS.length);
}

var RESUMEN_MAX_FILAS = 200; // margen por si el organizador agrega turnos nuevos en Turnos.

function setupResumen(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_RESUMEN);
  var headers = ['id', 'taller', 'fecha', 'horario', 'aula', 'cupo', 'inscriptos', 'disponibles'];
  asegurarEncabezado_(sheet, headers);
  if (!sheet.getRange('A2').getFormula()) {
    var matriz = [];
    for (var f = 2; f <= RESUMEN_MAX_FILAS + 1; f++) {
      var tRef = SHEET_TURNOS + '!A' + f;
      matriz.push([
        '=IF(' + tRef + '="","",' + tRef + ')',
        '=IF(' + tRef + '="","",' + SHEET_TURNOS + '!B' + f + ')',
        '=IF(' + tRef + '="","",' + SHEET_TURNOS + '!D' + f + ')',
        '=IF(' + tRef + '="","",' + SHEET_TURNOS + '!E' + f + '&"-"&' + SHEET_TURNOS + '!F' + f + ')',
        '=IF(' + tRef + '="","",' + SHEET_TURNOS + '!C' + f + ')',
        '=IF(' + tRef + '="","",' + SHEET_TURNOS + '!G' + f + ')',
        '=IF(' + tRef + '="","",COUNTIFS(' + SHEET_INSCRIPCIONES + '!K:K,' + tRef + ',' + SHEET_INSCRIPCIONES + '!P:P,"ACTIVA"))',
        '=IF(' + tRef + '="","",F' + f + '-G' + f + ')'
      ]);
    }
    sheet.getRange(2, 1, matriz.length, 8).setFormulas(matriz);
  }
  sheet.autoResizeColumns(1, headers.length);
}

function setupHojaTaller(ss, prefijo) {
  var sheet = getOrCreateSheet_(ss, prefijo);
  var headers = ['turno', 'horario', 'apellido', 'nombre', 'dni', 'email', 'celular', 'profesion', 'institucion', 'provincia'];
  var primeraCelda = sheet.getRange('A1').getValue();
  if (!primeraCelda) {
    sheet.getRange('A1').setFormula(
      '="Inscriptos por turno — " & TEXTJOIN(" | ", TRUE, ARRAYFORMULA(' +
      'IF(LEFT(' + SHEET_RESUMEN + '!A2:A,' + prefijo.length + ')="' + prefijo + '",' +
      '' + SHEET_RESUMEN + '!A2:A&": "&' + SHEET_RESUMEN + '!G2:G,"")))'
    );
    sheet.getRange('A1').setFontWeight('bold');
  }
  var encabezadoDatos = sheet.getRange(2, 1, 1, headers.length).getValues()[0];
  var yaEsta = headers.every(function (h, i) { return encabezadoDatos[i] === h; });
  if (!yaEsta) {
    sheet.getRange(2, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(2, 1, 1, headers.length).setFontWeight('bold').setBackground(COLOR_AZUL).setFontColor('#FFFFFF');
    sheet.setFrozenRows(2);
  }
  var celdaFormula = sheet.getRange('A3').getFormula();
  if (!celdaFormula) {
    var formula = '=IFERROR(SORT(FILTER({' +
      SHEET_INSCRIPCIONES + '!K:K,' + SHEET_INSCRIPCIONES + '!N:N,' + SHEET_INSCRIPCIONES + '!F:F,' +
      SHEET_INSCRIPCIONES + '!E:E,' + SHEET_INSCRIPCIONES + '!C:C,' + SHEET_INSCRIPCIONES + '!D:D,' +
      SHEET_INSCRIPCIONES + '!J:J,' + SHEET_INSCRIPCIONES + '!G:G,' + SHEET_INSCRIPCIONES + '!H:H,' + SHEET_INSCRIPCIONES + '!I:I' +
      '},LEFT(' + SHEET_INSCRIPCIONES + '!K:K,' + prefijo.length + ')="' + prefijo + '",' + SHEET_INSCRIPCIONES + '!P:P="ACTIVA"),1,TRUE,3,TRUE),"")';
    sheet.getRange('A3').setFormula(formula);
  }
  sheet.autoResizeColumns(1, headers.length);
}

// 'letra' primera (no al final como en Inscripciones/Turnos): acá es la
// hoja derivada que lee la gente, y es justo la clave de orden primaria
// (letra, después apellido) -- tiene sentido que se vea primero.
function setupPorPersona(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_POR_PERSONA);
  var headers = ['letra', 'apellido', 'nombre', 'dni', 'email', 'celular', 'profesion', 'institucion', 'provincia', 'taller', 'fecha', 'horario', 'aula', 'timestamp'];
  asegurarEncabezado_(sheet, headers);
  var celdaFormula = sheet.getRange('A2').getFormula();
  if (!celdaFormula) {
    var formula = '=IFERROR(SORT(FILTER({' +
      SHEET_INSCRIPCIONES + '!S:S,' + SHEET_INSCRIPCIONES + '!F:F,' + SHEET_INSCRIPCIONES + '!E:E,' + SHEET_INSCRIPCIONES + '!C:C,' +
      SHEET_INSCRIPCIONES + '!D:D,' + SHEET_INSCRIPCIONES + '!J:J,' + SHEET_INSCRIPCIONES + '!G:G,' +
      SHEET_INSCRIPCIONES + '!H:H,' + SHEET_INSCRIPCIONES + '!I:I,' + SHEET_INSCRIPCIONES + '!L:L,' +
      SHEET_INSCRIPCIONES + '!M:M,' + SHEET_INSCRIPCIONES + '!N:N,' + SHEET_INSCRIPCIONES + '!O:O,' + SHEET_INSCRIPCIONES + '!B:B' +
      '},' + SHEET_INSCRIPCIONES + '!P:P="ACTIVA"),1,TRUE,2,TRUE),"")'; // 1=letra, 2=apellido
    sheet.getRange('A2').setFormula(formula);
  }
  sheet.autoResizeColumns(1, headers.length);
}

function setupColaMails(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_COLA_MAILS);
  asegurarEncabezado_(sheet, COLA_MAILS_HEADERS);
  sheet.autoResizeColumns(1, COLA_MAILS_HEADERS.length);
}

// ================== PANEL ADMIN (setup) ==================

function setupPanel(ss) {
  var hoja = getOrCreateSheet_(ss, SHEET_PANEL);
  ss.setActiveSheet(hoja);
  ss.moveActiveSheet(1); // primera pestaña, siempre.

  if (!hoja.getRange('A1').getValue()) {
    hoja.getRange('A1').setValue('Panel de talleres — ' + NOMBRE_EVENTO);
  }

  // RESUMEN: Taller en A:D combinada (nombres largos), Aula/Día y horario/
  // stats en E..K -- ver escribirResumen_/escribirTotales_ para el mismo mapeo.
  hoja.getRange(PANEL_FILA_RESUMEN_BANNER, 1).setValue('RESUMEN');
  hoja.getRange(PANEL_FILA_RESUMEN_HEADERS, 1, 1, 11).setValues([
    ['Taller', '', '', '', 'Aula', 'Día y horario', 'Inscriptos', 'Cupo', 'Disponibles', '% Ocup.', 'Barra']
  ]);
  combinarSiHaceFalta_(hoja.getRange(PANEL_FILA_RESUMEN_HEADERS, 1, 1, 4));
  for (var filaResumen = PANEL_FILA_RESUMEN_DATOS; filaResumen < PANEL_FILA_RESUMEN_DATOS + PANEL_MAX_TURNOS; filaResumen++) {
    combinarSiHaceFalta_(hoja.getRange(filaResumen, 1, 1, 4));
  }
  for (var filaTotal = PANEL_FILA_TOTALES_DATOS; filaTotal < PANEL_FILA_TOTALES_DATOS + 5; filaTotal++) {
    combinarSiHaceFalta_(hoja.getRange(filaTotal, 1, 1, 4));
  }

  hoja.getRange(PANEL_FILA_FILTRO_BANNER, 1).setValue('FILTRO');
  hoja.getRange(PANEL_FILA_FILTRO_TALLER, 1).setValue('Taller:');
  hoja.getRange(PANEL_FILA_FILTRO_TURNO, 1).setValue('Turno:');
  hoja.getRange(PANEL_FILA_FILTRO_MAIL, 1).setValue('Avisar por mail:');

  var celdaTaller = hoja.getRange(PANEL_FILA_FILTRO_TALLER, 2);
  celdaTaller.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Todos'].concat(HOJAS_TALLER), true).setAllowInvalid(false).build());
  if (!celdaTaller.getValue()) celdaTaller.setValue('Todos');

  var celdaMail = hoja.getRange(PANEL_FILA_FILTRO_MAIL, 2);
  if (typeof celdaMail.getValue() !== 'boolean') {
    celdaMail.insertCheckboxes();
    celdaMail.setValue(true); // default tildado, solo la primera vez.
  }

  hoja.getRange(PANEL_FILA_ALTA_BANNER, 1).setValue('ALTA MANUAL');
  hoja.getRange(PANEL_FILA_ALTA_HEADERS, 1, 1, PANEL_ALTA_ANCHO).setValues([
    ['DNI', 'Email', 'Nombre', 'Apellido', 'Celular', 'Institución', 'Profesión', 'Provincia', 'Turno', 'Inscribir', 'Resultado']
  ]);
  hoja.getRange(PANEL_FILA_ALTA_DATOS, PANEL_COL_ALTA_PROFESION).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(PROFESIONES, true).setAllowInvalid(false).build()
  );
  hoja.getRange(PANEL_FILA_ALTA_DATOS, PANEL_COL_ALTA_PROVINCIA).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(PROVINCIAS, true).setAllowInvalid(false).build()
  );
  var turnosActivos = leerTurnos_().filter(function (t) { return t.activo === 'SI'; })
    .sort(function (a, b) { return compararPorLetra_(a.letra, b.letra); });
  hoja.getRange(PANEL_FILA_ALTA_DATOS, PANEL_COL_ALTA_TURNO).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(turnosActivos.map(function (t) { return t.id; }), true).setAllowInvalid(false).build()
  );
  var celdaInscribir = hoja.getRange(PANEL_FILA_ALTA_DATOS, PANEL_COL_ALTA_INSCRIBIR);
  if (typeof celdaInscribir.getValue() !== 'boolean') {
    celdaInscribir.insertCheckboxes();
    celdaInscribir.setValue(false);
  }

  hoja.getRange(PANEL_FILA_LISTADO_BANNER, 1).setValue('LISTADO');
  hoja.getRange(PANEL_FILA_LISTADO_HEADERS, 1, 1, 12).setValues([
    ['Apellido', 'Nombre', 'DNI', 'Email', 'Celular', 'Institución', 'Taller', 'Turno', 'Horario', 'ACCIÓN', 'RESULTADO', 'id_inscripcion']
  ]);

  // Título y banners: combinados A:K para que el texto largo no defina el
  // ancho de la columna A (los anchos los fija setColumnWidth más abajo).
  combinarSiHaceFalta_(hoja.getRange(PANEL_FILA_TITULO, 1, 1, 11));
  combinarSiHaceFalta_(hoja.getRange(PANEL_FILA_ACTUALIZADO, 1, 1, 11));
  [PANEL_FILA_RESUMEN_BANNER, PANEL_FILA_FILTRO_BANNER, PANEL_FILA_ALTA_BANNER, PANEL_FILA_LISTADO_BANNER].forEach(function (fila) {
    combinarSiHaceFalta_(hoja.getRange(fila, 1, 1, 11));
  });

  // Anchos fijos (no autoResize) para las 11 columnas visibles, pensados
  // para el LISTADO -- ver PANEL_ANCHOS_COLUMNAS.
  PANEL_ANCHOS_COLUMNAS.forEach(function (ancho, i) {
    hoja.setColumnWidth(i + 1, ancho);
  });

  hoja.setFrozenRows(1); // solo el título.
  hoja.hideColumns(12); // id_inscripcion -- idempotente, no molesta si ya estaba oculta.

  formatearPanel_(hoja);
  protegerPanelParcial_(hoja);
}

/** Combina `rango` salvo que ya esté combinado exactamente igual (evita
 * errores de "ya combinada" al re-correr setup sobre un Panel existente). */
function combinarSiHaceFalta_(rango) {
  var yaCombinado = rango.getMergedRanges().some(function (m) {
    return m.getRow() === rango.getRow() && m.getColumn() === rango.getColumn() &&
      m.getNumRows() === rango.getNumRows() && m.getNumColumns() === rango.getNumColumns();
  });
  if (!yaCombinado) rango.merge();
}

/** Solo el dueño de la planilla puede editar `sheet`; el resto ve, no edita. */
function protegerSoloDueno_(sheet) {
  var protecciones = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  var protection = protecciones.length > 0 ? protecciones[0] : sheet.protect();
  protection.setDescription('Solo el organizador edita esta hoja.');
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

function protegerHojasDeSoloLectura_(ss) {
  HOJAS_SOLO_LECTURA.forEach(function (nombre) {
    var sheet = ss.getSheetByName(nombre);
    if (sheet) protegerSoloDueno_(sheet);
  });
}

/** Oculta Config/ColaMails/Prioridad y cualquier hoja "...Backup...". */
function ocultarHojasInternas_(ss) {
  ss.getSheets().forEach(function (sheet) {
    var nombre = sheet.getName();
    var esInterna = HOJAS_OCULTAS.indexOf(nombre) !== -1 || /backup/i.test(nombre);
    if (esInterna && !sheet.isSheetHidden()) sheet.hideSheet();
  });
}

/** El Panel queda protegido salvo: filtros, checkbox de mail, columna
 * ACCIÓN del listado y el bloque de alta manual (sin la celda Resultado). */
function protegerPanelParcial_(hoja) {
  var protecciones = hoja.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  var protection = protecciones.length > 0 ? protecciones[0] : hoja.protect();
  protection.setDescription('Panel: editable solo en filtros, columna ACCIÓN y alta manual.');
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  protection.setUnprotectedRanges([
    hoja.getRange(PANEL_FILA_FILTRO_TALLER, 2),
    hoja.getRange(PANEL_FILA_FILTRO_TURNO, 2),
    hoja.getRange(PANEL_FILA_FILTRO_MAIL, 2),
    hoja.getRange(PANEL_FILA_ALTA_DATOS, 1, 1, PANEL_COL_ALTA_INSCRIBIR),
    hoja.getRange(PANEL_FILA_LISTADO_DATOS, PANEL_COL_ACCION, PANEL_MAX_LISTADO, 1)
  ]);
}

/** Orden único por letra (A→L), cruza talleres -- es el orden "canónico"
 * que ve la gente (app, Panel, mails, Por persona): ya no se agrupa por
 * taller primero. */
function compararPorLetra_(letraA, letraB) {
  return String(letraA || '').localeCompare(String(letraB || ''));
}

// ================== ROUTER doGet ==================

function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = params.action;
  var resultado;
  try {
    switch (action) {
      case 'turnos':
        resultado = accionTurnos(params.t);
        break;
      case 'mis':
        resultado = accionMis(params.dni, params.email);
        break;
      case 'inscribir':
        resultado = accionInscribir(params);
        break;
      case 'anular':
        resultado = accionAnular(params.dni, params.email, params.id_inscripcion);
        break;
      default:
        resultado = { ok: false, error: 'Acción desconocida.' };
    }
  } catch (err) {
    resultado = { ok: false, error: 'Error del servidor: ' + (err && err.message ? err.message : String(err)) };
  }
  return jsonOut_(resultado);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ================== LECTURA DE HOJAS ==================

function leerConfig_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_CONFIG);
  var n = Math.max(sheet.getLastRow() - 1, 0);
  if (n === 0) return {};
  var datos = sheet.getRange(2, 1, n, 2).getValues();
  var config = {};
  datos.forEach(function (fila) {
    if (fila[0]) config[String(fila[0]).trim()] = fila[1];
  });
  return config;
}

/** Convierte lo que venga en la celda (texto "YYYY-MM-DD", "DD/MM/YYYY" o Date) a "YYYY-MM-DD". */
function normalizarFecha_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]);
  var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // formato argentino DD/MM/AAAA
  if (m2) return m2[3] + '-' + pad2_(+m2[2]) + '-' + pad2_(+m2[1]);
  return s;
}

/** Convierte lo que venga en la celda (texto "HH:MM" o Date/hora) a "HH:MM". */
function normalizarHora_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, TZ, 'HH:mm');
  }
  var s = String(v || '').trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return pad2_(+m[1]) + ':' + m[2];
  return s;
}

function pad2_(n) {
  return n < 10 ? '0' + n : '' + n;
}

function leerTurnos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TURNOS);
  var n = Math.max(sheet.getLastRow() - 1, 0);
  if (n === 0) return [];
  var filas = sheet.getRange(2, 1, n, TURNOS_HEADERS.length).getValues();
  return filas
    .filter(function (f) { return f[0]; })
    .map(function (f) {
      return {
        id: String(f[0]).trim(),
        taller: String(f[1]).trim(),
        aula: String(f[2]).trim(),
        fecha: normalizarFecha_(f[3]),
        inicio: normalizarHora_(f[4]),
        fin: normalizarHora_(f[5]),
        cupo: Number(f[6]),
        activo: String(f[7]).trim().toUpperCase(),
        letra: String(f[8] || '').trim()
      };
    });
}

function leerInscripciones_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_INSCRIPCIONES);
  var n = Math.max(sheet.getLastRow() - 1, 0);
  if (n === 0) return [];
  var filas = sheet.getRange(2, 1, n, INSCRIPCIONES_HEADERS.length).getValues();
  // IMPORTANTE: se guarda el número de fila ANTES de filtrar vacías, para que
  // anular modifique la fila correcta aunque el organizador haya vaciado alguna fila.
  return filas
    .map(function (f, i) { return { f: f, fila: i + 2 }; })
    .filter(function (x) { return x.f[0]; })
    .map(function (x) {
      var f = x.f;
      return {
        fila: x.fila,
        id_inscripcion: String(f[0]).trim(),
        timestamp: f[1],
        dni: String(f[2]).replace(/\D/g, ''),
        email: String(f[3]).trim().toLowerCase(),
        nombre: String(f[4]),
        apellido: String(f[5]),
        profesion: String(f[6]),
        institucion: String(f[7]),
        provincia: String(f[8]),
        celular: String(f[9]),
        turno_id: String(f[10]).trim(),
        taller: String(f[11]).trim(),
        fecha: normalizarFecha_(f[12]),
        horario: String(f[13]).trim(),
        aula: String(f[14]),
        estado: String(f[15]).trim().toUpperCase(),
        fecha_anulacion: f[16],
        fase: f[17],
        letra: String(f[18] || '').trim()
      };
    });
}

// ================== VALIDACIÓN PURA (testeable en Node) ==================

/** Texto "Taller X (fecha, horario)" para listar inscripciones en mensajes. */
function etiquetaTurno_(ref) {
  return ref.taller + ' (' + fechaCorta_(ref.fecha) + ' de ' + ref.inicio + ' a ' + ref.fin + ')';
}

var MAX_TALLERES_POR_PERSONA = 2;

/**
 * Por cada turno pedido, en orden:
 * 1. Ya inscripto en ESE turno.
 * 2. Tope de MAX_TALLERES_POR_PERSONA inscripciones activas (existentes +
 *    aceptadas en esta misma solicitud).
 * 3. Ya inscripto en el MISMO taller, otro turno.
 * 4. Dos turnos del mismo taller en la misma solicitud.
 * 5. Superposición horaria.
 * 6. Cupo.
 * Sin APIs de Google — testeable en Node.
 */
function validar(solicitud, inscripcionesExistentes, turnos) {
  var activas = inscripcionesExistentes.filter(function (i) { return i.estado === 'ACTIVA'; });
  var turnosPorId = {};
  turnos.forEach(function (t) { turnosPorId[t.id] = t; });

  var aceptados = [];
  var inscriptos = [];
  var rechazados = [];

  var idsSolicitados = solicitud.turnoIds || [];
  var propiasActivas = activas
    .filter(function (i) { return i.dni === solicitud.dni; })
    .map(function (i) { return resolverTurnoDeInscripcion_(i, turnosPorId); });

  idsSolicitados.forEach(function (turnoId) {
    var turno = turnosPorId[turnoId];
    if (!turno || turno.activo !== 'SI') {
      rechazados.push({ turno_id: turnoId, motivo: 'Turno inválido o no disponible.' });
      return;
    }

    // 1. Ya inscripto en ESE turno.
    var mismoTurno = buscarPrimero_(activas, function (i) {
      return i.dni === solicitud.dni && i.turno_id === turnoId;
    });
    if (mismoTurno) {
      rechazados.push({
        turno_id: turnoId,
        motivo: 'Ya estás inscripto/a en este taller (' + turno.taller + ', ' + fechaCorta_(turno.fecha) + ' de ' + turno.inicio + ' a ' + turno.fin + ').'
      });
      return;
    }

    // 2. Tope de talleres por persona (existentes + aceptados en esta solicitud).
    var actuales = propiasActivas.concat(aceptados);
    if (actuales.length >= MAX_TALLERES_POR_PERSONA) {
      var listaActuales = actuales.map(etiquetaTurno_).join(' y ');
      rechazados.push({
        turno_id: turnoId,
        motivo: 'Podés inscribirte en un máximo de ' + MAX_TALLERES_POR_PERSONA + ' talleres. Ya estás inscripto/a en: ' + listaActuales + '. Si querés cambiar, primero anulá uno.'
      });
      return;
    }

    // 3. Ya inscripto en el MISMO taller, otro turno.
    var mismoTallerExistente = buscarPrimero_(activas, function (i) {
      return i.dni === solicitud.dni && resolverTurnoDeInscripcion_(i, turnosPorId).taller === turno.taller;
    });
    if (mismoTallerExistente) {
      var refExistente = resolverTurnoDeInscripcion_(mismoTallerExistente, turnosPorId);
      rechazados.push({
        turno_id: turnoId,
        motivo: 'Ya estás inscripto/a en ' + turno.taller + ' en el turno del ' + fechaCorta_(refExistente.fecha) + ' de ' + refExistente.inicio + ' a ' + refExistente.fin + '. Si querés cambiar de horario, primero anulá esa inscripción.'
      });
      return;
    }

    // 4. Dos turnos del mismo taller en la misma solicitud.
    var mismoTallerAceptado = buscarPrimero_(aceptados, function (a) { return a.taller === turno.taller; });
    if (mismoTallerAceptado) {
      rechazados.push({
        turno_id: turnoId,
        motivo: 'Ya elegiste un turno de ' + turno.taller + ' en esta misma solicitud (' + fechaCorta_(mismoTallerAceptado.fecha) + ' de ' + mismoTallerAceptado.inicio + ' a ' + mismoTallerAceptado.fin + ').'
      });
      return;
    }

    // 5. Superposición horaria.
    var referencias = propiasActivas.concat(aceptados);
    var conflicto = buscarPrimero_(referencias, function (r) {
      return seSuperponen_(turno.fecha, turno.inicio, turno.fin, r.fecha, r.inicio, r.fin);
    });
    if (conflicto) {
      rechazados.push({
        turno_id: turnoId,
        motivo: 'Se superpone con ' + conflicto.taller + ' (' + fechaCorta_(conflicto.fecha) + ' de ' + conflicto.inicio + ' a ' + conflicto.fin + ').'
      });
      return;
    }

    // 6. Cupo.
    var ocupados = activas.filter(function (i) { return i.turno_id === turnoId; }).length;
    if (ocupados >= turno.cupo) {
      rechazados.push({ turno_id: turnoId, motivo: 'Sin cupo disponible en este turno.' });
      return;
    }

    aceptados.push({ turno_id: turnoId, taller: turno.taller, fecha: turno.fecha, inicio: turno.inicio, fin: turno.fin, aula: turno.aula, letra: turno.letra });
    inscriptos.push({
      turno_id: turnoId,
      taller: turno.taller,
      fecha: turno.fecha,
      horario: turno.inicio + '-' + turno.fin,
      aula: turno.aula,
      letra: turno.letra
    });
  });

  return { ok: true, inscriptos: inscriptos, rechazados: rechazados };
}

/** Validaciones generales (campos, DNI, email, declaración, compromiso, al
 * menos un turno). Sin fases ni tokens -- un solo link, las mismas reglas
 * para todos. */
function validarDatosGenerales(solicitud) {
  var obligatorios = ['dni', 'email', 'nombre', 'apellido', 'profesion', 'institucion', 'provincia', 'celular'];
  for (var i = 0; i < obligatorios.length; i++) {
    if (!solicitud[obligatorios[i]] || !String(solicitud[obligatorios[i]]).trim()) {
      return { ok: false, error: 'Falta completar el campo: ' + obligatorios[i] + '.' };
    }
  }
  if (!/^\d{7,8}$/.test(String(solicitud.dni).trim())) {
    return { ok: false, error: 'El DNI debe tener 7 u 8 dígitos, sin puntos.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(solicitud.email).trim())) {
    return { ok: false, error: 'El email no es válido.' };
  }
  if (solicitud.declaracion !== 'SI') {
    return { ok: false, error: 'Tenés que declarar que recibiste la invitación del Comité Organizador.' };
  }
  if (solicitud.compromiso !== 'SI') {
    return { ok: false, error: 'Tenés que aceptar el compromiso de asistencia.' };
  }
  if (!solicitud.turnoIds || solicitud.turnoIds.length === 0) {
    return { ok: false, error: 'Elegí al menos un turno.' };
  }
  return { ok: true };
}

function buscarPrimero_(arr, pred) {
  for (var i = 0; i < arr.length; i++) {
    if (pred(arr[i])) return arr[i];
  }
  return null;
}

/** Usa el turno actual si existe; si no, cae a fecha/horario guardados en la inscripción. */
function resolverTurnoDeInscripcion_(inscripcion, turnosPorId) {
  var turno = turnosPorId[inscripcion.turno_id];
  if (turno) {
    return { taller: turno.taller, fecha: turno.fecha, inicio: turno.inicio, fin: turno.fin };
  }
  var partes = String(inscripcion.horario || '').split('-');
  return {
    taller: inscripcion.taller,
    fecha: inscripcion.fecha,
    inicio: (partes[0] || '').trim(),
    fin: (partes[1] || '').trim()
  };
}

function seSuperponen_(fechaA, inicioA, finA, fechaB, inicioB, finB) {
  if (fechaA !== fechaB) return false;
  var iA = horaAMinutos_(inicioA), fA = horaAMinutos_(finA);
  var iB = horaAMinutos_(inicioB), fB = horaAMinutos_(finB);
  return iA < fB && iB < fA;
}

function horaAMinutos_(hhmm) {
  var partes = String(hhmm).split(':');
  return (+partes[0]) * 60 + (+partes[1]);
}

function fechaCorta_(iso) {
  var partes = String(iso).split('-');
  return partes[2] + '/' + partes[1];
}

// ---- Cierre automático de inscripciones (Config!cierre). Puro: recibe un
// `ahora` explícito en vez de llamar a new Date() adentro, así es
// testeable en Node sin depender del reloj real. ----

var DIAS_ES_ = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']; // índice = Date.getDay()
var MESES_ES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "YYYY-MM-DD HH:MM" (hora Argentina, UTC-3 todo el año) -> Date real.
 * '' o formato inválido -> null (sin cierre configurado). */
function parsearFechaHoraArg_(s) {
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(String(s || '').trim());
  if (!m) return null;
  return new Date(m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]) + 'T' + pad2_(+m[4]) + ':' + m[5] + ':00-03:00');
}

/** true si `ahora` ya pasó el cierre configurado. Sin cierre (''/inválido) -> nunca cierra. */
function inscripcionesCerradas_(ahora, cierreStr) {
  var cierre = parsearFechaHoraArg_(cierreStr);
  if (!cierre) return false;
  return ahora.getTime() > cierre.getTime();
}

/** "martes 6 de octubre a las 12 h" -- con Utilities.formatDate(TZ, patrón
 * NUMÉRICO) para cada componente: 'EEEE'/'MMMM' dependen del locale del
 * script y en la práctica suelen salir en inglés aunque el TZ sea
 * Argentina; los patrones numéricos ('u','d','M','H') no. Java 'u':
 * 1=lunes..7=domingo -> %7 para calzar con el índice de DIAS_ES_ (0=domingo). */
function fechaHoraLargaEs_(date) {
  var dia = DIAS_ES_[Number(Utilities.formatDate(date, TZ, 'u')) % 7];
  var diaMes = Number(Utilities.formatDate(date, TZ, 'd'));
  var mes = MESES_ES_[Number(Utilities.formatDate(date, TZ, 'M')) - 1];
  var hora = Number(Utilities.formatDate(date, TZ, 'H'));
  return dia + ' ' + diaMes + ' de ' + mes + ' a las ' + hora + ' h';
}

function mensajeCierre_(cierreStr) {
  var cierre = parsearFechaHoraArg_(cierreStr);
  if (!cierre) return 'Las inscripciones están cerradas.';
  return 'Las inscripciones cerraron el ' + fechaHoraLargaEs_(cierre) + '.';
}

function mensajeAbiertaHasta_(cierreStr) {
  var cierre = parsearFechaHoraArg_(cierreStr);
  if (!cierre) return '';
  return 'Inscripciones abiertas hasta el ' + fechaHoraLargaEs_(cierre) + '.';
}

// ================== ACCIONES ==================

/** Un solo link, toda la oferta siempre: `tokenCrudo` (parámetro `t` de un
 * link viejo) se acepta por compatibilidad pero se ignora por completo --
 * no cambia en nada lo que se devuelve. */
function accionTurnos(tokenCrudo) {
  var turnos = leerTurnos_();
  var inscripciones = leerInscripciones_();
  var activas = inscripciones.filter(function (i) { return i.estado === 'ACTIVA'; });
  var config = leerConfig_();
  var abierta = String(config.inscripcion_abierta || '').trim().toUpperCase() === 'SI';
  var cerrado = inscripcionesCerradas_(new Date(), config.cierre);

  function formatearTurno(t) {
    var ocupados = activas.filter(function (i) { return i.turno_id === t.id; }).length;
    return {
      id: t.id,
      letra: t.letra,
      taller: t.taller,
      aula: t.aula,
      fecha: t.fecha,
      inicio: t.inicio,
      fin: t.fin,
      cupo: t.cupo,
      ocupados: ocupados,
      disponibles: Math.max(t.cupo - ocupados, 0)
    };
  }

  var todos = turnos.filter(function (t) { return t.activo === 'SI'; }).map(formatearTurno);
  return {
    ok: true,
    inscripcion_abierta: abierta,
    cierre: config.cierre || '',
    cerrado: cerrado,
    mensaje_abierta_hasta: mensajeAbiertaHasta_(config.cierre),
    mensaje_cierre: mensajeCierre_(config.cierre),
    turnos: todos
  };
}

function normalizarDni_(dni) {
  return String(dni || '').replace(/\D/g, '').trim();
}
function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

/** Fuerza texto en la celda: evita que "+54 9 11..." o "=..." se interpreten como fórmula,
 *  y que Sheets convierta fechas, horarios o DNIs. */
function comoTexto_(v) {
  return "'" + String(v == null ? '' : v);
}

function accionMis(dniCrudo, emailCrudo) {
  var dni = normalizarDni_(dniCrudo);
  var email = normalizarEmail_(emailCrudo);
  if (!dni || !email) return { ok: false, error: 'Faltan DNI y/o email.' };

  var inscripciones = leerInscripciones_();
  var mias = inscripciones.filter(function (i) { return i.dni === dni && i.email === email && i.estado === 'ACTIVA'; });

  if (mias.length === 0) {
    var otroEmail = buscarPrimero_(inscripciones, function (i) { return i.dni === dni && i.email !== email; });
    if (otroEmail) {
      return { ok: false, error: 'Este DNI ya está registrado con otro email (' + ofuscarEmail_(otroEmail.email) + '). Usá ese email o escribí a los organizadores.' };
    }
  }

  return { ok: true, mis: mias.map(formatearInscripcionSalida_) };
}

function formatearInscripcionSalida_(i) {
  return {
    id_inscripcion: i.id_inscripcion,
    turno_id: i.turno_id,
    taller: i.taller,
    fecha: i.fecha,
    horario: i.horario,
    aula: i.aula,
    letra: i.letra
  };
}

function ofuscarEmail_(email) {
  var partes = String(email).split('@');
  if (partes.length !== 2) return email;
  var usuario = partes[0];
  var oculto = usuario.length > 1 ? usuario[0] + '***' : '***';
  return oculto + '@' + partes[1];
}

function generarIdInscripcion_(k) {
  return 'INS-' + new Date().getTime() + '-' + k + '-' + Math.floor(Math.random() * 100000);
}

function accionInscribir(params) {
  var solicitud = {
    dni: normalizarDni_(params.dni),
    email: normalizarEmail_(params.email),
    nombre: String(params.nombre || '').trim(),
    apellido: String(params.apellido || '').trim(),
    profesion: String(params.profesion || '').trim(),
    institucion: String(params.institucion || '').trim(),
    provincia: String(params.provincia || '').trim(),
    celular: String(params.celular || '').trim(),
    compromiso: String(params.compromiso || '').trim().toUpperCase(),
    declaracion: String(params.declaracion || '').trim().toUpperCase(),
    turnoIds: String(params.turnos || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
  };

  var generales = validarDatosGenerales(solicitud);
  if (!generales.ok) return generales;

  // Config y Turnos fuera del lock: son datos de referencia que edita el
  // organizador a mano de vez en cuando -- no lo que se disputa bajo
  // concurrencia (eso es Inscripciones, adentro). Leerlos antes de pedir
  // el lock achica el tiempo que cada request lo mantiene tomado.
  var config = leerConfig_();
  if (String(config.inscripcion_abierta || '').trim().toUpperCase() !== 'SI') {
    return { ok: false, error: 'Las inscripciones están cerradas.' };
  }
  if (inscripcionesCerradas_(new Date(), config.cierre)) {
    return { ok: false, error: mensajeCierre_(config.cierre) };
  }
  var turnos = leerTurnos_();

  var lock = LockService.getScriptLock();
  var pudoTomarLock = lock.tryLock(30000);
  if (!pudoTomarLock) {
    return { ok: false, error: 'El sistema está muy ocupado. Probá de nuevo en unos segundos.' };
  }

  var resultado;
  var inscripcionesParaMail = null;
  try {
    var inscripciones = leerInscripciones_();
    var otroEmail = buscarPrimero_(inscripciones, function (i) { return i.dni === solicitud.dni && i.email !== solicitud.email; });
    if (otroEmail) {
      return { ok: false, error: 'Este DNI ya está registrado con otro email (' + ofuscarEmail_(otroEmail.email) + '). Usá ese email o escribí a los organizadores.' };
    }

    var evaluacion = validar(solicitud, inscripciones, turnos);

    var nuevasFormateadas = [];
    if (evaluacion.inscriptos.length > 0) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SHEET_INSCRIPCIONES);
      var ahora = new Date();
      var filasNuevas = evaluacion.inscriptos.map(function (ins, k) {
        var id = generarIdInscripcion_(k);
        nuevasFormateadas.push({ id_inscripcion: id, turno_id: ins.turno_id, taller: ins.taller, fecha: ins.fecha, horario: ins.horario, aula: ins.aula, letra: ins.letra });
        return [
          id, ahora,
          comoTexto_(solicitud.dni), comoTexto_(solicitud.email), comoTexto_(solicitud.nombre), comoTexto_(solicitud.apellido),
          comoTexto_(solicitud.profesion), comoTexto_(solicitud.institucion), comoTexto_(solicitud.provincia), comoTexto_(solicitud.celular),
          comoTexto_(ins.turno_id), comoTexto_(ins.taller), comoTexto_(ins.fecha), comoTexto_(ins.horario), comoTexto_(ins.aula),
          'ACTIVA', '', '', comoTexto_(ins.letra)
        ];
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, filasNuevas.length, INSCRIPCIONES_HEADERS.length).setValues(filasNuevas);
      SpreadsheetApp.flush();
    }

    // misActivas en memoria: lo que esta persona ya tenía activo (de la
    // lectura de arriba, ANTES de escribir) + lo recién insertado. No se
    // vuelve a leer Inscripciones -- ya sabemos exactamente qué quedó
    // escrito, y seguimos con el lock tomado (nadie más pudo escribir
    // en el medio).
    var activasPrevias = inscripciones.filter(function (i) { return i.dni === solicitud.dni && i.email === solicitud.email && i.estado === 'ACTIVA'; });
    var misActivas = activasPrevias.map(formatearInscripcionSalida_).concat(nuevasFormateadas);

    resultado = {
      ok: true,
      inscriptos: evaluacion.inscriptos,
      rechazados: evaluacion.rechazados,
      mis: misActivas
    };

    if (evaluacion.inscriptos.length > 0) {
      inscripcionesParaMail = { solicitud: solicitud, mis: misActivas, config: config };
    }
  } finally {
    lock.releaseLock();
  }

  // Mail DESPUÉS de liberar el lock. Un fallo de mail nunca hace fallar la inscripción.
  if (inscripcionesParaMail) {
    try {
      if (!esDniDePrueba_(inscripcionesParaMail.solicitud.dni)) {
        enviarMailInscripcion_(inscripcionesParaMail.solicitud, inscripcionesParaMail.mis, inscripcionesParaMail.config);
      }
    } catch (e) {
      // no propagar
    }
  }

  return resultado;
}

/**
 * Núcleo de "dar de baja": toma y libera el lock, valida y marca ANULADA.
 * NO envía mail -- eso lo decide el llamador (el self-service SIEMPRE
 * avisa; el Panel admin respeta el checkbox "Avisar por mail"). Devuelve
 * `datosParaMail` en éxito para que el llamador decida.
 */
function accionAnularCore_(dniCrudo, emailCrudo, idInscripcion, config) {
  var dni = normalizarDni_(dniCrudo);
  var email = normalizarEmail_(emailCrudo);
  idInscripcion = String(idInscripcion || '').trim();
  if (!dni || !email || !idInscripcion) {
    return { ok: false, error: 'Faltan datos para anular (DNI, email o inscripción).' };
  }

  var lock = LockService.getScriptLock();
  var pudoTomarLock = lock.tryLock(30000);
  if (!pudoTomarLock) {
    return { ok: false, error: 'El sistema está muy ocupado. Probá de nuevo en unos segundos.' };
  }

  var resultado;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_INSCRIPCIONES);
    var inscripciones = leerInscripciones_();
    var propia = buscarPrimero_(inscripciones, function (i) {
      return i.id_inscripcion === idInscripcion && i.dni === dni && i.email === email && i.estado === 'ACTIVA';
    });
    if (!propia) {
      resultado = { ok: false, error: 'No se encontró esa inscripción activa a tu nombre.' };
    } else {
      // Doble control: confirmar que la fila sigue siendo esa inscripción antes de escribir.
      var idEnFila = String(sheet.getRange(propia.fila, 1).getValue()).trim();
      if (idEnFila !== idInscripcion) {
        resultado = { ok: false, error: 'No se pudo anular en este momento. Probá de nuevo.' };
      } else {
        var ahora = new Date();
        sheet.getRange(propia.fila, 16, 1, 2).setValues([['ANULADA', ahora]]); // P = estado, Q = fecha_anulacion
        SpreadsheetApp.flush();

        // restantes en memoria: lo que ya sabíamos activo de esta persona
        // (de la lectura de arriba), menos la que acabamos de anular. Sin
        // releer Inscripciones -- seguimos con el lock tomado.
        var restantes = inscripciones
          .filter(function (i) { return i.dni === dni && i.email === email && i.estado === 'ACTIVA' && i.id_inscripcion !== idInscripcion; })
          .map(formatearInscripcionSalida_);
        resultado = { ok: true, anulado: formatearInscripcionSalida_(propia), mis: restantes };
        resultado.datosParaMail = { dni: dni, email: email, nombre: propia.nombre, anulado: propia, mis: restantes, config: config };
      }
    }
  } finally {
    lock.releaseLock();
  }
  return resultado;
}

function accionAnular(dniCrudo, emailCrudo, idInscripcion) {
  var config = leerConfig_(); // fuera del lock: solo hace falta para el mail.
  var resultado = accionAnularCore_(dniCrudo, emailCrudo, idInscripcion, config);

  if (resultado.datosParaMail) {
    try {
      if (!esDniDePrueba_(resultado.datosParaMail.dni)) {
        enviarMailAnulacion_(resultado.datosParaMail);
      }
    } catch (e) {
      // no propagar
    }
  }

  return { ok: resultado.ok, error: resultado.error, anulado: resultado.anulado, mis: resultado.mis };
}

function esDniDePrueba_(dni) {
  return String(dni).indexOf(PREFIJO_DNI_PRUEBA) === 0;
}

// ================== MAILS ==================

var NOMBRE_EVENTO = 'Encuentro Nacional Innovación y Nuevas Tecnologías en Donación y Trasplante';
var NOMBRE_EVENTO_FECHA_LUGAR = NOMBRE_EVENTO + ' — 14 y 15 de octubre 2026 · Centro Cultural de la Ciencia';
var FOOTER_MAIL_ = '<p style="color:#777;font-size:13px;">Comité Organizador – ' + NOMBRE_EVENTO + '</p>';

function tablaHtmlTurnos_(lista) {
  var filas = lista.slice().sort(function (a, b) { return compararPorLetra_(a.letra, b.letra); }).map(function (t) {
    var etiquetaTaller = t.letra ? 'Taller ' + t.letra + ' · ' + escapeHtml_(t.taller) : escapeHtml_(t.taller);
    return '<tr>' +
      '<td style="padding:8px;border-bottom:1px solid #eee;">' + etiquetaTaller + '</td>' +
      '<td style="padding:8px;border-bottom:1px solid #eee;">' + fechaLarga_(t.fecha) + '</td>' +
      '<td style="padding:8px;border-bottom:1px solid #eee;">' + escapeHtml_(t.horario) + '</td>' +
      '<td style="padding:8px;border-bottom:1px solid #eee;">' + escapeHtml_(t.aula) + '</td>' +
      '</tr>';
  }).join('');
  return '<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">' +
    '<thead><tr style="background:' + COLOR_AZUL + ';color:#fff;">' +
    '<th style="padding:8px;text-align:left;">Taller</th><th style="padding:8px;text-align:left;">Fecha</th>' +
    '<th style="padding:8px;text-align:left;">Horario</th><th style="padding:8px;text-align:left;">Aula</th>' +
    '</tr></thead><tbody>' + filas + '</tbody></table>';
}

function fechaLarga_(iso) {
  var partes = String(iso).split('-');
  return partes[2] + '/' + partes[1] + '/' + partes[0];
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function armarMailInscripcion_(nombre, mis, urlApp) {
  var asunto = 'Tu inscripción está confirmada – ' + NOMBRE_EVENTO;
  var lineaAnular = urlApp
    ? '<p>Si no podés concurrir, anulá tu inscripción desde <a href="' + escapeHtml_(urlApp) + '" style="color:' + COLOR_AZUL + ';">' + escapeHtml_(urlApp) + '</a> para liberar la vacante para otra persona.</p>'
    : '<p>Si no podés concurrir, anulá tu inscripción desde la misma página donde te inscribiste, para liberar la vacante para otra persona.</p>';
  var cuerpo =
    '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">' +
    '<h2 style="color:' + COLOR_AZUL + ';">Hola ' + escapeHtml_(nombre) + ':</h2>' +
    '<p>¡Estamos muy felices de contar con vos! Tu inscripción quedó confirmada en los siguientes talleres:</p>' +
    tablaHtmlTurnos_(mis) +
    '<p>Te pedimos un compromiso: los cupos son muy limitados y cada lugar que queda vacío es un lugar que otra persona no pudo ocupar. Al inscribirte, te comprometés a asistir en el turno asignado.</p>' +
    lineaAnular +
    '<p style="color:' + COLOR_DORADO + ';font-weight:bold;">' + NOMBRE_EVENTO_FECHA_LUGAR + '</p>' +
    FOOTER_MAIL_ +
    '</div>';
  return { asunto: asunto, cuerpo: cuerpo };
}

function armarMailAnulacion_(nombre, anulado, mis) {
  var asunto = 'Confirmamos la anulación de tu inscripción – ' + NOMBRE_EVENTO;
  var etiquetaAnulado = anulado.letra ? 'Taller ' + anulado.letra + ' · ' + escapeHtml_(anulado.taller) : escapeHtml_(anulado.taller);
  var restoHtml = mis.length > 0
    ? '<p>Seguís con estas inscripciones activas:</p>' + tablaHtmlTurnos_(mis)
    : '<p>No tenés inscripciones activas.</p>';
  var cuerpo =
    '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">' +
    '<h2 style="color:' + COLOR_AZUL + ';">Hola ' + escapeHtml_(nombre) + ':</h2>' +
    '<p>Confirmamos que anulamos tu inscripción a <strong>' + etiquetaAnulado + '</strong> (' + fechaLarga_(anulado.fecha) + ', ' + escapeHtml_(anulado.horario) + ').</p>' +
    restoHtml +
    FOOTER_MAIL_ +
    '</div>';
  return { asunto: asunto, cuerpo: cuerpo };
}

/** Solo para "Mover" desde el Panel admin -- distinto del mail de
 * inscripción nueva para no confundir ("parece una inscripción nueva"). */
function armarMailMovimiento_(nombre, cambio, mis, urlApp) {
  var asunto = 'Tu turno fue modificado – ' + NOMBRE_EVENTO;
  var etiquetaTallerCambio = cambio.letraAhora ? 'Taller ' + cambio.letraAhora + ' · ' + escapeHtml_(cambio.taller) : escapeHtml_(cambio.taller);
  var lineaAnular = urlApp
    ? '<p>Si no podés asistir en este nuevo horario, anulá tu inscripción desde <a href="' + escapeHtml_(urlApp) + '" style="color:' + COLOR_AZUL + ';">' + escapeHtml_(urlApp) + '</a> para liberar el cupo.</p>'
    : '<p>Si no podés asistir en este nuevo horario, anulá tu inscripción desde la misma página donde te inscribiste, para liberar el cupo.</p>';
  var cuerpo =
    '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">' +
    '<h2 style="color:' + COLOR_AZUL + ';">Hola ' + escapeHtml_(nombre) + ':</h2>' +
    '<p>Te informamos que el Comité Organizador modificó tu turno en el taller <strong>' + etiquetaTallerCambio + '</strong>:</p>' +
    '<p><strong>Antes:</strong> ' + fechaLarga_(cambio.fechaAntes) + ' de ' + escapeHtml_(cambio.horarioAntes) + ' (' + escapeHtml_(cambio.aulaAntes) + ')</p>' +
    '<p><strong>Ahora:</strong> ' + fechaLarga_(cambio.fechaAhora) + ' de ' + escapeHtml_(cambio.horarioAhora) + ' (' + escapeHtml_(cambio.aulaAhora) + ')</p>' +
    '<p>Estas son todas tus inscripciones activas actualizadas:</p>' +
    tablaHtmlTurnos_(mis) +
    '<p>Te recordamos que los cupos son limitados.</p>' +
    lineaAnular +
    '<p style="color:' + COLOR_DORADO + ';font-weight:bold;">' + NOMBRE_EVENTO_FECHA_LUGAR + '</p>' +
    FOOTER_MAIL_ +
    '</div>';
  return { asunto: asunto, cuerpo: cuerpo };
}

function opcionesMail_(cuerpoHtml, config) {
  var opciones = { htmlBody: cuerpoHtml };
  if (config && config.nombre_remitente) opciones.name = String(config.nombre_remitente);
  if (config && config.reply_to) opciones.replyTo = String(config.reply_to);
  return opciones;
}

function textoPlano_(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function enviarOEncolar_(email, asunto, cuerpoHtml, config) {
  if (MailApp.getRemainingDailyQuota() >= 5) {
    try {
      MailApp.sendEmail(email, asunto, textoPlano_(cuerpoHtml), opcionesMail_(cuerpoHtml, config));
      registrarEnvioDirecto_(email, asunto, cuerpoHtml);
      return;
    } catch (e) {
      // sigue abajo y encola como PENDIENTE
    }
  }
  encolarMail_(email, asunto, cuerpoHtml);
}

/** ColaMails como registro COMPLETO de envíos, no solo de pendientes/fallidos:
 * un envío directo exitoso también deja fila (ENVIADO, intentos 1). */
function registrarEnvioDirecto_(email, asunto, cuerpoHtml) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_COLA_MAILS);
  sheet.appendRow([new Date(), email, asunto, cuerpoHtml, 'ENVIADO', 1]);
}

function encolarMail_(email, asunto, cuerpoHtml) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_COLA_MAILS);
  sheet.appendRow([new Date(), email, asunto, cuerpoHtml, 'PENDIENTE', 0]);
}

function enviarMailInscripcion_(solicitud, mis, config) {
  var urlApp = String(config.url_app || '').trim();
  var mail = armarMailInscripcion_(solicitud.nombre, mis, urlApp);
  enviarOEncolar_(solicitud.email, mail.asunto, mail.cuerpo, config);
}

function enviarMailAnulacion_(datos) {
  var mail = armarMailAnulacion_(datos.nombre, datos.anulado, datos.mis);
  enviarOEncolar_(datos.email, mail.asunto, mail.cuerpo, datos.config);
}

function enviarMailMovimiento_(datos) {
  var urlApp = String(datos.config.url_app || '').trim();
  var mail = armarMailMovimiento_(datos.nombre, datos.cambio, datos.mis, urlApp);
  enviarOEncolar_(datos.email, mail.asunto, mail.cuerpo, datos.config);
}

/** Envía los mails PENDIENTES de ColaMails mientras haya cuota (máx. 3 intentos c/u). */
function procesarCola() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_COLA_MAILS);
  var n = Math.max(sheet.getLastRow() - 1, 0);
  if (n === 0) return;
  var filas = sheet.getRange(2, 1, n, COLA_MAILS_HEADERS.length).getValues();
  var config = leerConfig_();

  for (var i = 0; i < filas.length; i++) {
    if (MailApp.getRemainingDailyQuota() < 5) break;
    var fila = filas[i];
    var estado = String(fila[4]).trim().toUpperCase();
    var intentos = Number(fila[5]) || 0;
    if (estado !== 'PENDIENTE' || intentos >= MAX_INTENTOS_MAIL) continue;

    var numeroFila = i + 2;
    try {
      MailApp.sendEmail(fila[1], fila[2], textoPlano_(fila[3]), opcionesMail_(String(fila[3]), config));
      sheet.getRange(numeroFila, 5).setValue('ENVIADO');
    } catch (e) {
      sheet.getRange(numeroFila, 6).setValue(intentos + 1);
      if (intentos + 1 >= MAX_INTENTOS_MAIL) sheet.getRange(numeroFila, 5).setValue('ERROR');
    }
  }
}

/** Crea el trigger horario de procesarCola y el onEdit instalable del Panel,
 * si todavía no existen (no los duplica). */
function instalarTrigger() {
  var disparadores = ScriptApp.getProjectTriggers();

  var existeCola = disparadores.some(function (t) { return t.getHandlerFunction() === 'procesarCola'; });
  if (!existeCola) {
    ScriptApp.newTrigger('procesarCola').timeBased().everyHours(1).create();
  }

  var existeEdit = disparadores.some(function (t) { return t.getHandlerFunction() === 'onEditInstalablePanel_'; });
  if (!existeEdit) {
    ScriptApp.newTrigger('onEditInstalablePanel_').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  }

  var existeRefresco = disparadores.some(function (t) { return t.getHandlerFunction() === 'regenerarPanelAutomatico_'; });
  if (!existeRefresco) {
    ScriptApp.newTrigger('regenerarPanelAutomatico_').timeBased().everyMinutes(5).create();
  }
}

/** Disparador temporal (cada 5 min, ver instalarTrigger): refresca el
 * Panel solo. Función propia (no apuntar el trigger directo a
 * regenerarPanel_) para no pasarle el objeto evento del trigger como si
 * fuera el parámetro `pendiente`. */
function regenerarPanelAutomatico_() {
  regenerarPanel_();
}

// ================== PANEL ADMIN ==================
//
// Superficie de escritura para el jefe del comité: dar de baja, mover de
// turno y dar altas manuales, todo reusando validar()/lock/mails ya
// existentes. El listado se reescribe siempre como VALORES (nunca fórmula
// FILTER) para que la columna ACCIÓN no quede desalineada -- ver
// regenerarPanel_.

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🛠 Talleres')
    .addItem('Actualizar panel', 'regenerarPanelDesdeMenu_')
    .addItem('Reparar panel', 'repararPanelDesdeMenu_')
    .addToUi();
  regenerarPanel_();
}

function regenerarPanelDesdeMenu_() {
  regenerarPanel_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Panel actualizado.', '🛠 Talleres', 4);
}

/** Único punto de entrada del onEdit instalable: solo procesa ediciones
 * dentro de la hoja Panel, y solo en las celdas interactivas conocidas.
 * Cualquier otra edición (en Panel o en otra hoja) se ignora. */
function onEditInstalablePanel_(e) {
  if (!e || !e.range) return;
  var hoja = e.range.getSheet();
  if (hoja.getName() !== SHEET_PANEL) return;
  if (e.range.getNumRows() > 1 || e.range.getNumColumns() > 1) return; // pegado múltiple: ignorar.

  var fila = e.range.getRow();
  var columna = e.range.getColumn();

  if ((fila === PANEL_FILA_FILTRO_TALLER || fila === PANEL_FILA_FILTRO_TURNO) && columna === 2) {
    regenerarPanel_();
    return;
  }

  if (columna === PANEL_COL_ACCION && fila >= PANEL_FILA_LISTADO_DATOS && fila < PANEL_FILA_LISTADO_DATOS + PANEL_MAX_LISTADO) {
    var accionTexto = String(e.range.getValue() || '').trim();
    if (!accionTexto) return; // reseteo propio del script tras procesar -- no reprocesar (corta el rebote).
    procesarAccionListado_(fila, accionTexto, leerConfig_(), leerTurnos_());
    return;
  }

  if (fila === PANEL_FILA_ALTA_DATOS && columna === PANEL_COL_ALTA_INSCRIBIR) {
    var tildado = e.range.getValue() === true;
    if (!tildado) return; // destilde propio del script -- no reprocesar.
    procesarAltaManual_(leerConfig_(), leerTurnos_());
    return;
  }
}

/** Dar de baja (reusa accionAnularCore_) o mover (validar() + anular+crear
 * en un solo lock) según el texto elegido en la columna ACCIÓN. Escribe el
 * RESULTADO y regenera el panel. */
function procesarAccionListado_(numeroFila, accionTexto, config, turnos) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PANEL);
  var idInscripcion = String(hoja.getRange(numeroFila, PANEL_COL_LISTADO_ID).getValue()).trim();
  hoja.getRange(numeroFila, PANEL_COL_ACCION).setValue(''); // resetear ya, antes de cualquier otra cosa.
  if (!idInscripcion) return;

  var avisarMail = hoja.getRange(PANEL_FILA_FILTRO_MAIL, 2).getValue() === true;
  var pendiente = null;

  if (accionTexto === 'Dar de baja') {
    var baja = accionPanelBaja_(idInscripcion, config);
    if (baja.ok) {
      if (avisarMail && baja.datosParaMail && !esDniDePrueba_(baja.datosParaMail.dni)) {
        try { enviarMailAnulacion_(baja.datosParaMail); } catch (e) { /* no propagar */ }
      }
    } else {
      pendiente = { idInscripcion: idInscripcion, mensaje: '❌ ' + baja.error };
    }
  } else {
    var m = /^Mover a (\S+)/.exec(accionTexto);
    if (!m) return; // valor no reconocido -- no-op.
    var salida = accionPanelMover_(idInscripcion, m[1], config, turnos);
    if (salida.resultado.ok) {
      pendiente = { idInscripcion: salida.resultado.nuevoIdInscripcion, mensaje: salida.resultado.mensaje };
      if (avisarMail && salida.datosParaMail && !esDniDePrueba_(salida.datosParaMail.dni)) {
        try { enviarMailMovimiento_(salida.datosParaMail); } catch (e) { /* no propagar */ }
      }
    } else {
      pendiente = { idInscripcion: idInscripcion, mensaje: '❌ ' + salida.resultado.error };
    }
  }

  regenerarPanel_(pendiente);
}

/** Dar de baja desde el Panel: resuelve dni/email de la fila y reusa
 * accionAnularCore_ (mismo lock, misma escritura de ANULADA). */
function accionPanelBaja_(idInscripcion, config) {
  var inscripciones = leerInscripciones_();
  var propia = buscarPrimero_(inscripciones, function (i) { return i.id_inscripcion === idInscripcion && i.estado === 'ACTIVA'; });
  if (!propia) return { ok: false, error: 'No se encontró esa inscripción activa.' };
  return accionAnularCore_(propia.dni, propia.email, idInscripcion, config);
}

/** Mover de turno: dentro de UN solo lock, valida el destino con validar()
 * (ignorando la inscripción que se mueve), anula la original y crea la
 * nueva. Si `validar()` rechaza, no se toca nada. */
function accionPanelMover_(idInscripcion, turnoDestinoId, config, turnos) {
  var lock = LockService.getScriptLock();
  var pudoTomarLock = lock.tryLock(30000);
  if (!pudoTomarLock) {
    return { resultado: { ok: false, error: 'El sistema está muy ocupado. Probá de nuevo en unos segundos.' }, datosParaMail: null };
  }

  var resultado;
  var datosParaMail = null;
  try {
    var inscripciones = leerInscripciones_();
    var original = buscarPrimero_(inscripciones, function (i) { return i.id_inscripcion === idInscripcion && i.estado === 'ACTIVA'; });
    if (!original) {
      resultado = { ok: false, error: 'No se encontró esa inscripción activa.' };
    } else {
      var destino = buscarPrimero_(turnos, function (t) { return t.id === turnoDestinoId; });
      if (!destino || destino.taller !== original.taller) {
        resultado = { ok: false, error: 'El turno destino no es válido.' };
      } else {
        var otras = inscripciones.filter(function (i) { return i.id_inscripcion !== idInscripcion; });
        var evaluacion = validar({ dni: original.dni, turnoIds: [turnoDestinoId] }, otras, turnos);
        if (evaluacion.inscriptos.length === 0) {
          resultado = { ok: false, error: (evaluacion.rechazados[0] || {}).motivo || 'No se pudo mover.' };
        } else {
          var ss = SpreadsheetApp.getActiveSpreadsheet();
          var sheet = ss.getSheetByName(SHEET_INSCRIPCIONES);
          var ahora = new Date();
          sheet.getRange(original.fila, 16, 1, 2).setValues([['ANULADA', ahora]]);

          var ins = evaluacion.inscriptos[0];
          var nuevoId = generarIdInscripcion_(0);
          sheet.getRange(sheet.getLastRow() + 1, 1, 1, INSCRIPCIONES_HEADERS.length).setValues([[
            nuevoId, ahora,
            comoTexto_(original.dni), comoTexto_(original.email), comoTexto_(original.nombre), comoTexto_(original.apellido),
            comoTexto_(original.profesion), comoTexto_(original.institucion), comoTexto_(original.provincia), comoTexto_(original.celular),
            comoTexto_(ins.turno_id), comoTexto_(ins.taller), comoTexto_(ins.fecha), comoTexto_(ins.horario), comoTexto_(ins.aula),
            'ACTIVA', '', '', comoTexto_(ins.letra)
          ]]);
          SpreadsheetApp.flush();

          var misActivas = inscripciones
            .filter(function (i) { return i.dni === original.dni && i.email === original.email && i.estado === 'ACTIVA' && i.id_inscripcion !== idInscripcion; })
            .map(formatearInscripcionSalida_)
            .concat([{ id_inscripcion: nuevoId, turno_id: ins.turno_id, taller: ins.taller, fecha: ins.fecha, horario: ins.horario, aula: ins.aula, letra: ins.letra }]);

          resultado = { ok: true, nuevoIdInscripcion: nuevoId, mensaje: '✅ Movido a ' + ins.turno_id + '.' };
          datosParaMail = {
            dni: original.dni,
            email: original.email,
            nombre: original.nombre,
            cambio: {
              taller: original.taller,
              fechaAntes: original.fecha, horarioAntes: original.horario, aulaAntes: original.aula, letraAntes: original.letra,
              fechaAhora: ins.fecha, horarioAhora: ins.horario, aulaAhora: ins.aula, letraAhora: ins.letra
            },
            mis: misActivas,
            config: config
          };
        }
      }
    }
  } finally {
    lock.releaseLock();
  }

  return { resultado: resultado, datosParaMail: datosParaMail };
}

/** Alta manual: mismas validaciones que accionInscribir (DNI con otro
 * email, duplicado, mismo taller, superposición, cupo vía validar()), sin
 * token ni declaración -- es el admin. Profesión y provincia son
 * obligatorias, igual que en la app, con las mismas opciones (PROFESIONES/
 * PROVINCIAS, iguales a los <select> de index.html). */
function accionPanelAlta_(datos, config, turnos) {
  var solicitud = {
    dni: normalizarDni_(datos.dni),
    email: normalizarEmail_(datos.email),
    nombre: String(datos.nombre || '').trim(),
    apellido: String(datos.apellido || '').trim(),
    profesion: String(datos.profesion || '').trim(),
    institucion: String(datos.institucion || '').trim(),
    provincia: String(datos.provincia || '').trim(),
    celular: String(datos.celular || '').trim(),
    turnoIds: [String(datos.turnoId || '').trim()].filter(Boolean)
  };

  if (!/^\d{7,8}$/.test(solicitud.dni)) return { resultado: { ok: false, error: 'El DNI debe tener 7 u 8 dígitos, sin puntos.' }, datosParaMail: null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(solicitud.email)) return { resultado: { ok: false, error: 'El email no es válido.' }, datosParaMail: null };
  if (!solicitud.nombre) return { resultado: { ok: false, error: 'Falta el nombre.' }, datosParaMail: null };
  if (!solicitud.apellido) return { resultado: { ok: false, error: 'Falta el apellido.' }, datosParaMail: null };
  if (!solicitud.celular) return { resultado: { ok: false, error: 'Falta el celular.' }, datosParaMail: null };
  if (!solicitud.institucion) return { resultado: { ok: false, error: 'Falta la institución.' }, datosParaMail: null };
  if (PROFESIONES.indexOf(solicitud.profesion) === -1) return { resultado: { ok: false, error: 'Elegí una profesión de la lista.' }, datosParaMail: null };
  if (PROVINCIAS.indexOf(solicitud.provincia) === -1) return { resultado: { ok: false, error: 'Elegí una provincia de la lista.' }, datosParaMail: null };
  if (solicitud.turnoIds.length === 0) return { resultado: { ok: false, error: 'Elegí un turno.' }, datosParaMail: null };

  var lock = LockService.getScriptLock();
  var pudoTomarLock = lock.tryLock(30000);
  if (!pudoTomarLock) {
    return { resultado: { ok: false, error: 'El sistema está muy ocupado. Probá de nuevo en unos segundos.' }, datosParaMail: null };
  }

  var resultado;
  var datosParaMail = null;
  try {
    var inscripciones = leerInscripciones_();
    var otroEmail = buscarPrimero_(inscripciones, function (i) { return i.dni === solicitud.dni && i.email !== solicitud.email; });
    if (otroEmail) {
      resultado = { ok: false, error: 'Este DNI ya está registrado con otro email (' + ofuscarEmail_(otroEmail.email) + ').' };
    } else {
      var evaluacion = validar(solicitud, inscripciones, turnos);
      if (evaluacion.inscriptos.length === 0) {
        resultado = { ok: false, error: (evaluacion.rechazados[0] || {}).motivo || 'No se pudo inscribir.' };
      } else {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheet = ss.getSheetByName(SHEET_INSCRIPCIONES);
        var ahora = new Date();
        var ins = evaluacion.inscriptos[0];
        var nuevoId = generarIdInscripcion_(0);
        sheet.getRange(sheet.getLastRow() + 1, 1, 1, INSCRIPCIONES_HEADERS.length).setValues([[
          nuevoId, ahora,
          comoTexto_(solicitud.dni), comoTexto_(solicitud.email), comoTexto_(solicitud.nombre), comoTexto_(solicitud.apellido),
          comoTexto_(solicitud.profesion), comoTexto_(solicitud.institucion), comoTexto_(solicitud.provincia), comoTexto_(solicitud.celular),
          comoTexto_(ins.turno_id), comoTexto_(ins.taller), comoTexto_(ins.fecha), comoTexto_(ins.horario), comoTexto_(ins.aula),
          'ACTIVA', '', 'admin', comoTexto_(ins.letra)
        ]]);
        SpreadsheetApp.flush();

        var misActivas = inscripciones
          .filter(function (i) { return i.dni === solicitud.dni && i.email === solicitud.email && i.estado === 'ACTIVA'; })
          .map(formatearInscripcionSalida_)
          .concat([{ id_inscripcion: nuevoId, turno_id: ins.turno_id, taller: ins.taller, fecha: ins.fecha, horario: ins.horario, aula: ins.aula, letra: ins.letra }]);

        resultado = { ok: true, nuevoIdInscripcion: nuevoId, mensaje: '✅ Inscripto/a en ' + ins.turno_id + '.' };
        datosParaMail = { solicitud: solicitud, mis: misActivas, config: config };
      }
    }
  } finally {
    lock.releaseLock();
  }

  return { resultado: resultado, datosParaMail: datosParaMail };
}

function procesarAltaManual_(config, turnos) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PANEL);
  var fila = PANEL_FILA_ALTA_DATOS;
  var valores = hoja.getRange(fila, 1, 1, PANEL_COL_ALTA_TURNO).getValues()[0]; // DNI,Email,Nombre,Apellido,Celular,Institución,Profesión,Provincia,Turno
  var datos = {
    dni: valores[0], email: valores[1], nombre: valores[2], apellido: valores[3], celular: valores[4],
    institucion: valores[5], profesion: valores[6], provincia: valores[7], turnoId: valores[8]
  };
  var avisarMail = hoja.getRange(PANEL_FILA_FILTRO_MAIL, 2).getValue() === true;

  hoja.getRange(fila, PANEL_COL_ALTA_INSCRIBIR).setValue(false); // destildar ya, antes de cualquier otra cosa.

  var salida = accionPanelAlta_(datos, config, turnos);
  var pendiente = null;

  if (salida.resultado.ok) {
    if (avisarMail && salida.datosParaMail && !esDniDePrueba_(salida.datosParaMail.solicitud.dni)) {
      try { enviarMailInscripcion_(salida.datosParaMail.solicitud, salida.datosParaMail.mis, salida.datosParaMail.config); } catch (e) { /* no propagar */ }
    }
    hoja.getRange(fila, 1, 1, PANEL_COL_ALTA_TURNO).clearContent(); // limpiar el formulario (DNI..Turno).
    hoja.getRange(fila, PANEL_COL_ALTA_RESULTADO).setValue(salida.resultado.mensaje);
    pendiente = { idInscripcion: salida.resultado.nuevoIdInscripcion, mensaje: salida.resultado.mensaje };
  } else {
    hoja.getRange(fila, PANEL_COL_ALTA_RESULTADO).setValue('❌ ' + salida.resultado.error);
  }

  regenerarPanel_(pendiente);
}

/** Reescribe Actualizado + RESUMEN + Totales + dropdown de filtro de turno +
 * LISTADO. `pendiente` = {idInscripcion, mensaje} opcional: inyecta un
 * RESULTADO en esa fila del listado recién reescrito (para que un ❌ de
 * mover, por ejemplo, sea visible aunque la fila no haya cambiado).
 *
 * Antes de escribir, limpia TODO formato y TODA regla de formato
 * condicional de la hoja y los vuelve a aplicar de cero (formatearPanel_)
 * -- evita arrastrar formato de un layout anterior (p.ej. "% Ocup." que
 * quedó pintado en la columna de Cupo después de mover columnas). Las
 * validaciones (desplegables/checkboxes) NO se tocan acá: no son
 * "formato" y ya se recrean donde corresponde (setupPanel para las fijas,
 * escribirFiltroTurnoOpciones_/escribirListado_ para las dinámicas). */
/** Clave en PropertiesService para la cantidad de turnos activos con la
 * que está armada la estructura ACTUAL del Panel -- ver regenerarPanel_. */
var PROP_PANEL_TURNOS_COUNT = 'panelTurnosCount';

function regenerarPanel_(pendiente) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(SHEET_PANEL);
  if (!hoja) return;

  var turnos = leerTurnos_().filter(function (t) { return t.activo === 'SI'; });

  // Auto-detección: si la cantidad de turnos activos cambió desde la
  // última vez que se armó la estructura del Panel, reconstruirla antes
  // de escribir nada -- regenerarPanel_() nunca reescribe rótulos/
  // encabezados fijos por sí sola (eso lo hace setupPanel(), adentro de
  // repararEstructura_()), así que si la cantidad cambia sin esto los
  // datos quedan desalineados (el bug de PANEL_MAX_TURNOS). Reemplaza
  // tener que acordarse de correr "Reparar panel" a mano cada vez que se
  // agrega o saca un turno en Turnos.
  var propiedades = PropertiesService.getScriptProperties();
  var cantidadGuardada = Number(propiedades.getProperty(PROP_PANEL_TURNOS_COUNT) || '-1');
  if (cantidadGuardada !== turnos.length) {
    repararEstructura_();
    hoja = ss.getSheetByName(SHEET_PANEL); // repararEstructura_ la borra y recrea -- referencia nueva.
    propiedades.setProperty(PROP_PANEL_TURNOS_COUNT, String(turnos.length));
  }

  hoja.getRange(1, 1, hoja.getMaxRows(), hoja.getMaxColumns()).clearFormat();
  hoja.setConditionalFormatRules([]);
  formatearPanel_(hoja);

  var inscripciones = leerInscripciones_();
  var activas = inscripciones.filter(function (i) { return i.estado === 'ACTIVA'; });

  hoja.getRange(PANEL_FILA_ACTUALIZADO, 1).setValue(
    'Actualizado: ' + Utilities.formatDate(new Date(), TZ, 'dd/MM HH:mm') +
    '  (se actualiza solo cada 5 min · 🛠 Talleres → Actualizar panel para verlo ya)'
  );

  asegurarFiltroTallerValido_(hoja);
  escribirResumen_(hoja, turnos, activas);
  escribirTotales_(hoja, turnos, activas);
  escribirFiltroTurnoOpciones_(hoja, turnos);
  escribirListado_(hoja, turnos, activas, pendiente || null);
}

/** Única fuente de verdad del formato visual del Panel (fuentes, colores,
 * formatos de número, wrap y las reglas de color de % Ocup.) -- todo lo
 * que `Range.clearFormat()` borra. Se llama una vez desde setupPanel y de
 * nuevo en cada regenerarPanel_, después de limpiar. No toca contenido,
 * combinaciones, validaciones, anchos de columna ni congelado. */
function formatearPanel_(hoja) {
  if (hoja.getRange('A1').getValue()) {
    hoja.getRange('A1').setFontWeight('bold').setFontSize(14).setFontColor(COLOR_AZUL);
  }

  [PANEL_FILA_RESUMEN_BANNER, PANEL_FILA_FILTRO_BANNER, PANEL_FILA_ALTA_BANNER, PANEL_FILA_LISTADO_BANNER].forEach(function (fila) {
    hoja.getRange(fila, 1).setFontWeight('bold').setFontColor(COLOR_DORADO).setFontSize(12);
  });

  hoja.getRange(PANEL_FILA_RESUMEN_HEADERS, 1, 1, 11).setFontWeight('bold').setBackground(COLOR_AZUL).setFontColor('#FFFFFF').setWrap(true);
  hoja.getRange(PANEL_FILA_ALTA_HEADERS, 1, 1, PANEL_ALTA_ANCHO).setFontWeight('bold').setBackground(COLOR_AZUL).setFontColor('#FFFFFF').setWrap(true);
  hoja.getRange(PANEL_FILA_LISTADO_HEADERS, 1, 1, 12).setFontWeight('bold').setBackground(COLOR_AZUL).setFontColor('#FFFFFF').setWrap(true);

  // RESUMEN + TOTALES: Inscriptos/Cupo/Disponibles como entero sin color;
  // % Ocup. como porcentaje, única columna con el semáforo verde/amarillo/rojo.
  // Dos rangos separados (no contiguos: entre uno y otro van la fila en
  // blanco y el banner "Totales").
  var rangoEnterosResumen = hoja.getRange(PANEL_FILA_RESUMEN_DATOS, PANEL_COL_RESUMEN_INSCRIPTOS, PANEL_MAX_TURNOS, 3); // G:I
  var rangoEnterosTotales = hoja.getRange(PANEL_FILA_TOTALES_DATOS, PANEL_COL_RESUMEN_INSCRIPTOS, 5, 3);
  rangoEnterosResumen.setNumberFormat('0');
  rangoEnterosTotales.setNumberFormat('0');

  var rangoPctResumen = hoja.getRange(PANEL_FILA_RESUMEN_DATOS, PANEL_COL_RESUMEN_PCT, PANEL_MAX_TURNOS, 1); // J
  var rangoPctTotales = hoja.getRange(PANEL_FILA_TOTALES_DATOS, PANEL_COL_RESUMEN_PCT, 5, 1);
  rangoPctResumen.setNumberFormat('0%');
  rangoPctTotales.setNumberFormat('0%');
  hoja.setConditionalFormatRules(hoja.getConditionalFormatRules().concat([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(1).setBackground('#FDEDEC').setFontColor('#C0392B').setRanges([rangoPctResumen, rangoPctTotales]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(0.8, 0.999999).setBackground('#FEF9E7').setFontColor('#9A7D0A').setRanges([rangoPctResumen, rangoPctTotales]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0.8).setBackground('#E9F7EF').setFontColor('#1E8A4C').setRanges([rangoPctResumen, rangoPctTotales]).build()
  ]));
  hoja.getRange(PANEL_FILA_TOTALES_DATOS, 1, 5, 11).setFontWeight('bold');

  // LISTADO: texto completo (sin cortar) salvo Institución (CLIP). DNI y
  // celular como texto plano para que Sheets no los reinterprete como número.
  var rangoListado = hoja.getRange(PANEL_FILA_LISTADO_DATOS, 1, PANEL_MAX_LISTADO, 11);
  rangoListado.setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
  hoja.getRange(PANEL_FILA_LISTADO_DATOS, 6, PANEL_MAX_LISTADO, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP); // Institución
  hoja.getRange(PANEL_FILA_LISTADO_DATOS, 3, PANEL_MAX_LISTADO, 1).setNumberFormat('@'); // DNI
  hoja.getRange(PANEL_FILA_LISTADO_DATOS, 5, PANEL_MAX_LISTADO, 1).setNumberFormat('@'); // Celular

  // ALTA MANUAL: fila de carga con textos largos (profesión/provincia) en 2 líneas.
  hoja.getRange(PANEL_FILA_ALTA_DATOS, 1, 1, PANEL_ALTA_ANCHO).setWrap(true);
}

function barraTexto_(pct) {
  var llenos = Math.max(0, Math.min(10, Math.round(pct * 10)));
  return Array(llenos + 1).join('▓') + Array(10 - llenos + 1).join('░');
}

// Mapeo de columnas de RESUMEN/TOTALES (A..K, 11 columnas de la grilla
// única del Panel): A:D combinada = Taller/etiqueta, E = Aula, F = Día y
// horario, G = Inscriptos, H = Cupo, I = Disponibles, J = % Ocup., K = Barra.
var PANEL_COL_RESUMEN_INSCRIPTOS = 7; // G (Inscriptos, Cupo y Disponibles: G:I)
var PANEL_COL_RESUMEN_PCT = 10;

/** Solo escribe valores -- el formato (número, color, negrita) ya lo dejó
 * puesto formatearPanel_ antes de llamar a esta función. */
function escribirResumen_(hoja, turnos, activas) {
  var rango = hoja.getRange(PANEL_FILA_RESUMEN_DATOS, 1, PANEL_MAX_TURNOS, 11);
  rango.clearContent();

  var ordenados = turnos.slice().sort(function (a, b) { return compararPorLetra_(a.letra, b.letra); }).slice(0, PANEL_MAX_TURNOS);
  var filas = ordenados.map(function (t) {
    var ocupados = activas.filter(function (i) { return i.turno_id === t.id; }).length;
    var disponibles = Math.max(t.cupo - ocupados, 0);
    var pct = t.cupo > 0 ? ocupados / t.cupo : 0;
    var etiquetaTaller = t.letra ? 'Taller ' + t.letra + ' · ' + t.taller : t.taller;
    return [etiquetaTaller, '', '', '', t.aula, fechaCorta_(t.fecha) + ' ' + t.inicio + '-' + t.fin, ocupados, t.cupo, disponibles, pct, barraTexto_(pct)];
  });
  if (filas.length === 0) return;

  hoja.getRange(PANEL_FILA_RESUMEN_DATOS, 1, filas.length, 11).setValues(filas);
}

/** Solo escribe valores -- ídem escribirResumen_. */
function escribirTotales_(hoja, turnos, activas) {
  var rango = hoja.getRange(PANEL_FILA_TOTALES_DATOS, 1, 5, 11);
  rango.clearContent();

  var filas = HOJAS_TALLER.map(function (prefijo) {
    var turnosTaller = turnos.filter(function (t) { return t.id.indexOf(prefijo) === 0; });
    var nombre = turnosTaller.length > 0 ? turnosTaller[0].taller : prefijo;
    var cupo = turnosTaller.reduce(function (s, t) { return s + t.cupo; }, 0);
    var ocupados = activas.filter(function (i) { return i.turno_id.indexOf(prefijo) === 0; }).length;
    var disponibles = Math.max(cupo - ocupados, 0);
    var pct = cupo > 0 ? ocupados / cupo : 0;
    return ['Total ' + nombre, '', '', '', '', '', ocupados, cupo, disponibles, pct, barraTexto_(pct)];
  });

  var cupoTotal = turnos.reduce(function (s, t) { return s + t.cupo; }, 0);
  var ocupadosTotal = activas.length;
  var pctTotal = cupoTotal > 0 ? ocupadosTotal / cupoTotal : 0;
  filas.push(['TOTAL GENERAL', '', '', '', '', '', ocupadosTotal, cupoTotal, Math.max(cupoTotal - ocupadosTotal, 0), pctTotal, barraTexto_(pctTotal)]);

  hoja.getRange(PANEL_FILA_TOTALES_DATOS, 1, filas.length, 11).setValues(filas);
}

function escribirFiltroTurnoOpciones_(hoja, turnos) {
  var opciones = ['Todos'].concat(
    turnos.slice().sort(function (a, b) { return compararPorLetra_(a.letra, b.letra); }).map(function (t) { return t.id; })
  );
  var celda = hoja.getRange(PANEL_FILA_FILTRO_TURNO, 2);
  celda.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(opciones, true).setAllowInvalid(false).build());
  var actual = String(celda.getValue() || '').trim();
  if (!actual) { celda.setValue('Todos'); return; }
  if (opciones.indexOf(actual) === -1) celda.setValue('Todos'); // turno dado de baja: no dejar el filtro roto.
}

/** Mismo criterio que el filtro de Turno de arriba: si el filtro de
 * Taller quedó en un prefijo que ya no existe (p.ej. se sacó un taller
 * entero de HOJAS_TALLER), lo resetea a "Todos" en vez de dejarlo roto. */
function asegurarFiltroTallerValido_(hoja) {
  var celda = hoja.getRange(PANEL_FILA_FILTRO_TALLER, 2);
  var actual = String(celda.getValue() || '').trim();
  var valido = ['Todos'].concat(HOJAS_TALLER).indexOf(actual) !== -1;
  if (!valido) celda.setValue('Todos');
}

function escribirListado_(hoja, turnos, activas, pendiente) {
  var filtroTaller = String(hoja.getRange(PANEL_FILA_FILTRO_TALLER, 2).getValue() || 'Todos').trim();
  var filtroTurno = String(hoja.getRange(PANEL_FILA_FILTRO_TURNO, 2).getValue() || 'Todos').trim();

  var filtradas = activas.filter(function (i) {
    if (filtroTaller !== 'Todos' && i.turno_id.indexOf(filtroTaller) !== 0) return false;
    if (filtroTurno !== 'Todos' && i.turno_id !== filtroTurno) return false;
    return true;
  });
  filtradas.sort(function (a, b) {
    var c = compararPorLetra_(a.letra, b.letra);
    return c !== 0 ? c : a.apellido.localeCompare(b.apellido);
  });
  filtradas = filtradas.slice(0, PANEL_MAX_LISTADO);

  var rangoTotal = hoja.getRange(PANEL_FILA_LISTADO_DATOS, 1, PANEL_MAX_LISTADO, 12);
  rangoTotal.clearContent();
  rangoTotal.clearDataValidations();
  if (filtradas.length === 0) return;

  var filas = filtradas.map(function (i) {
    var mensaje = pendiente && pendiente.idInscripcion === i.id_inscripcion ? pendiente.mensaje : '';
    var etiquetaTaller = i.letra ? 'Taller ' + i.letra + ' · ' + i.taller : i.taller;
    return [i.apellido, i.nombre, i.dni, i.email, i.celular, i.institucion, etiquetaTaller, i.turno_id, i.horario, '', mensaje, i.id_inscripcion];
  });
  hoja.getRange(PANEL_FILA_LISTADO_DATOS, 1, filas.length, 12).setValues(filas);

  for (var idx = 0; idx < filtradas.length; idx++) {
    var insc = filtradas[idx];
    var prefijo = buscarPrimero_(HOJAS_TALLER, function (p) { return insc.turno_id.indexOf(p) === 0; });
    var opciones = ['Dar de baja'].concat(
      turnos
        .filter(function (t) { return prefijo && t.id.indexOf(prefijo) === 0 && t.id !== insc.turno_id; })
        .sort(function (a, b) { return compararPorLetra_(a.letra, b.letra); })
        .map(function (t) { return 'Mover a ' + t.id + ' (' + t.inicio + '-' + t.fin + ')'; })
    );
    var validacion = SpreadsheetApp.newDataValidation().requireValueInList(opciones, true).setAllowInvalid(false).build();
    hoja.getRange(PANEL_FILA_LISTADO_DATOS + idx, PANEL_COL_ACCION).setDataValidation(validacion);
  }
}

// ================== UTILIDAD DE PRUEBAS ==================

/** Para ejecutar a mano desde el editor de Apps Script: manda un mail de
 * prueba real (mismo remitente/HTML que usa la app) a gellinegarcia@gmail.com
 * y deja en el log la cuota diaria, la cuenta que ejecuta el script, y --
 * sin try/catch que lo oculte -- el error completo tal cual lo tira
 * MailApp.sendEmail() si falla. */
function probarMail() {
  var config = leerConfig_();
  console.log('Cuota diaria restante: ' + MailApp.getRemainingDailyQuota());
  console.log('Cuenta que ejecuta el script: ' + Session.getEffectiveUser().getEmail());
  var asunto = 'Prueba de envío – ' + NOMBRE_EVENTO;
  var cuerpo =
    '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">' +
    '<h2 style="color:' + COLOR_AZUL + ';">Mail de prueba</h2>' +
    '<p>Si recibiste esto, el envío de mails desde el script está funcionando.</p>' +
    FOOTER_MAIL_ +
    '</div>';
  MailApp.sendEmail('gellinegarcia@gmail.com', asunto, textoPlano_(cuerpo), opcionesMail_(cuerpo, config));
  console.log('sendEmail no lanzó excepción: el envío salió del lado de Apps Script.');
}

/** Borra las inscripciones de prueba (DNI que empieza con 99000). Única función que borra filas. */
function limpiarPruebas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_INSCRIPCIONES);
  var n = Math.max(sheet.getLastRow() - 1, 0);
  if (n === 0) return;
  var filas = sheet.getRange(2, 1, n, INSCRIPCIONES_HEADERS.length).getValues();
  for (var i = filas.length - 1; i >= 0; i--) {
    var dni = String(filas[i][2]).replace(/\D/g, '');
    if (dni.indexOf(PREFIJO_DNI_PRUEBA) === 0) {
      sheet.deleteRow(i + 2);
    }
  }
}

// ================== MIGRACIÓN A LA VERSIÓN UNIFICADA (octubre) ==================

/**
 * Correr UNA sola vez, a mano, desde el editor de Apps Script. Pasos:
 * 1. Backup (solo valores) de Turnos e Inscripciones -- antes de tocar nada.
 * 2. Reemplaza Turnos por los 12 definitivos (A-L, ver TURNOS_DEFINITIVOS).
 * 3. Vacía Inscripciones y ColaMails (quedan los encabezados).
 * 4. Actualiza Config: nombre_remitente, cierre. ('fase'/token_* de una
 *    instalación vieja, si quedaron, no se tocan -- ya no los lee ningún
 *    código, quedan inertes.)
 * 5. Regenera el Panel.
 * Al final deja en el log cuántas filas se movieron a cada backup.
 */
function migrarOctubre() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sello = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmm');

  var filasBackupTurnos = copiarHojaABackup_(ss, SHEET_TURNOS, 'Backup Turnos ' + sello);
  var filasBackupInscripciones = copiarHojaABackup_(ss, SHEET_INSCRIPCIONES, 'Backup Inscripciones ' + sello);

  var hojaTurnos = ss.getSheetByName(SHEET_TURNOS);
  hojaTurnos.getRange(2, 1, Math.max(hojaTurnos.getMaxRows() - 1, 1), TURNOS_HEADERS.length).clearContent();
  hojaTurnos.getRange(2, 1, TURNOS_DEFINITIVOS.length, TURNOS_HEADERS.length).setValues(TURNOS_DEFINITIVOS);

  vaciarDatos_(ss, SHEET_INSCRIPCIONES);
  vaciarDatos_(ss, SHEET_COLA_MAILS);

  escribirConfig_(ss, 'nombre_remitente', 'Comité Organizador – ' + NOMBRE_EVENTO);
  escribirConfig_(ss, 'cierre', '2026-10-06 12:00');

  ocultarHojasInternas_(ss); // oculta los 2 backups recién creados (nombre contiene "Backup").
  repararPanel();

  console.log('Backup Turnos: ' + filasBackupTurnos + ' filas de datos movidas a "Backup Turnos ' + sello + '".');
  console.log('Backup Inscripciones: ' + filasBackupInscripciones + ' filas de datos movidas a "Backup Inscripciones ' + sello + '".');
  console.log('Turnos reemplazados por los ' + TURNOS_DEFINITIVOS.length + ' definitivos (A-L).');
  console.log('Inscripciones y ColaMails vaciadas (quedan los encabezados).');
  console.log('Config actualizada: nombre_remitente, cierre = 2026-10-06 12:00.');
  console.log('Panel reconstruido y "Por persona" reordenada por letra.');
}

/**
 * Reconstruye la ESTRUCTURA de las hojas derivadas -- Panel entero
 * (se borra y se vuelve a crear con setupPanel()) y la fórmula de
 * "Por persona" (una que ya existe no se reescribe sola, ver
 * setupPorPersona) -- sin escribir los datos del Panel todavía (eso lo
 * hace regenerarPanel_() a continuación, que también la llama sola si
 * detecta que cambió la cantidad de turnos activos, ver
 * PROP_PANEL_TURNOS_COUNT). No toca Turnos/Inscripciones/Config -- segura
 * de correr las veces que haga falta, no borra ninguna inscripción.
 */
function repararEstructura_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var hojaPanelVieja = ss.getSheetByName(SHEET_PANEL);
  if (hojaPanelVieja) ss.deleteSheet(hojaPanelVieja);
  setupPanel(ss);

  var hojaPorPersona = ss.getSheetByName(SHEET_POR_PERSONA);
  if (hojaPorPersona) hojaPorPersona.clear();
  setupPorPersona(ss);
}

/** Punto de entrada público: el editor de Apps Script NO lista en el
 * desplegable "Seleccionar función" las que terminan en "_" (se tratan
 * como privadas), así que esta es la forma de correr la reparación a
 * mano. Reconstruye el Panel entero y escribe los datos de una. */
function repararPanel() {
  repararEstructura_();
  regenerarPanel_();
}

function repararPanelDesdeMenu_() {
  repararPanel();
  SpreadsheetApp.getActiveSpreadsheet().toast('Panel reconstruido.', '🛠 Talleres', 4);
}

/** Copia TODOS los valores (encabezado + datos) de `nombreOrigen` a una
 * hoja nueva `nombreBackup`, tal cual están (solo valores, sin fórmulas).
 * Devuelve la cantidad de filas de DATOS copiadas (sin contar encabezado). */
function copiarHojaABackup_(ss, nombreOrigen, nombreBackup) {
  var origen = ss.getSheetByName(nombreOrigen);
  if (!origen) return 0;
  var filas = origen.getLastRow();
  var columnas = origen.getLastColumn();
  if (filas === 0 || columnas === 0) return 0;
  var valores = origen.getRange(1, 1, filas, columnas).getValues();
  var backup = ss.insertSheet(nombreBackup);
  backup.getRange(1, 1, valores.length, valores[0].length).setValues(valores);
  return Math.max(filas - 1, 0);
}

/** Borra las filas de DATOS de una hoja (deja el encabezado de la fila 1 intacto). */
function vaciarDatos_(ss, nombreHoja) {
  var hoja = ss.getSheetByName(nombreHoja);
  if (!hoja || hoja.getLastRow() <= 1) return;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clearContent();
}

/** Escribe (o crea, si no existía) una clave en Config. */
function escribirConfig_(ss, clave, valor) {
  var hoja = ss.getSheetByName(SHEET_CONFIG);
  var n = Math.max(hoja.getLastRow() - 1, 0);
  var filaEncontrada = -1;
  if (n > 0) {
    var claves = hoja.getRange(2, 1, n, 1).getValues();
    for (var i = 0; i < claves.length; i++) {
      if (String(claves[i][0]).trim() === clave) { filaEncontrada = i + 2; break; }
    }
  }
  if (filaEncontrada === -1) filaEncontrada = hoja.getLastRow() + 1;
  hoja.getRange(filaEncontrada, 1, 1, 2).setValues([[clave, valor]]);
}

// ================== EXPORT PARA TESTS EN NODE ==================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validar: validar,
    validarDatosGenerales: validarDatosGenerales,
    seSuperponen_: seSuperponen_,
    horaAMinutos_: horaAMinutos_,
    fechaCorta_: fechaCorta_,
    resolverTurnoDeInscripcion_: resolverTurnoDeInscripcion_,
    normalizarDni_: normalizarDni_,
    normalizarEmail_: normalizarEmail_,
    parsearFechaHoraArg_: parsearFechaHoraArg_,
    inscripcionesCerradas_: inscripcionesCerradas_,
    MAX_TALLERES_POR_PERSONA: MAX_TALLERES_POR_PERSONA
  };
}