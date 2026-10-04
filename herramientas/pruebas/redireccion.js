// Caso de SRE-1021: servidor privado en la oficina, publicado con una
// redirección en el router de borde. Uso: node herramientas/pruebas/redireccion.js
var c = require('./correr.js'); var E = c.Escenarios, M = c.Motor;
var t = JSON.parse(JSON.stringify(E.EJEMPLOS.filter(function (e) { return e.id === 'dos-sitios'; })[0].topologia));
t.dispositivos.forEach(function (d) {
  if (d.id === 'srv-web') { d.interfaces[0].ip = '192.168.50.10'; d.gateway = '192.168.50.1'; }
  if (d.id === 'r-oficina') { d.interfaces[0].ip = '192.168.50.1'; d.interfaces[1].nat = true;
    d.redirecciones = [{ protocolo: 'tcp', puerto: 8080, ipInterna: '192.168.50.10', puertoInterno: 80 }]; }
});
function linea(r) { return r.exito + ' ' + (r.diagnostico ? r.diagnostico.codigo : ''); }
var cn = M.conectar(M.crearEstado(t), 'pc-casa', '200.51.3.2', 'tcp', 8080);
console.log('conectar 200.51.3.2:8080 ->', linea(cn), JSON.stringify(cn.socket));
console.log(' pasos:', cn.pasos.map(function (x) { return x.titulo; }).join(' | '));
var syn = cn.tramas.filter(function (x) { return x.flags === 'SYN' || x.flags === 'SYN-ACK'; });
syn.forEach(function (x) { console.log('  ', x.sentido, x.de.dispositivo + '>' + x.a.dispositivo, x.ipOrigen + ':' + x.puertoOrigen, '->', x.ipDestino + ':' + x.puertoDestino, x.flags); });
var ida = M.ping(M.crearEstado(t), 'pc-casa', '200.51.3.2'); console.log('ping a la IP pública (ICMP):', linea(ida), ida.respondio);
console.log('conectar :80 (sin redirección):', linea(M.conectar(M.crearEstado(t), 'pc-casa', '200.51.3.2', 'tcp', 80)));
console.log('conectar :8080 UDP:', linea(M.conectar(M.crearEstado(t), 'pc-casa', '200.51.3.2', 'udp', 8080)));
var sinSrv = JSON.parse(JSON.stringify(t)); sinSrv.dispositivos.forEach(function (d) { if (d.id === 'srv-web') { d.servicios.escuchando = []; } });
console.log('servidor sin el 80:', linea(M.conectar(M.crearEstado(sinSrv), 'pc-casa', '200.51.3.2', 'tcp', 8080)), M.conectar(M.crearEstado(sinSrv), 'pc-casa', '200.51.3.2', 'tcp', 8080).diagnostico.explicacion.slice(0, 90));
var sinNatWan = JSON.parse(JSON.stringify(t)); sinNatWan.dispositivos.forEach(function (d) { if (d.id === 'r-oficina') { delete d.interfaces[1].nat; } });
console.log('sin NAT en el puerto (no aplica):', linea(M.conectar(M.crearEstado(sinNatWan), 'pc-casa', '200.51.3.2', 'tcp', 8080)));
var desdeLan = M.conectar(M.crearEstado(t), 'srv-web', '192.168.50.1', 'tcp', 8080); console.log('desde la LAN a la IP interna:', linea(desdeLan));
