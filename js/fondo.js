// Fondo arcade: campo de estrellas, formación de enemigos que se lanzan en picada y una nave que dispara.
// Easter egg: triple clic en el fondo (fuera del panel) lo convierte en un juego. Esc para salir.
(() => {
  const lienzo = document.getElementById('espacio');
  const ctx = lienzo.getContext('2d');
  const sprites = {
    manta: { color: '#c084fc', filas: ['X....X....X', 'XX..XXX..XX', 'XXXXXXXXXXX', '.XXX.X.XXX.', '..XXXXXXX..', '...X...X...'] },
    dron: { color: '#f472b6', filas: ['....XXX....', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', '..X.XXX.X..', '.X.......X.'] },
    nave: { color: '#a5f3fc', filas: ['.....X.....', '.....X.....', '....XXX....', '..X.XXX.X..', '.XXXXXXXXX.', 'XXX.XXX.XXX', 'X....X....X'] }
  };
  const nave = { x: 0, y: 0, destino: 0, destinoY: 0, recarga: 0, inmune: 0 };
  const teclas = {};
  let ancho, alto, px, estrellas, enemigos, disparos, balas, chispas, previo = 0, corriendo = true;
  let jugando = false, fuego = false, puntos = 0, vidas = 0, oleada = 0, aviso = 0, finDesde = 0;
  let record = 0;
  try { record = +localStorage.getItem('recordFondo') || 0; } catch {}

  function sprite(nombre, x, y, alfa = 1) {
    const { color, filas } = sprites[nombre];
    ctx.globalAlpha = alfa;
    ctx.fillStyle = color;
    filas.forEach((fila, j) => [...fila].forEach((c, i) => {
      if (c === 'X') ctx.fillRect(Math.round(x + (i - fila.length / 2) * px), Math.round(y + (j - filas.length / 2) * px), px, px);
    }));
    ctx.globalAlpha = 1;
  }

  function explotar(x, y, color, cantidad = 14) {
    for (let i = 0; i < cantidad; i++) {
      const angulo = Math.random() * Math.PI * 2, rapidez = .05 + Math.random() * .15;
      chispas.push({ x, y, vx: Math.cos(angulo) * rapidez, vy: Math.sin(angulo) * rapidez, vida: 1, color });
    }
  }

  function crearEnemigos() {
    const columnas = ancho < 640 ? 5 : 10;
    enemigos = [];
    for (let fila = 0; fila < 3; fila++) {
      for (let c = 0; c < columnas; c++) {
        enemigos.push({ tipo: fila ? 'manta' : 'dron', bx: (c - (columnas - 1) / 2) * px * 17, by: 60 + fila * px * 14, picada: 0, dx: 0, fuera: 0, alfa: jugando ? 0 : 1 });
      }
    }
  }

  function preparar() {
    const dpr = devicePixelRatio || 1;
    ancho = innerWidth;
    alto = innerHeight;
    lienzo.width = ancho * dpr;
    lienzo.height = alto * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    px = ancho < 640 ? 2 : 3;
    estrellas = Array.from({ length: Math.round(ancho * alto / 6000) }, () => ({
      x: Math.random() * ancho, y: Math.random() * alto, v: .2 + Math.random() * 1.3, fase: Math.random() * 6
    }));
    crearEnemigos();
    disparos = [];
    balas = [];
    chispas = [];
    nave.x = nave.destino = ancho / 2;
    nave.y = nave.destinoY = alto - 40;
  }

  function iniciar() {
    jugando = true;
    puntos = 0;
    vidas = 3;
    oleada = 1;
    aviso = 2000;
    finDesde = 0;
    document.activeElement?.blur();
    document.body.classList.add('jugando');
    preparar();
    if (!corriendo) {
      corriendo = true;
      requestAnimationFrame(cuadro);
    }
  }

  function salir() {
    jugando = fuego = false;
    document.body.classList.remove('jugando');
    preparar();
  }

  function golpear(naveY) {
    if (nave.inmune > 0 || finDesde) return;
    explotar(nave.x, naveY, sprites.nave.color, 30);
    nave.inmune = 2000;
    if (--vidas > 0) return;
    finDesde = performance.now();
    if (puntos > record) {
      record = puntos;
      try { localStorage.setItem('recordFondo', record); } catch {}
    }
  }

  function texto(cadena, x, y, alinear = 'center', tam = 5) {
    ctx.font = `bold ${px * tam}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = alinear;
    ctx.fillStyle = '#f1edfc';
    ctx.fillText(cadena, x, y);
  }

  function cuadro(t) {
    const dt = Math.min(t - previo, 50);
    previo = t;
    ctx.clearRect(0, 0, ancho, alto);
    // Jugando, la nave también avanza y retrocede (sin subir más allá de la mitad de la pantalla)
    const piso = alto - 40;
    if (jugando) {
      const dirY = (teclas.ArrowDown || teclas.s ? 1 : 0) - (teclas.ArrowUp || teclas.w ? 1 : 0);
      if (dirY) nave.destinoY = nave.y + dirY * 60;
      nave.destinoY = Math.min(piso, Math.max(alto * .45, nave.destinoY));
      nave.y += Math.sign(nave.destinoY - nave.y) * Math.min(Math.abs(nave.destinoY - nave.y), dt * .45);
    } else nave.y = nave.destinoY = piso;
    const naveY = nave.y;
    const vivo = !jugando || !finDesde;

    for (const e of estrellas) {
      e.y += e.v * dt * (jugando ? .12 : .05);
      if (e.y > alto) { e.y = 0; e.x = Math.random() * ancho; }
      ctx.globalAlpha = .45 + .35 * Math.sin(t / 500 + e.fase);
      ctx.fillStyle = e.v > 1.1 ? '#f5f3ff' : '#a78bfa';
      ctx.fillRect(e.x, e.y, e.v > 1.1 ? 2 : 1, e.v > 1.1 ? 2 : 1);
    }
    ctx.globalAlpha = 1;

    // De vez en cuando un enemigo se lanza en picada; jugando, apunta a la nave y cada oleada es más agresiva
    if (Math.random() < dt / (jugando ? Math.max(350, 1300 - oleada * 150) : 1800)) {
      const libres = enemigos.filter(e => !e.picada && e.fuera <= 0 && e.alfa >= 1);
      const elegido = libres[Math.floor(Math.random() * libres.length)];
      if (elegido) {
        elegido.picada = 1;
        elegido.dx = jugando ? nave.x - elegido.x : 0;
      }
    }
    const duracion = jugando ? Math.max(2000, 3600 - oleada * 250) : 4500;
    for (const e of enemigos) {
      if (e.fuera > 0) { e.fuera -= dt; continue; }
      if (e.muerto) continue;
      e.alfa = Math.min(1, e.alfa + dt / 600);
      e.picada = Math.max(0, e.picada - dt / duracion);
      const avance = 1 - e.picada, arco = Math.sin(avance * Math.PI);
      e.x = ancho / 2 + e.bx + Math.sin(t / 1600) * 50 + (e.picada && Math.sin(avance * Math.PI * 2) * 160 + e.dx * arco);
      e.y = e.by + Math.sin(t / 600 + e.bx) * 3 + (e.picada && arco * alto * (jugando ? 1 : .7));
      sprite(e.tipo, e.x, e.y, e.alfa);
      if (!jugando || !e.picada || finDesde) continue;
      if (Math.random() < dt / 1100 && e.y < naveY - 80) balas.push({ x: e.x, y: e.y, vx: (nave.x - e.x) / 1500, vy: .25 });
      if (Math.abs(e.x - nave.x) < px * 8 && Math.abs(e.y - naveY) < px * 6 && nave.inmune <= 0) {
        e.muerto = true;
        explotar(e.x, e.y, sprites[e.tipo].color);
        golpear(naveY);
      }
    }
    if (jugando && enemigos.every(e => e.muerto)) {
      oleada++;
      aviso = 2000;
      crearEnemigos();
    }

    // La nave: patrulla sola en el fondo o la controlas tú
    if (jugando) {
      const dir = (teclas.ArrowRight || teclas.d ? 1 : 0) - (teclas.ArrowLeft || teclas.a ? 1 : 0);
      if (dir) nave.destino = nave.x + dir * 60;
    } else if (Math.abs(nave.destino - nave.x) < 4) nave.destino = ancho * (.1 + Math.random() * .8);
    nave.destino = Math.min(ancho - px * 8, Math.max(px * 8, nave.destino));
    nave.x += Math.sign(nave.destino - nave.x) * Math.min(Math.abs(nave.destino - nave.x), dt * (jugando ? .6 : .15));
    nave.recarga -= dt;
    nave.inmune -= dt;
    if (vivo && nave.recarga <= 0 && (!jugando || fuego)) {
      disparos.push({ x: nave.x, y: naveY - px * 5 });
      nave.recarga = jugando ? 260 : 500 + Math.random() * 700;
    }
    if (vivo && (nave.inmune <= 0 || Math.floor(t / 100) % 2)) sprite('nave', nave.x, naveY);

    disparos = disparos.filter(d => {
      d.y -= dt * (jugando ? .7 : .45);
      const blanco = enemigos.find(e => !e.muerto && e.fuera <= 0 && e.alfa > .8 && Math.abs(e.x - d.x) < px * 6 && Math.abs(e.y - d.y) < px * 4);
      if (blanco) {
        if (jugando) {
          puntos += (blanco.tipo === 'dron' ? 150 : 80) * (blanco.picada ? 2 : 1);
          blanco.muerto = true;
        } else {
          blanco.fuera = 2500 + Math.random() * 3000;
          blanco.alfa = 0;
          blanco.picada = 0;
        }
        explotar(d.x, d.y, sprites[blanco.tipo].color);
        return false;
      }
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(d.x - 1, d.y, 2, px * 3);
      return d.y > -10;
    });

    balas = balas.filter(b => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (vivo && Math.abs(b.x - nave.x) < px * 5 && Math.abs(b.y - naveY) < px * 4 && nave.inmune <= 0) {
        golpear(naveY);
        return false;
      }
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(b.x - px / 2, b.y, px, px * 2);
      return b.y < alto + 10;
    });

    chispas = chispas.filter(c => {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vida -= dt / 700;
      ctx.globalAlpha = Math.max(0, c.vida);
      ctx.fillStyle = c.color;
      ctx.fillRect(c.x, c.y, px, px);
      return c.vida > 0;
    });
    ctx.globalAlpha = 1;

    if (jugando) {
      texto(`PUNTOS ${puntos}`, 16, 28, 'left');
      texto(`RÉCORD ${Math.max(record, puntos)}`, ancho - 16, 28, 'right');
      for (let i = 0; i < vidas; i++) sprite('nave', 24 + i * px * 13, alto - 14, .6);
      if (aviso > 0) {
        aviso -= dt;
        texto(`OLEADA ${oleada}`, ancho / 2, alto / 2, 'center', 8);
        if (oleada === 1) texto(ancho < 640 ? 'Arrastra para moverte y disparar' : 'Mueve con el ratón o las flechas  ·  Dispara con clic o espacio  ·  Esc para salir', ancho / 2, alto / 2 + px * 12, 'center', 4);
      }
      if (finDesde) {
        texto('FIN DEL JUEGO', ancho / 2, alto / 2, 'center', 10);
        texto('Toca para volver', ancho / 2, alto / 2 + px * 14, 'center', 4);
      }
    }

    corriendo = jugando || !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (corriendo) requestAnimationFrame(cuadro);
  }

  // Triple clic (o toque) en el fondo, fuera del panel, inicia el juego
  let toques = 0, ultimo = 0;
  addEventListener('pointerdown', e => {
    if (jugando) {
      if (finDesde && performance.now() - finDesde > 1000) return salir();
      apuntar(e);
      fuego = true;
      return;
    }
    if (e.target.closest('main, dialog')) return (toques = 0);
    toques = e.timeStamp - ultimo < 500 ? toques + 1 : 1;
    ultimo = e.timeStamp;
    if (toques === 3) {
      toques = 0;
      iniciar();
    }
  });
  // Con el dedo, la nave queda un poco arriba para que no la tape
  function apuntar(e) {
    nave.destino = e.clientX;
    nave.destinoY = e.clientY - (e.pointerType === 'touch' ? 60 : 0);
  }
  addEventListener('pointermove', e => { if (jugando && (e.pointerType === 'mouse' || fuego)) apuntar(e); });
  addEventListener('pointerup', () => { fuego = false; });
  addEventListener('pointercancel', () => { fuego = false; });
  addEventListener('keydown', e => {
    if (!jugando) return;
    if (e.key === 'Escape') return salir();
    if (finDesde && performance.now() - finDesde > 1000 && (e.key === ' ' || e.key === 'Enter')) return salir();
    teclas[e.key] = true;
    if (e.key === ' ') fuego = true;
    e.preventDefault();
  });
  addEventListener('keyup', e => {
    teclas[e.key] = false;
    if (e.key === ' ') fuego = false;
  });

  // En móvil la barra del navegador cambia el alto al hacer scroll: solo reiniciamos si cambia el ancho
  addEventListener('resize', () => {
    if (innerWidth !== ancho) return preparar();
    alto = innerHeight;
    lienzo.height = alto * (devicePixelRatio || 1);
    ctx.setTransform(devicePixelRatio || 1, 0, 0, devicePixelRatio || 1, 0, 0);
  });
  preparar();
  requestAnimationFrame(cuadro);
})();
