/* capa1-red.js — Capa 1: aritmética de direccionamiento IPv4.
 *
 * Objeto global `Red` con las funciones del contrato (§5 del BASE).
 * JavaScript vanilla, sin DOM, sin dependencias.
 *
 * Convenciones:
 * - Se trabaja con enteros de 32 bits sin signo. Los operadores bit a bit
 *   de JavaScript devuelven enteros con signo, así que todo resultado se
 *   normaliza con `>>> 0`.
 * - Ninguna función lanza excepciones por entrada inválida: las que devuelven
 *   texto, número u objeto devuelven `null`; las que devuelven boolean
 *   devuelven `false`; `clasificar` devuelve "invalida".
 * - El prefijo CIDR es la fuente de verdad: la máscara decimal se deriva de él.
 * - El separador del rango es " – " (raya corta con espacios).
 */

var Red = (function () {
  "use strict";

  // Indica si el prefijo es un entero entre 0 y 32.
  function esPrefijoValido(prefijo) {
    return typeof prefijo === "number" && Number.isInteger(prefijo) && prefijo >= 0 && prefijo <= 32;
  }

  // Convierte un prefijo en su máscara como entero sin signo.
  function prefijoANumero(prefijo) {
    if (!esPrefijoValido(prefijo)) {
      return null;
    }
    if (prefijo === 0) {
      return 0;
    }
    // El desplazamiento deja signo, por eso se normaliza con >>> 0.
    return (0xffffffff << (32 - prefijo)) >>> 0;
  }

  // Parte un texto en sus cuatro octetos numéricos, o null si no es IPv4 válida.
  function octetosDe(texto) {
    if (typeof texto !== "string") {
      return null;
    }
    var recortado = texto.trim();
    var partes = recortado.split(".");
    if (partes.length !== 4) {
      return null;
    }
    var octetos = [];
    for (var i = 0; i < 4; i++) {
      var parte = partes[i];
      if (!/^\d{1,3}$/.test(parte)) {
        return null;
      }
      var valor = parseInt(parte, 10);
      if (valor < 0 || valor > 255) {
        return null;
      }
      octetos.push(valor);
    }
    return octetos;
  }

  function esIpValida(texto) {
    return octetosDe(texto) !== null;
  }

  function aNumero(ip) {
    var octetos = octetosDe(ip);
    if (octetos === null) {
      return null;
    }
    // Multiplicación en lugar de desplazamientos para no tocar el signo.
    return ((((octetos[0] * 256 + octetos[1]) * 256 + octetos[2]) * 256 + octetos[3]) >>> 0);
  }

  function aTexto(numero) {
    if (typeof numero !== "number" || !Number.isInteger(numero) || numero < 0 || numero > 4294967295) {
      return null;
    }
    var n = numero >>> 0;
    var o1 = (n >>> 24) & 255;
    var o2 = (n >>> 16) & 255;
    var o3 = (n >>> 8) & 255;
    var o4 = n & 255;
    return o1 + "." + o2 + "." + o3 + "." + o4;
  }

  // Pasa un octeto (0-255) a 8 caracteres binarios con ceros a la izquierda.
  function octetoABinario(valor) {
    var binario = valor.toString(2);
    while (binario.length < 8) {
      binario = "0" + binario;
    }
    return binario;
  }

  function aBinario(ip) {
    var octetos = octetosDe(ip);
    if (octetos === null) {
      return null;
    }
    return octetoABinario(octetos[0]) + "." + octetoABinario(octetos[1]) + "." + octetoABinario(octetos[2]) + "." + octetoABinario(octetos[3]);
  }

  function prefijoAMascara(prefijo) {
    var mascaraNum = prefijoANumero(prefijo);
    if (mascaraNum === null) {
      return null;
    }
    return aTexto(mascaraNum);
  }

  function esMascaraValida(mascara) {
    var octetos = octetosDe(mascara);
    if (octetos === null) {
      return false;
    }
    var n = aNumero(mascara) >>> 0;
    // Una máscara válida son unos contiguos seguidos de ceros. El complemento
    // (la parte de host) tiene que ser de la forma 2^k - 1 (todo unos abajo).
    var parteHost = (~n) >>> 0;
    return (parteHost & (parteHost + 1)) === 0;
  }

  function mascaraAPrefijo(mascara) {
    if (!esMascaraValida(mascara)) {
      return null;
    }
    var n = aNumero(mascara) >>> 0;
    // Cuenta los unos. Como la máscara ya se validó, alcanza con contar.
    var unos = 0;
    var resto = n;
    while (resto !== 0) {
      unos += resto & 1;
      resto = resto >>> 1;
    }
    return unos;
  }

  function tamanoBloque(prefijo) {
    if (!esPrefijoValido(prefijo)) {
      return null;
    }
    return Math.pow(2, 32 - prefijo);
  }

  function direccionDeRed(ip, prefijo) {
    var ipNum = aNumero(ip);
    var mascaraNum = prefijoANumero(prefijo);
    if (ipNum === null || mascaraNum === null) {
      return null;
    }
    var redNum = (ipNum & mascaraNum) >>> 0;
    return aTexto(redNum);
  }

  function broadcast(ip, prefijo) {
    var ipNum = aNumero(ip);
    var mascaraNum = prefijoANumero(prefijo);
    if (ipNum === null || mascaraNum === null) {
      return null;
    }
    var redNum = (ipNum & mascaraNum) >>> 0;
    var broadcastNum = (redNum | ((~mascaraNum) >>> 0)) >>> 0;
    return aTexto(broadcastNum);
  }

  function primerHost(ip, prefijo) {
    // En /31 y /32 no hay direcciones de host utilizables.
    if (!esPrefijoValido(prefijo) || prefijo >= 31) {
      return null;
    }
    var redTexto = direccionDeRed(ip, prefijo);
    if (redTexto === null) {
      return null;
    }
    return aTexto(aNumero(redTexto) + 1);
  }

  function ultimoHost(ip, prefijo) {
    if (!esPrefijoValido(prefijo) || prefijo >= 31) {
      return null;
    }
    var broadcastTexto = broadcast(ip, prefijo);
    if (broadcastTexto === null) {
      return null;
    }
    return aTexto(aNumero(broadcastTexto) - 1);
  }

  function cantidadHosts(prefijo) {
    if (!esPrefijoValido(prefijo)) {
      return null;
    }
    if (prefijo >= 31) {
      return 0;
    }
    return Math.pow(2, 32 - prefijo) - 2;
  }

  function rangoTexto(ip, prefijo) {
    var primero = primerHost(ip, prefijo);
    var ultimo = ultimoHost(ip, prefijo);
    if (primero === null || ultimo === null) {
      return null;
    }
    return primero + " – " + ultimo;
  }

  function mismaRed(ipA, ipB, prefijo) {
    var redA = direccionDeRed(ipA, prefijo);
    var redB = direccionDeRed(ipB, prefijo);
    if (redA === null || redB === null) {
      return false;
    }
    return redA === redB;
  }

  function esDireccionDeRed(ip, prefijo) {
    var redTexto = direccionDeRed(ip, prefijo);
    if (redTexto === null || aNumero(ip) === null) {
      return false;
    }
    return aNumero(ip) === aNumero(redTexto);
  }

  function esBroadcast(ip, prefijo) {
    var broadcastTexto = broadcast(ip, prefijo);
    if (broadcastTexto === null || aNumero(ip) === null) {
      return false;
    }
    return aNumero(ip) === aNumero(broadcastTexto);
  }

  function esAsignable(ip, prefijo) {
    if (aNumero(ip) === null || !esPrefijoValido(prefijo)) {
      return false;
    }
    if (prefijo >= 31) {
      return false;
    }
    return !esDireccionDeRed(ip, prefijo) && !esBroadcast(ip, prefijo);
  }

  function estaAlineada(red, prefijo) {
    var redNum = aNumero(red);
    var bloque = tamanoBloque(prefijo);
    if (redNum === null || bloque === null) {
      return false;
    }
    return redNum % bloque === 0;
  }

  function solapan(redA, prefA, redB, prefB) {
    var redATexto = direccionDeRed(redA, prefA);
    var bcastATexto = broadcast(redA, prefA);
    var redBTexto = direccionDeRed(redB, prefB);
    var bcastBTexto = broadcast(redB, prefB);
    if (redATexto === null || bcastATexto === null || redBTexto === null || bcastBTexto === null) {
      return false;
    }
    var inicioA = aNumero(redATexto);
    var finA = aNumero(bcastATexto);
    var inicioB = aNumero(redBTexto);
    var finB = aNumero(bcastBTexto);
    return inicioA <= finB && inicioB <= finA;
  }

  // El orden importa: 255.255.255.255 también cae dentro de 240.0.0.0/4.
  function clasificar(ip) {
    var n = aNumero(ip);
    if (n === null) {
      return "invalida";
    }
    var num = n >>> 0;
    var o1 = (num >>> 24) & 255;
    var o2 = (num >>> 16) & 255;
    if (num === 0xFFFFFFFF) {
      return "broadcast-limitado";
    }
    if (o1 === 0) {
      return "esta-red";
    }
    if (o1 === 127) {
      return "loopback";
    }
    if (o1 === 169 && o2 === 254) {
      return "apipa";
    }
    if (o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168)) {
      return "privada";
    }
    if (o1 === 100 && o2 >= 64 && o2 <= 127) {
      return "cgnat";
    }
    if (o1 >= 224 && o1 <= 239) {
      return "multicast";
    }
    if (o1 >= 240) {
      return "reservada";
    }
    return "publica";
  }

  // Clase histórica (sistema de clases, anterior a CIDR) según el primer
  // octeto. Sólo A, B y C tenían un prefijo fijo; D es multicast y E quedó
  // reservada.
  var CLASES = [
    { letra: "A", desde: 0, hasta: 127, prefijoClasico: 8 },
    { letra: "B", desde: 128, hasta: 191, prefijoClasico: 16 },
    { letra: "C", desde: 192, hasta: 223, prefijoClasico: 24 },
    { letra: "D", desde: 224, hasta: 239, prefijoClasico: null },
    { letra: "E", desde: 240, hasta: 255, prefijoClasico: null }
  ];

  function clase(ip) {
    if (!esIpValida(ip)) {
      return null;
    }
    var o1 = parseInt(String(ip).trim().split(".")[0], 10);
    for (var i = 0; i < CLASES.length; i++) {
      var c = CLASES[i];
      if (o1 >= c.desde && o1 <= c.hasta) {
        return { letra: c.letra, prefijoClasico: c.prefijoClasico, rango: c.desde + ".0.0.0 – " + c.hasta + ".255.255.255" };
      }
    }
    return null;
  }

  // Muestra el AND entre la IP y su máscara, con el detalle binario.
  function and(ip, prefijo) {
    var ipNum = aNumero(ip);
    var mascaraNum = prefijoANumero(prefijo);
    if (ipNum === null || mascaraNum === null) {
      return null;
    }
    var resultadoNum = (ipNum & mascaraNum) >>> 0;
    var resultado = aTexto(resultadoNum);
    var mascaraTexto = aTexto(mascaraNum);
    return {
      resultado: resultado,
      binarioIp: aBinario(ip),
      binarioMascara: aBinario(mascaraTexto),
      binarioResultado: aBinario(resultado)
    };
  }

  // Calcula la posición del corte red/host dentro de la cadena binaria
  // con puntos (por ejemplo /27 corta en el índice 30).
  function corteEnBinario(prefijo) {
    var puntosAntes = 0;
    if (prefijo > 8) {
      puntosAntes += 1;
    }
    if (prefijo > 16) {
      puntosAntes += 1;
    }
    if (prefijo > 24) {
      puntosAntes += 1;
    }
    return prefijo + puntosAntes;
  }

  function desglose(ip, prefijo, gateway) {
    var ipNum = aNumero(ip);
    if (ipNum === null || !esPrefijoValido(prefijo)) {
      return null;
    }
    var mascaraNum = prefijoANumero(prefijo);
    var mascaraDecimal = aTexto(mascaraNum);
    var redTexto = direccionDeRed(ip, prefijo);
    var broadcastTexto = broadcast(ip, prefijo);
    var primero = primerHost(ip, prefijo);
    var ultimo = ultimoHost(ip, prefijo);
    var rango = rangoTexto(ip, prefijo);

    var advertencia = null;
    if (esDireccionDeRed(ip, prefijo)) {
      advertencia = "Esta IP es la dirección de red de su subred";
    } else if (esBroadcast(ip, prefijo)) {
      advertencia = "Esta IP es la dirección de broadcast de su subred";
    }

    var gatewayInfo = null;
    if (gateway !== undefined && gateway !== null && String(gateway).trim() !== "") {
      var gatewayTexto = String(gateway).trim();
      var andIp = direccionDeRed(ip, prefijo);
      var andGateway = direccionDeRed(gatewayTexto, prefijo);
      var coinciden = andIp !== null && andGateway !== null && andIp === andGateway;
      gatewayInfo = {
        ip: gatewayTexto,
        andIp: andIp,
        andGateway: andGateway,
        coinciden: coinciden,
        veredicto: coinciden ? "Las dos dan la misma red: tu puerta de enlace está en tu red." : "Dan redes distintas: tu puerta de enlace está fuera de tu red."
      };
    }

    return {
      ip: ip.trim(),
      prefijo: prefijo,
      mascaraDecimal: mascaraDecimal,
      ipBinario: aBinario(ip),
      mascaraBinaria: aBinario(mascaraDecimal),
      bitsRed: prefijo,
      bitsHost: 32 - prefijo,
      cortePosicion: corteEnBinario(prefijo),
      direccionDeRed: redTexto,
      broadcast: broadcastTexto,
      primerHost: primero,
      ultimoHost: ultimo,
      rangoTexto: rango,
      cantidadHosts: cantidadHosts(prefijo),
      ipEsAsignable: esAsignable(ip, prefijo),
      advertencia: advertencia,
      gateway: gatewayInfo
    };
  }

  function autopruebas() {
    var total = 0;
    var pasadas = 0;
    var fallos = [];

    function comparar(nombre, obtenido, esperado) {
      total += 1;
      var textoObtenido = JSON.stringify(obtenido);
      var textoEsperado = JSON.stringify(esperado);
      if (textoObtenido === textoEsperado) {
        pasadas += 1;
      } else {
        fallos.push({ nombre: nombre, esperado: esperado, obtenido: obtenido });
      }
    }

    // Casos obligatorios del documento de la capa 1.
    comparar("red corta en tercer octeto /20", direccionDeRed("172.16.34.9", 20), "172.16.32.0");
    comparar("broadcast /20", broadcast("172.16.34.9", 20), "172.16.47.255");
    comparar("hosts /20", cantidadHosts(20), 4094);
    comparar("broadcast /16", broadcast("10.0.5.77", 16), "10.0.255.255");
    comparar("hosts /8 sin desborde de signo", cantidadHosts(8), 16777214);
    comparar("red /27", direccionDeRed("200.45.12.201", 27), "200.45.12.192");
    comparar("broadcast /27", broadcast("200.45.12.201", 27), "200.45.12.223");
    comparar("mascara 255.255.255.100 invalida", esMascaraValida("255.255.255.100"), false);
    comparar("mascara 255.255.255.252 valida", esMascaraValida("255.255.255.252"), true);
    comparar("mascara a prefijo 21", mascaraAPrefijo("255.255.248.0"), 21);
    comparar("broadcast no asignable", esAsignable("172.16.5.95", 27), false);
    comparar("host /30 asignable", esAsignable("10.0.0.5", 30), true);
    comparar("distinta red con /26", mismaRed("192.168.1.50", "192.168.1.200", 26), false);
    comparar("misma red con /25", mismaRed("192.168.5.130", "192.168.5.129", 25), true);
    comparar("132 no alineada en /28", estaAlineada("10.45.7.132", 28), false);
    comparar("144 alineada en /28", estaAlineada("10.45.7.144", 28), true);
    comparar("132 alineada en /30", estaAlineada("10.45.7.132", 30), true);
    comparar("subredes que se solapan", solapan("10.45.7.0", 26, "10.45.7.50", 27), true);
    comparar("subredes que no se solapan", solapan("10.45.7.64", 27, "10.45.7.96", 28), false);
    comparar("172.15 es publica", clasificar("172.15.3.1"), "publica");
    comparar("172.20 es privada", clasificar("172.20.8.4"), "privada");
    comparar("apipa", clasificar("169.254.10.3"), "apipa");
    comparar("hosts /31", cantidadHosts(31), 0);
    comparar("primer host /31", primerHost("10.0.0.0", 31), null);
    comparar("binario con ceros a la izquierda", aBinario("10.0.45.200"), "00001010.00000000.00101101.11001000");

    // Cobertura del resto de las funciones.
    comparar("prefijo a mascara /27", prefijoAMascara(27), "255.255.255.224");
    comparar("mascara a prefijo /24", mascaraAPrefijo("255.255.255.0"), 24);
    comparar("ip a numero", aNumero("192.168.10.10"), 3232238090);
    comparar("numero a texto", aTexto(3232238090), "192.168.10.10");
    comparar("tamano de bloque /27", tamanoBloque(27), 32);
    comparar("rango administracion /27", rangoTexto("10.45.7.66", 27), "10.45.7.65 – 10.45.7.94");
    comparar("ip invalida 300", esIpValida("300.1.1.1"), false);
    comparar("loopback", clasificar("127.0.0.1"), "loopback");
    comparar("publica", clasificar("8.8.8.8"), "publica");
    comparar("mascara 0.0.0.0 valida", esMascaraValida("0.0.0.0"), true);
    comparar("hosts /24", cantidadHosts(24), 254);
    comparar("and de red", and("192.168.10.10", 24).resultado, "192.168.10.0");
    comparar("es direccion de red", esDireccionDeRed("10.45.7.64", 27), true);
    comparar("es broadcast", esBroadcast("10.45.7.95", 27), true);

    // Desglose con un prefijo que corta dentro del octeto (/27).
    var detalle = desglose("192.168.10.10", 27, "192.168.10.1");
    comparar("desglose red /27", detalle.direccionDeRed, "192.168.10.0");
    comparar("desglose broadcast /27", detalle.broadcast, "192.168.10.31");
    comparar("desglose corte dentro del octeto", detalle.cortePosicion, 30);
    comparar("desglose mascara binaria", detalle.mascaraBinaria, "11111111.11111111.11111111.11100000");
    comparar("desglose gateway coincide", detalle.gateway.coinciden, true);
    comparar("desglose veredicto gateway", detalle.gateway.veredicto, "Las dos dan la misma red: tu puerta de enlace está en tu red.");
    var detalleAjeno = desglose("192.168.10.10", 27, "192.168.10.200");
    comparar("desglose gateway ajeno", detalleAjeno.gateway.veredicto, "Dan redes distintas: tu puerta de enlace está fuera de tu red.");
    var detalleRed = desglose("10.45.7.64", 27, null);
    comparar("desglose advierte direccion de red", detalleRed.advertencia, "Esta IP es la dirección de red de su subred");

    // Rangos especiales: nada que no se reconozca se llama "pública" por descarte.
    comparar("clasifica broadcast limitado", clasificar("255.255.255.255"), "broadcast-limitado");
    comparar("clasifica esta red", clasificar("0.0.0.0"), "esta-red");
    comparar("clasifica multicast bajo", clasificar("224.0.0.1"), "multicast");
    comparar("clasifica multicast alto", clasificar("239.255.255.250"), "multicast");
    comparar("clasifica reservada", clasificar("240.0.0.1"), "reservada");
    comparar("clasifica cgnat", clasificar("100.64.0.1"), "cgnat");
    comparar("clasifica justo antes de cgnat", clasificar("100.63.255.255"), "publica");
    comparar("clasifica 172.32 pública", clasificar("172.32.0.1"), "publica");
    comparar("clasifica pública", clasificar("8.8.8.8"), "publica");
    comparar("ultimo host /32", ultimoHost("10.0.0.0", 32), null);

    // Clases históricas.
    comparar("clase A privada", clase("10.45.7.1"), { letra: "A", prefijoClasico: 8, rango: "0.0.0.0 – 127.255.255.255" });
    comparar("clase B", [clase("172.16.0.1").letra, clase("172.16.0.1").prefijoClasico], ["B", 16]);
    comparar("clase C", [clase("192.168.1.1").letra, clase("192.168.1.1").prefijoClasico], ["C", 24]);
    comparar("clase D sin prefijo", [clase("224.0.0.5").letra, clase("224.0.0.5").prefijoClasico], ["D", null]);
    comparar("clase E sin prefijo", [clase("240.0.0.1").letra, clase("240.0.0.1").prefijoClasico], ["E", null]);
    comparar("clase de ip inválida", clase("300.1.1.1"), null);

    return { total: total, pasadas: pasadas, fallos: fallos };
  }

  return {
    esIpValida: esIpValida,
    aNumero: aNumero,
    aTexto: aTexto,
    aBinario: aBinario,
    prefijoAMascara: prefijoAMascara,
    mascaraAPrefijo: mascaraAPrefijo,
    esMascaraValida: esMascaraValida,
    tamanoBloque: tamanoBloque,
    direccionDeRed: direccionDeRed,
    broadcast: broadcast,
    primerHost: primerHost,
    ultimoHost: ultimoHost,
    cantidadHosts: cantidadHosts,
    rangoTexto: rangoTexto,
    mismaRed: mismaRed,
    esDireccionDeRed: esDireccionDeRed,
    esBroadcast: esBroadcast,
    esAsignable: esAsignable,
    estaAlineada: estaAlineada,
    solapan: solapan,
    clasificar: clasificar,
    clase: clase,
    and: and,
    desglose: desglose,
    autopruebas: autopruebas
  };
})();
