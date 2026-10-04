// Revisión del motor escenario por escenario: validación, pings, objetivos,
// desafío VLSM, DHCP y advertencias. Uso: node herramientas/pruebas/revisar.js [filtro]
// escenarios-docente/ se lee sólo si existe (no se publica con el repo).
var fs = require('fs');
var path = require('path');
var ctx = require('./correr.js');
var E = ctx.Escenarios, M = ctx.Motor, R = ctx.Red;
var RAIZ = path.resolve(__dirname, '..', '..');
var filtro = process.argv[2] || '';

var lista = E.EJEMPLOS.map(function (e) { return { id: 'EJ:' + e.id, topo: JSON.parse(JSON.stringify(e.topologia)) }; });
[path.join(RAIZ, 'escenarios'), path.join(RAIZ, 'escenarios-docente')].forEach(function (dir) {
  if (!fs.existsSync(dir)) { return; }
  fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).forEach(function (f) {
    var texto = fs.readFileSync(path.join(dir, f), 'utf8');
    var imp = E.importar(texto);
    lista.push({ id: 'JSON:' + f, topo: imp.ok ? imp.topologia : null, imp: imp, crudo: JSON.parse(texto) });
  });
});

function nom(t, id) { var d = t.dispositivos.find(function (x) { return x.id === id; }); return d ? (d.nombre || d.id) : id; }

lista.filter(function (x) { return x.id.indexOf(filtro) >= 0; }).forEach(function (x) {
  console.log('\n==================== ' + x.id + ' ====================');
  if (x.imp && !x.imp.ok) { console.log('  IMPORTAR FALLA:', JSON.stringify(x.imp.errores)); return; }
  var t = x.topo;
  var esc = t.escenario || {};
  console.log('  nombre:', t.nombre, '| modo:', esc.modo || '-', '| equipos:', t.dispositivos.length, '| enlaces:', (t.enlaces || []).length,
    '| objetivos:', (esc.objetivos || []).length, '| fallas:', (esc.fallas || []).length, '| sectores:', (esc.sectores || esc.requerimientos || []).length);
  var val = E.validarTopologia(t);
  if (!val.ok || (val.errores || []).length) { console.log('  VALIDACION:', JSON.stringify(val.errores)); }
  var est = M.crearEstado(t);

  // Advertencias por equipo.
  t.dispositivos.forEach(function (d) {
    var av = M.advertenciasDe(est, d.id);
    if (av.length) { console.log('  advertencias ' + nom(t, d.id) + ':', av.map(function (a) { return a.codigo + ' ' + a.titulo; }).join(' | ')); }
  });

  // Matriz de pings entre hosts con IP (orígenes: equipos no conmutadores).
  var hosts = t.dispositivos.filter(function (d) { return ['switch-l2', 'ap'].indexOf(d.tipo) < 0; });
  var destinos = [];
  t.dispositivos.forEach(function (d) { d.interfaces.forEach(function (f) { if (f.ip && R.esIpValida(f.ip)) { destinos.push({ ip: f.ip, dev: d.id }); } }); });
  var resumen = { ok: 0, fallas: {} };
  var excepciones = [];
  hosts.forEach(function (o) {
    if (!o.interfaces.some(function (f) { return f.ip; })) { return; }
    destinos.forEach(function (dst) {
      if (dst.dev === o.id) { return; }
      try {
        var r = M.ping(M.crearEstado(t), o.id, dst.ip);
        if (r.exito) { resumen.ok++; }
        else {
          var c = r.diagnostico ? r.diagnostico.codigo : 'SIN-DIAG';
          (resumen.fallas[c] = resumen.fallas[c] || []).push(nom(t, o.id) + '→' + nom(t, dst.dev) + '(' + dst.ip + ')');
          if (!r.diagnostico || !r.diagnostico.explicacion) { excepciones.push('sin explicación: ' + nom(t, o.id) + '→' + dst.ip + ' ' + c); }
        }
      } catch (e) { excepciones.push('EXCEPCION ping ' + o.id + '→' + dst.ip + ': ' + e.message); }
    });
  });
  console.log('  pings ok:', resumen.ok);
  Object.keys(resumen.fallas).forEach(function (c) {
    var l = resumen.fallas[c];
    console.log('  pings ' + c + ' (' + l.length + '):', l.slice(0, 6).join(', ') + (l.length > 6 ? ' …' : ''));
  });
  // Pings por nombre (DNS) desde el primer host con IP.
  var h0 = hosts.find(function (d) { return d.tipo !== 'router' && d.tipo !== 'internet' && d.interfaces.some(function (f) { return f.ip; }); });
  if (h0 && t.dispositivos.some(function (d) { return d.tipo === 'internet'; })) {
    try { var rn = M.ping(M.crearEstado(t), h0.id, 'google.com'); console.log('  ping google.com desde', nom(t, h0.id) + ':', rn.exito ? 'ok' : (rn.diagnostico && rn.diagnostico.codigo)); }
    catch (e) { excepciones.push('EXCEPCION ping nombre: ' + e.message); }
  }
  excepciones.forEach(function (e) { console.log('  !!', e); });

  // Objetivos.
  if ((esc.objetivos || []).length) {
    var ob = E.verificarObjetivos(M.crearEstado(t), esc.objetivos);
    console.log('  objetivos:', ob.map(function (o) { return (o.cumple ? 'OK ' : 'NO ') + nom(t, o.objetivo.origen) + '→' + o.objetivo.destino + (o.codigo ? ' ' + o.codigo : ''); }).join(' | '));
    if ((esc.fallas || []).length) {
      var rota = E.aplicarFallas(t);
      var ob2 = E.verificarObjetivos(M.crearEstado(rota), esc.objetivos);
      console.log('  objetivos con fallas aplicadas:', ob2.map(function (o) { return (o.cumple ? 'OK ' : 'NO ') + nom(t, o.objetivo.origen) + '→' + o.objetivo.destino + (o.codigo ? ' ' + o.codigo : ''); }).join(' | '));
    }
  }
  // Desafío.
  if (esc.modo === 'desafio' || esc.sectores || esc.requerimientos) {
    try {
      var inf = E.verificarDesafio(t, esc);
      console.log('  desafío: errores', inf.resumen.errores, 'advertencias', inf.resumen.advertencias);
      inf.porSector.forEach(function (s) { console.log('    ' + (s.ok ? 'ok ' : 'MAL ') + s.sector + ': ' + s.hallazgos.map(function (h) { return h.nivel + ' ' + h.mensaje; }).join(' / ').slice(0, 220)); });
    } catch (e) { console.log('  !! EXCEPCION desafío:', e.message); }
  }
  // DHCP.
  t.dispositivos.filter(function (d) { return d.dhcp && d.dhcp.habilitado; }).forEach(function (d) {
    console.log('  servidor DHCP', nom(t, d.id), JSON.stringify(d.dhcp), 'avisos:', JSON.stringify(M.avisosDhcp(est, d.id)));
  });
  t.dispositivos.forEach(function (d) {
    d.interfaces.forEach(function (f) {
      if (f.modo === 'dhcp') {
        var r = M.dhcpSolicitar(M.crearEstado(t), d.id, f.id);
        console.log('  DHCP', nom(t, d.id), f.id, '->', r.exito ? r.ip + '/' + r.prefijo + ' gw ' + r.gateway : (r.diagnostico && r.diagnostico.codigo + ' ' + r.diagnostico.explicacion), (r.avisos || []).join(' | '));
      }
    });
  });
  // Ida y vuelta de exportar/importar.
  // Desde el versionado (SRE-1033) el archivo exportado anota el generador: no cuenta como diferencia.
  var reimp = E.importar(E.exportar(t));
  var sinGen = function (o) { var c = JSON.parse(JSON.stringify(o)); delete c.generador; return JSON.stringify(c); };
  if (!reimp.ok || sinGen(reimp.topologia) !== sinGen(t)) { console.log('  !! exportar/importar no reproduce la topología'); }
});
