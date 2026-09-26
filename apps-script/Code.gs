/**
 * Talleres — 1era Jornada Nacional de Donación y Trasplante INCUCAI
 * Backend Google Apps Script (Web App) + Google Sheets como base de datos.
 * Zona horaria: America/Argentina/Buenos_Aires en todo.
 */

// ================== CONSTANTES ==================

var SHEET_CONFIG = 'Config';
var SHEET_TURNOS = 'Turnos';
var SHEET_INSCRIPCIONES = 'Inscripciones';
var SHEET_RESUMEN = 'Resumen';
var SHEET_POR_PERSONA = 'Por persona';
var SHEET_COLA_MAILS = 'ColaMails';
var HOJAS_TALLER = ['PRN', 'ECO', 'COM', 'SOC']; // prefijo de id de turno == nombre de hoja

var TZ = 'America/Argentina/Buenos_Aires';

var COLOR_AZUL = '#2B3A67';
var COLOR_DORADO = '#E3B868';

var MAX_INTENTOS_MAIL = 3;
var PREFIJO_DNI_PRUEBA = '99000';

var INSCRIPCIONES_HEADERS = ['id_inscripcion', 'timestamp', 'dni', 'email', 'nombre', 'apellido', 'profesion', 'institucion', 'provincia', 'celular', 'turno_id', 'taller', 'fecha', 'horario', 'aula', 'estado', 'fecha_anulacion'];
var TURNOS_HEADERS = ['id', 'taller', 'aula', 'fecha', 'inicio', 'fin', 'cupo', 'activo'];
var CONFIG_HEADERS = ['clave', 'valor'];
var COLA_MAILS_HEADERS = ['timestamp', 'email', 'asunto', 'cuerpo_html', 'estado', 'intentos'];

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
  eliminarHojaPorDefectoSiVacia_(ss);
  SpreadsheetApp.flush();
}

/** Al crear la Google Sheet a mano queda la hoja "Hoja 1" en blanco.
 * Se borra sola acá (al final, cuando ya existen las demás -- una
 * spreadsheet no puede quedar sin ninguna hoja), y solo si sigue vacía
 * (si el organizador ya la usó para algo, no se toca). */
function eliminarHojaPorDefectoSiVacia_(ss) {
  var sheet = ss.getSheetByName('Hoja 1');
  if (sheet && sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
    ss.deleteSheet(sheet);
  }
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
  var claves = ['inscripcion_abierta', 'nombre_remitente', 'reply_to', 'url_app'];
  var valoresPorDefecto = {
    inscripcion_abierta: 'SI',
    nombre_remitente: 'Comité Organizador 1era Jornada Nacional de Donación y Trasplante INCUCAI',
    reply_to: '',
    url_app: ''
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

function setupTurnos(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_TURNOS);
  asegurarEncabezado_(sheet, TURNOS_HEADERS);
  // Formato texto plano ("@") en fecha/inicio/fin para que Sheets no las convierta a Date.
  var maxFilas = Math.max(sheet.getMaxRows(), 200);
  sheet.getRange(2, 4, maxFilas - 1, 3).setNumberFormat('@');

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

function construirPrecargaTurnos_() {
  var horariosPRNECO = [['10:00', '11:30'], ['11:30', '13:00'], ['14:00', '15:30'], ['15:30', '17:00']];
  var filas = [];

  horariosPRNECO.forEach(function (h, i) {
    filas.push(['PRN-' + (i + 1), 'Perfusión regional normotérmica', 'Aula A', '2026-10-14', h[0], h[1], 60, 'SI']);
  });
  horariosPRNECO.forEach(function (h, i) {
    filas.push(['ECO-' + (i + 1), 'Ultrasonografía en donación', 'Aula B', '2026-10-14', h[0], h[1], 30, 'SI']);
  });

  var horariosCOM = [['10:00', '11:00'], ['11:00', '12:00'], ['14:00', '15:00'], ['15:00', '16:00']];
  horariosCOM.forEach(function (h, i) {
    filas.push(['COM-' + (i + 1), 'Comunicación en donación', 'Aula A', '2026-10-15', h[0], h[1], 25, 'SI']);
  });

  filas.push(['SOC-1', 'Acompañamiento social', 'Aula B', '2026-10-15', '14:00', '17:00', 50, 'SI']);

  return filas;
}

function setupInscripciones(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_INSCRIPCIONES);
  asegurarEncabezado_(sheet, INSCRIPCIONES_HEADERS);
  sheet.autoResizeColumns(1, INSCRIPCIONES_HEADERS.length);
}

var RESUMEN_MAX_FILAS = 200; // margen generoso por si el organizador agrega turnos nuevos en Turnos.

function setupResumen(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_RESUMEN);
  var headers = ['id', 'taller', 'fecha', 'horario', 'aula', 'cupo', 'inscriptos', 'disponibles'];
  asegurarEncabezado_(sheet, headers);
  // Fórmulas fila-por-fila (fila N de Resumen == fila N de Turnos, ambas
  // arrancan en la fila 2) -- deliberadamente SIN ARRAYFORMULA anidado con
  // COUNTIFS: esa combinación es frágil en Sheets. Cada celda es una
  // fórmula simple e independiente, el patrón más robusto y estándar.
  // Se escriben todas de una con setFormulas() (una sola llamada) en vez de
  // celda por celda, para no hacer cientos de llamadas al servicio.
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
  // Encabezado de conteo por turno en la fila 1, encabezado de columnas en la fila 2, datos desde la fila 3.
  var primeraCelda = sheet.getRange('A1').getValue();
  if (!primeraCelda) {
    // Reusa la columna "inscriptos" ya calculada en Resumen (fila-por-fila,
    // sin COUNTIFS anidado en ARRAYFORMULA -- ver nota en setupResumen) en
    // vez de recalcularla acá con el mismo patrón frágil.
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
    // Inscripciones: K=turno_id, L=taller, M=fecha, N=horario, O=aula, F=apellido, E=nombre, C=dni, D=email, J=celular, G=profesion, H=institucion, I=provincia, P=estado
    var formula = '=IFERROR(SORT(FILTER({' +
      SHEET_INSCRIPCIONES + '!K:K,' + SHEET_INSCRIPCIONES + '!N:N,' + SHEET_INSCRIPCIONES + '!F:F,' +
      SHEET_INSCRIPCIONES + '!E:E,' + SHEET_INSCRIPCIONES + '!C:C,' + SHEET_INSCRIPCIONES + '!D:D,' +
      SHEET_INSCRIPCIONES + '!J:J,' + SHEET_INSCRIPCIONES + '!G:G,' + SHEET_INSCRIPCIONES + '!H:H,' + SHEET_INSCRIPCIONES + '!I:I' +
      '},LEFT(' + SHEET_INSCRIPCIONES + '!K:K,' + prefijo.length + ')="' + prefijo + '",' + SHEET_INSCRIPCIONES + '!P:P="ACTIVA"),1,TRUE,3,TRUE),"")';
    sheet.getRange('A3').setFormula(formula);
  }
  sheet.autoResizeColumns(1, headers.length);
}

function setupPorPersona(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_POR_PERSONA);
  var headers = ['apellido', 'nombre', 'dni', 'email', 'celular', 'profesion', 'institucion', 'provincia', 'taller', 'fecha', 'horario', 'aula', 'timestamp'];
  asegurarEncabezado_(sheet, headers);
  var celdaFormula = sheet.getRange('A2').getFormula();
  if (!celdaFormula) {
    // Inscripciones: F=apellido, E=nombre, C=dni, D=email, J=celular, G=profesion, H=institucion, I=provincia, L=taller, M=fecha, N=horario, O=aula, B=timestamp, P=estado
    var formula = '=IFERROR(SORT(FILTER({' +
      SHEET_INSCRIPCIONES + '!F:F,' + SHEET_INSCRIPCIONES + '!E:E,' + SHEET_INSCRIPCIONES + '!C:C,' +
      SHEET_INSCRIPCIONES + '!D:D,' + SHEET_INSCRIPCIONES + '!J:J,' + SHEET_INSCRIPCIONES + '!G:G,' +
      SHEET_INSCRIPCIONES + '!H:H,' + SHEET_INSCRIPCIONES + '!I:I,' + SHEET_INSCRIPCIONES + '!L:L,' +
      SHEET_INSCRIPCIONES + '!M:M,' + SHEET_INSCRIPCIONES + '!N:N,' + SHEET_INSCRIPCIONES + '!O:O,' + SHEET_INSCRIPCIONES + '!B:B' +
      '},' + SHEET_INSCRIPCIONES + '!P:P="ACTIVA"),1,TRUE,13,TRUE),"")';
    sheet.getRange('A2').setFormula(formula);
  }
  sheet.autoResizeColumns(1, headers.length);
}

function setupColaMails(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_COLA_MAILS);
  asegurarEncabezado_(sheet, COLA_MAILS_HEADERS);
  sheet.autoResizeColumns(1, COLA_MAILS_HEADERS.length);
}

// ================== ROUTER doGet ==================

function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = params.action;
  var resultado;
  try {
    switch (action) {
      case 'turnos':
        resultado = accionTurnos();
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
  var datos = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 2).getValues();
  var config = {};
  datos.forEach(function (fila) {
    if (fila[0]) config[String(fila[0]).trim()] = fila[1];
  });
  return config;
}

/** Convierte lo que venga en la celda (texto "YYYY-MM-DD" o Date) a "YYYY-MM-DD". */
function normalizarFecha_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]);
  // DD/MM/AAAA (formato argentino) -- m2[1]=día, m2[2]=mes, m2[3]=año.
  var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
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
  var filas = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), TURNOS_HEADERS.length).getValues();
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
        activo: String(f[7]).trim().toUpperCase()
      };
    });
}

function leerInscripciones_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_INSCRIPCIONES);
  var filas = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), INSCRIPCIONES_HEADERS.length).getValues();
  // OJO: fila = i+2 tiene que calcularse ANTES de filtrar filas vacías --
  // si el filter fuera primero, "i" sería el índice dentro del array YA
  // filtrado, no la posición real en la hoja (se rompe apenas hay una fila
  // vacía en el medio). Por eso acá es map() y DESPUÉS filter().
  return filas
    .map(function (f, i) {
      return {
        fila: i + 2, // fila real en la hoja, para poder editarla después
        id_inscripcion: String(f[0]),
        timestamp: f[1],
        dni: String(f[2]).trim(),
        email: String(f[3]).trim().toLowerCase(),
        nombre: String(f[4]),
        apellido: String(f[5]),
        profesion: String(f[6]),
        institucion: String(f[7]),
        provincia: String(f[8]),
        celular: String(f[9]),
        turno_id: String(f[10]).trim(),
        taller: String(f[11]),
        fecha: normalizarFecha_(f[12]),
        horario: String(f[13]),
        aula: String(f[14]),
        estado: String(f[15]).trim().toUpperCase(),
        fecha_anulacion: f[16]
      };
    })
    .filter(function (r) { return r.id_inscripcion; });
}

// ================== VALIDACIÓN PURA (testeable en Node) ==================

/**
 * Reglas de "LÓGICA inscribir", en orden, por cada turno pedido:
 * 1. Ya inscripto en ESE turno.
 * 2. Ya inscripto en el MISMO taller, otro turno.
 * 3. Dos turnos del mismo taller en la misma solicitud.
 * 4. Superposición horaria (con activas existentes o con turnos ya aceptados en esta misma solicitud).
 * 5. Cupo.
 *
 * `inscripcion_abierta`, campos obligatorios, email válido y compromiso=SI
 * se validan ANTES de llegar acá (ver accionInscribir) porque combinan
 * datos de Config con datos de la solicitud — acá solo entra lo que la
 * firma pide: solicitud, inscripcionesExistentes, turnos.
 *
 * No usa ninguna API de Google — 100% testeable en Node con el mismo código.
 */
function validar(solicitud, inscripcionesExistentes, turnos) {
  var activas = inscripcionesExistentes.filter(function (i) { return i.estado === 'ACTIVA'; });
  var turnosPorId = {};
  turnos.forEach(function (t) { turnosPorId[t.id] = t; });

  var aceptados = [];
  var inscriptos = [];
  var rechazados = [];

  var idsSolicitados = solicitud.turnoIds || [];

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

    // 2. Ya inscripto en el MISMO taller, otro turno (entre activas existentes).
    // Compara contra el taller RESUELTO (turnosPorId), no el texto guardado
    // en la fila -- si el organizador renombra un taller en Turnos, esto
    // sigue detectando bien en vez de comparar contra un nombre viejo.
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

    // 3. Dos turnos del mismo taller en la misma solicitud.
    var mismoTallerAceptado = buscarPrimero_(aceptados, function (a) { return a.taller === turno.taller; });
    if (mismoTallerAceptado) {
      rechazados.push({
        turno_id: turnoId,
        motivo: 'Ya elegiste un turno de ' + turno.taller + ' en esta misma solicitud (' + fechaCorta_(mismoTallerAceptado.fecha) + ' de ' + mismoTallerAceptado.inicio + ' a ' + mismoTallerAceptado.fin + ').'
      });
      return;
    }

    // 4. Superposición horaria (activas existentes + aceptados en esta solicitud).
    var referencias = activas
      .filter(function (i) { return i.dni === solicitud.dni; })
      .map(function (i) { return resolverTurnoDeInscripcion_(i, turnosPorId); })
      .concat(aceptados);
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

    // 5. Cupo.
    var ocupados = activas.filter(function (i) { return i.turno_id === turnoId; }).length;
    if (ocupados >= turno.cupo) {
      rechazados.push({ turno_id: turnoId, motivo: 'Sin cupo disponible en este turno.' });
      return;
    }

    // OK.
    var aceptado = { turno_id: turnoId, taller: turno.taller, fecha: turno.fecha, inicio: turno.inicio, fin: turno.fin, aula: turno.aula };
    aceptados.push(aceptado);
    inscriptos.push({
      turno_id: turnoId,
      taller: turno.taller,
      fecha: turno.fecha,
      horario: turno.inicio + '-' + turno.fin,
      aula: turno.aula
    });
  });

  return { ok: true, inscriptos: inscriptos, rechazados: rechazados };
}

/** Validaciones generales de la solicitud que NO requieren Config (campos, email, compromiso). */
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

/** Usa el turno actual (turnosPorId) si existe; si no, cae al fecha/horario guardados en la inscripción. */
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

// ================== ACCIONES ==================

function accionTurnos() {
  var turnos = leerTurnos_();
  var inscripciones = leerInscripciones_();
  var activas = inscripciones.filter(function (i) { return i.estado === 'ACTIVA'; });
  var salida = turnos
    .filter(function (t) { return t.activo === 'SI'; })
    .map(function (t) {
      var ocupados = activas.filter(function (i) { return i.turno_id === t.id; }).length;
      return {
        id: t.id,
        taller: t.taller,
        aula: t.aula,
        fecha: t.fecha,
        inicio: t.inicio,
        fin: t.fin,
        cupo: t.cupo,
        ocupados: ocupados,
        disponibles: Math.max(t.cupo - ocupados, 0)
      };
    });
  var config = leerConfig_();
  return { ok: true, inscripcion_abierta: String(config.inscripcion_abierta || '').trim().toUpperCase() === 'SI', turnos: salida };
}

function normalizarDni_(dni) {
  return String(dni || '').replace(/\D/g, '').trim();
}
function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function accionMis(dniCrudo, emailCrudo) {
  var dni = normalizarDni_(dniCrudo);
  var email = normalizarEmail_(emailCrudo);
  if (!dni || !email) return { ok: false, error: 'Faltan DNI y/o email.' };

  var inscripciones = leerInscripciones_();
  var mias = inscripciones.filter(function (i) { return i.dni === dni && i.email === email && i.estado === 'ACTIVA'; });

  // Si el DNI existe con OTRO email, avisar (mismo criterio que en inscribir).
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
    aula: i.aula
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

/** Fuerza a texto plano (prefijo de apóstrofe, como tipear en la hoja a
 * mano) -- evita que Sheets interprete un DNI/celular/etc. como fórmula
 * (ej. celular "+5411...") o lo reformatee solo (ej. una fecha). */
function comoTexto_(v) {
  return "'" + String(v);
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
    turnoIds: String(params.turnos || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
  };

  var generales = validarDatosGenerales(solicitud);
  if (!generales.ok) return generales;

  var lock = LockService.getScriptLock();
  var pudoTomarLock = lock.tryLock(30000);
  if (!pudoTomarLock) {
    return { ok: false, error: 'El sistema está muy ocupado. Probá de nuevo en unos segundos.' };
  }

  var resultado;
  var inscripcionesParaMail = null;
  try {
    var config = leerConfig_();
    if (String(config.inscripcion_abierta || '').trim().toUpperCase() !== 'SI') {
      return { ok: false, error: 'Las inscripciones están cerradas.' };
    }

    // DNI ya existe con otro email -> rechazar toda la solicitud.
    var inscripciones = leerInscripciones_();
    var otroEmail = buscarPrimero_(inscripciones, function (i) { return i.dni === solicitud.dni && i.email !== solicitud.email; });
    if (otroEmail) {
      return { ok: false, error: 'Este DNI ya está registrado con otro email (' + ofuscarEmail_(otroEmail.email) + '). Usá ese email o escribí a los organizadores.' };
    }

    var turnos = leerTurnos_();
    var evaluacion = validar(solicitud, inscripciones, turnos);

    if (evaluacion.inscriptos.length > 0) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SHEET_INSCRIPCIONES);
      var ahora = new Date();
      var filasNuevas = evaluacion.inscriptos.map(function (ins, k) {
        return [
          generarIdInscripcion_(k), ahora,
          comoTexto_(solicitud.dni), comoTexto_(solicitud.email), comoTexto_(solicitud.nombre), comoTexto_(solicitud.apellido),
          comoTexto_(solicitud.profesion), comoTexto_(solicitud.institucion), comoTexto_(solicitud.provincia), comoTexto_(solicitud.celular),
          comoTexto_(ins.turno_id), comoTexto_(ins.taller), comoTexto_(ins.fecha), comoTexto_(ins.horario), comoTexto_(ins.aula),
          'ACTIVA', ''
        ];
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, filasNuevas.length, INSCRIPCIONES_HEADERS.length).setValues(filasNuevas);
      SpreadsheetApp.flush();
    }

    // Recalcular "mis" con lo que quedó activo (incluye lo recién insertado).
    var inscripcionesFinal = leerInscripciones_();
    var misActivas = inscripcionesFinal.filter(function (i) { return i.dni === solicitud.dni && i.email === solicitud.email && i.estado === 'ACTIVA'; });

    resultado = {
      ok: true,
      inscriptos: evaluacion.inscriptos,
      rechazados: evaluacion.rechazados,
      mis: misActivas.map(formatearInscripcionSalida_)
    };

    if (evaluacion.inscriptos.length > 0) {
      inscripcionesParaMail = { solicitud: solicitud, mis: misActivas.map(formatearInscripcionSalida_), config: config };
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
      // El fallo ya se maneja adentro de enviarMailInscripcion_ (encola en ColaMails). No propagar.
    }
  }

  return resultado;
}

function accionAnular(dniCrudo, emailCrudo, idInscripcion) {
  var dni = normalizarDni_(dniCrudo);
  var email = normalizarEmail_(emailCrudo);
  if (!dni || !email || !idInscripcion) {
    return { ok: false, error: 'Faltan datos para anular (DNI, email o inscripción).' };
  }

  var lock = LockService.getScriptLock();
  var pudoTomarLock = lock.tryLock(30000);
  if (!pudoTomarLock) {
    return { ok: false, error: 'El sistema está muy ocupado. Probá de nuevo en unos segundos.' };
  }

  var resultado;
  var datosParaMail = null;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_INSCRIPCIONES);
    var inscripciones = leerInscripciones_();
    var propia = buscarPrimero_(inscripciones, function (i) {
      return i.id_inscripcion === idInscripcion && i.dni === dni && i.email === email && i.estado === 'ACTIVA';
    });
    if (!propia) {
      resultado = { ok: false, error: 'No se encontró esa inscripción activa a tu nombre.' };
    } else if (String(sheet.getRange(propia.fila, 1).getValue()) !== propia.id_inscripcion) {
      // Defensa extra: la fila pudo haberse corrido entre la lectura y la
      // escritura (ej. alguien borró una fila a mano mientras tanto). Mejor
      // no escribir a ciegas en una fila que puede ya no ser la que creemos.
      resultado = { ok: false, error: 'No se pudo anular en este momento. Probá de nuevo.' };
    } else {
      var ahora = new Date();
      sheet.getRange(propia.fila, 16).setValue('ANULADA'); // columna P = estado
      sheet.getRange(propia.fila, 17).setValue(ahora); // columna Q = fecha_anulacion
      SpreadsheetApp.flush();

      var config = leerConfig_();
      var restantes = leerInscripciones_().filter(function (i) { return i.dni === dni && i.email === email && i.estado === 'ACTIVA'; });
      resultado = { ok: true, anulado: formatearInscripcionSalida_(propia), mis: restantes.map(formatearInscripcionSalida_) };
      datosParaMail = { dni: dni, email: email, nombre: propia.nombre, anulado: propia, mis: restantes.map(formatearInscripcionSalida_), config: config };
    }
  } finally {
    lock.releaseLock();
  }

  if (datosParaMail) {
    try {
      if (!esDniDePrueba_(datosParaMail.dni)) {
        enviarMailAnulacion_(datosParaMail);
      }
    } catch (e) {
      // idem accionInscribir: nunca romper la respuesta por un fallo de mail.
    }
  }

  return resultado;
}

function esDniDePrueba_(dni) {
  return String(dni).indexOf(PREFIJO_DNI_PRUEBA) === 0;
}

// ================== MAILS ==================

function tablaHtmlTurnos_(lista) {
  var filas = lista.map(function (t) {
    return '<tr>' +
      '<td style="padding:8px;border-bottom:1px solid #eee;">' + escapeHtml_(t.taller) + '</td>' +
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
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function armarMailInscripcion_(nombre, mis, urlApp) {
  var asunto = 'Recibimos tu inscripción – Talleres 1era Jornada Nacional de Donación y Trasplante';
  var cuerpo =
    '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">' +
    '<h2 style="color:' + COLOR_AZUL + ';">Hola ' + escapeHtml_(nombre) + ':</h2>' +
    '<p>¡Estamos muy felices de contar con vos! Recibimos tu solicitud de inscripción a los siguientes talleres:</p>' +
    tablaHtmlTurnos_(mis) +
    '<p>Tu inscripción será confirmada por este medio.</p>' +
    '<p>Te pedimos un compromiso: los cupos son muy limitados y cada lugar que queda vacío es un lugar que otra persona no pudo ocupar. Al inscribirte, te comprometés a asistir en el turno asignado.</p>' +
    '<p>Si por algún motivo no podés asistir, anulá tu inscripción desde <a href="' + escapeHtml_(urlApp) + '" style="color:' + COLOR_AZUL + ';">' + escapeHtml_(urlApp) + '</a> para liberar el cupo.</p>' +
    '<p style="color:' + COLOR_DORADO + ';font-weight:bold;">14 y 15 de octubre de 2026 · Centro Cultural de la Ciencia · Auditorio</p>' +
    '<p style="color:#777;font-size:13px;">Comité Organizador – 1era Jornada Nacional de Donación y Trasplante INCUCAI</p>' +
    '</div>';
  return { asunto: asunto, cuerpo: cuerpo };
}

function armarMailAnulacion_(nombre, anulado, mis) {
  var asunto = 'Confirmamos la anulación de tu inscripción – Talleres 1era Jornada Nacional de Donación y Trasplante';
  var restoHtml = mis.length > 0
    ? '<p>Seguís con estas inscripciones activas:</p>' + tablaHtmlTurnos_(mis)
    : '<p>No tenés inscripciones activas.</p>';
  var cuerpo =
    '<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">' +
    '<h2 style="color:' + COLOR_AZUL + ';">Hola ' + escapeHtml_(nombre) + ':</h2>' +
    '<p>Confirmamos que anulamos tu inscripción a <strong>' + escapeHtml_(anulado.taller) + '</strong> (' + fechaLarga_(anulado.fecha) + ', ' + escapeHtml_(anulado.horario) + ').</p>' +
    restoHtml +
    '<p style="color:#777;font-size:13px;">Comité Organizador – 1era Jornada Nacional de Donación y Trasplante INCUCAI</p>' +
    '</div>';
  return { asunto: asunto, cuerpo: cuerpo };
}

/** Comparte el mismo remitente/reply-to (Config) entre el envío directo
 * (enviarOEncolar_) y el reintento posterior desde la cola (procesarCola)
 * -- antes procesarCola mandaba sin nombre de remitente ni reply-to. */
function opcionesMail_(cuerpoHtml, config) {
  var opciones = { htmlBody: cuerpoHtml, name: config.nombre_remitente || undefined };
  if (config.reply_to) opciones.replyTo = config.reply_to;
  return opciones;
}

function enviarOEncolar_(email, asunto, cuerpoHtml, config) {
  var cuotaOk = MailApp.getRemainingDailyQuota() >= 5;
  if (cuotaOk) {
    try {
      MailApp.sendEmail(email, asunto, cuerpoHtml.replace(/<[^>]+>/g, ''), opcionesMail_(cuerpoHtml, config));
      return;
    } catch (e) {
      // sigue abajo y encola
    }
  }
  encolarMail_(email, asunto, cuerpoHtml);
}

function encolarMail_(email, asunto, cuerpoHtml) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_COLA_MAILS);
  sheet.appendRow([new Date(), email, asunto, cuerpoHtml, 'PENDIENTE', 0]);
}

function enviarMailInscripcion_(solicitud, mis, config) {
  var urlApp = config.url_app || '';
  var mail = armarMailInscripcion_(solicitud.nombre, mis, urlApp);
  enviarOEncolar_(solicitud.email, mail.asunto, mail.cuerpo, config);
}

function enviarMailAnulacion_(datos) {
  var mail = armarMailAnulacion_(datos.nombre, datos.anulado, datos.mis);
  enviarOEncolar_(datos.email, mail.asunto, mail.cuerpo, datos.config);
}

/** Envía los mails PENDIENTES de ColaMails mientras haya cuota (máx. 3 intentos c/u). */
function procesarCola() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_COLA_MAILS);
  var config = leerConfig_();
  var filas = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), COLA_MAILS_HEADERS.length).getValues();

  for (var i = 0; i < filas.length; i++) {
    if (MailApp.getRemainingDailyQuota() < 5) break;
    var fila = filas[i];
    var estado = fila[4];
    var intentos = Number(fila[5]) || 0;
    if (estado !== 'PENDIENTE' || intentos >= MAX_INTENTOS_MAIL) continue;

    var numeroFila = i + 2;
    try {
      MailApp.sendEmail(fila[1], fila[2], String(fila[3]).replace(/<[^>]+>/g, ''), opcionesMail_(fila[3], config));
      sheet.getRange(numeroFila, 5).setValue('ENVIADO');
    } catch (e) {
      sheet.getRange(numeroFila, 6).setValue(intentos + 1);
      if (intentos + 1 >= MAX_INTENTOS_MAIL) sheet.getRange(numeroFila, 5).setValue('ERROR');
    }
  }
}

/** Crea el trigger horario de procesarCola si todavía no existe (no lo duplica). */
function instalarTrigger() {
  var yaExiste = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'procesarCola';
  });
  if (!yaExiste) {
    ScriptApp.newTrigger('procesarCola').timeBased().everyHours(1).create();
  }
}

// ================== UTILIDAD DE PRUEBAS ==================

/** Borra (de verdad, es la única función que borra filas) las inscripciones de prueba (DNI que empieza con 99000). */
function limpiarPruebas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_INSCRIPCIONES);
  var filas = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), INSCRIPCIONES_HEADERS.length).getValues();
  // De abajo hacia arriba para que borrar no corra los índices de las que faltan.
  for (var i = filas.length - 1; i >= 0; i--) {
    var dni = String(filas[i][2]);
    if (dni.indexOf(PREFIJO_DNI_PRUEBA) === 0) {
      sheet.deleteRow(i + 2);
    }
  }
}

// ================== EXPORT PARA TESTS EN NODE ==================
// Apps Script ignora este bloque (no existe `module` en su runtime); Node lo usa
// para importar las funciones puras sin ninguna API de Google.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validar: validar,
    validarDatosGenerales: validarDatosGenerales,
    seSuperponen_: seSuperponen_,
    horaAMinutos_: horaAMinutos_,
    fechaCorta_: fechaCorta_,
    resolverTurnoDeInscripcion_: resolverTurnoDeInscripcion_,
    normalizarDni_: normalizarDni_,
    normalizarEmail_: normalizarEmail_
  };
}
