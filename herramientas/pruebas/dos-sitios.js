// Caso del bug SRE-1030: dos sitios unidos por internet. La última línea, con el
// sitio B desconectado, tiene que dar Conectar en false (D33).
// Uso: node herramientas/pruebas/dos-sitios.js
var c = require('./correr.js'); var E = c.Escenarios, M = c.Motor;
function I(id, medio, ip, pref, extra) { var f = { id: id, medio: medio || 'ethernet', ip: ip, prefijo: pref || 24, habilitada: true, mac: null }; for (var k in extra || {}) f[k] = extra[k]; return f; }
function D(id, tipo, ifs, gw, rutas, extra) { var d = { id: id, tipo: tipo, nombre: id, x: 0, y: 0, encendido: true, interfaces: ifs, gateway: gw || null, dns: null, rutas: rutas || [], dhcp: null }; for (var k in extra || {}) d[k] = extra[k]; return d; }
function L(id, a, ai, b, bi) { return { id: id, a: { dispositivo: a, interfaz: ai }, b: { dispositivo: b, interfaz: bi }, tipo: 'ethernet', estado: 'up' }; }
// Sitio A: PC privada + router con NAT -> nube1. Sitio B: servidor web con IP pública detrás de router -> nube2.
function topo(unaNube) {
  var ds = [
    D('pc', 'pc', [I('eth0', 'ethernet', '192.168.1.10')], '192.168.1.1'),
    D('ra', 'router', [I('g0/0', 'ethernet', '192.168.1.1'), I('g0/1', 'ethernet', '200.1.1.2', 30, { nat: true })], null, [{ destino: '0.0.0.0', prefijo: 0, siguienteSalto: '200.1.1.1' }]),
    D('nube1', 'internet', [I('eth0', 'ethernet', '200.1.1.1', 30)]),
    D('web', 'servidor', [I('eth0', 'ethernet', '201.2.2.10')], '201.2.2.1', [], { servicios: { escuchando: [{ protocolo: 'tcp', puerto: 80, nombre: 'HTTP' }] } }),
    D('rb', 'router', [I('g0/0', 'ethernet', '201.2.2.1'), I('g0/1', 'ethernet', '200.9.9.2', 30)], null, [{ destino: '0.0.0.0', prefijo: 0, siguienteSalto: '200.9.9.1' }]),
    D('nube2', 'internet', [I('eth0', 'ethernet', '200.9.9.1', 30)])
  ];
  var ls = [L('l1', 'pc', 'eth0', 'ra', 'g0/0'), L('l2', 'ra', 'g0/1', 'nube1', 'eth0'), L('l3', 'web', 'eth0', 'rb', 'g0/0'), L('l4', 'rb', 'g0/1', 'nube2', 'eth0')];
  return { version: 1, nombre: 'dos sitios', dispositivos: ds, enlaces: ls, escenario: null };
}
var t = topo();
var v = E.validarTopologia(t); console.log('valida', v.ok, JSON.stringify(v.errores.map(function (e) { return e.mensaje; })));
var st = M.crearEstado(t);
var p = M.ping(st, 'pc', '201.2.2.10');
console.log('ping pc->web', p.exito, p.diagnostico && p.diagnostico.codigo, (p.pasos || []).map(function (x) { return x.titulo; }).slice(-4).join(' | '));
console.log(' tramas ida llegan a:', (p.tramas || []).filter(function (x) { return x.sentido === 'ida'; }).map(function (x) { return x.a.dispositivo; }).join(','));
var cn = M.conectar(st, 'pc', '201.2.2.10', 'tcp', 80);
console.log('conectar pc->web:80', cn.exito, cn.diagnostico && cn.diagnostico.codigo);
var cn2 = M.conectar(st, 'pc', '201.2.2.10', 'tcp', 22);
console.log('conectar pc->web:22 (no escucha)', cn2.exito, cn2.diagnostico && cn2.diagnostico.codigo);
console.log('--- conectar 80 tramas:', (cn.tramas || []).map(function (x) { return x.de.dispositivo + '>' + x.a.dispositivo; }).join(' '));
console.log('pasos:', (cn.pasos || []).map(function (x) { return x.titulo; }).join(' | '));
console.log('pasos 22:', (cn2.pasos || []).map(function (x) { return x.titulo; }).slice(-3).join(' | '));
var w = M.conectar(st, 'pc', '201.2.2.99', 'tcp', 80); console.log('ip publica inexistente :80', w.exito, w.diagnostico && w.diagnostico.codigo);
var roto = topo(); roto.enlaces.forEach(function (e) { if (e.id === 'l3' || e.id === 'l4') e.estado = 'down'; });
var str = M.crearEstado(roto);
var r1 = M.conectar(str, 'pc', '201.2.2.10', 'tcp', 80); var r2 = M.ping(str, 'pc', '201.2.2.10');
console.log('SITIO B DESCONECTADO -> conectar:', r1.exito, r1.diagnostico && r1.diagnostico.codigo, '| ping:', r2.exito);
