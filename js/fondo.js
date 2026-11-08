// Fondo arcade: campo de estrellas, formación de enemigos que se lanzan en picada y una nave que dispara
(() => {
  const lienzo = document.getElementById('espacio');
  const ctx = lienzo.getContext('2d');
  const sprites = {
    manta: { color: '#c084fc', filas: ['X....X....X', 'XX..XXX..XX', 'XXXXXXXXXXX', '.XXX.X.XXX.', '..XXXXXXX..', '...X...X...'] },
    dron: { color: '#f472b6', filas: ['....XXX....', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', '..X.XXX.X..', '.X.......X.'] },
    nave: { color: '#a5f3fc', filas: ['.....X.....', '.....X.....', '....XXX....', '..X.XXX.X..', '.XXXXXXXXX.', 'XXX.XXX.XXX', 'X....X....X'] }
  };
  const nave = { x: 0, destino: 0, recarga: 0 };
  let ancho, alto, px, estrellas, enemigos, disparos, chispas, previo = 0;

  function sprite(nombre, x, y, alfa = 1) {
    const { color, filas } = sprites[nombre];
    ctx.globalAlpha = alfa;
    ctx.fillStyle = color;
    filas.forEach((fila, j) => [...fila].forEach((c, i) => {
      if (c === 'X') ctx.fillRect(Math.round(x + (i - fila.length / 2) * px), Math.round(y + (j - filas.length / 2) * px), px, px);
    }));
    ctx.globalAlpha = 1;
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
    const columnas = ancho < 640 ? 5 : 10;
    enemigos = [];
    for (let fila = 0; fila < 3; fila++) {
      for (let c = 0; c < columnas; c++) {
        enemigos.push({ tipo: fila ? 'manta' : 'dron', bx: (c - (columnas - 1) / 2) * px * 17, by: 60 + fila * px * 14, picada: 0, fuera: 0, alfa: 1 });
      }
    }
    disparos = [];
    chispas = [];
    nave.x = nave.destino = ancho / 2;
  }

  function cuadro(t) {
    const dt = Math.min(t - previo, 50);
    previo = t;
    ctx.clearRect(0, 0, ancho, alto);

    for (const e of estrellas) {
      e.y += e.v * dt * .05;
      if (e.y > alto) { e.y = 0; e.x = Math.random() * ancho; }
      ctx.globalAlpha = .45 + .35 * Math.sin(t / 500 + e.fase);
      ctx.fillStyle = e.v > 1.1 ? '#f5f3ff' : '#a78bfa';
      ctx.fillRect(e.x, e.y, e.v > 1.1 ? 2 : 1, e.v > 1.1 ? 2 : 1);
    }
    ctx.globalAlpha = 1;

    // De vez en cuando un enemigo se lanza en picada y regresa a la formación
    if (Math.random() < dt / 1800) {
      const libres = enemigos.filter(e => !e.picada && e.fuera <= 0);
      if (libres.length) libres[Math.floor(Math.random() * libres.length)].picada = 1;
    }
    for (const e of enemigos) {
      if (e.fuera > 0) { e.fuera -= dt; continue; }
      e.alfa = Math.min(1, e.alfa + dt / 600);
      e.picada = Math.max(0, e.picada - dt / 4500);
      const avance = 1 - e.picada;
      e.x = ancho / 2 + e.bx + Math.sin(t / 1600) * 50 + (e.picada && Math.sin(avance * Math.PI * 2) * 160);
      e.y = e.by + Math.sin(t / 600 + e.bx) * 3 + (e.picada && Math.sin(avance * Math.PI) * alto * .7);
      sprite(e.tipo, e.x, e.y, e.alfa);
    }

    // La nave patrulla abajo y dispara
    if (Math.abs(nave.destino - nave.x) < 4) nave.destino = ancho * (.1 + Math.random() * .8);
    nave.x += Math.sign(nave.destino - nave.x) * Math.min(Math.abs(nave.destino - nave.x), dt * .15);
    const naveY = alto - 40;
    nave.recarga -= dt;
    if (nave.recarga <= 0) {
      disparos.push({ x: nave.x, y: naveY - px * 5 });
      nave.recarga = 500 + Math.random() * 700;
    }
    sprite('nave', nave.x, naveY);

    ctx.fillStyle = '#fde68a';
    disparos = disparos.filter(d => {
      d.y -= dt * .45;
      const blanco = enemigos.find(e => e.fuera <= 0 && e.alfa > .8 && Math.abs(e.x - d.x) < px * 6 && Math.abs(e.y - d.y) < px * 4);
      if (blanco) {
        blanco.fuera = 2500 + Math.random() * 3000;
        blanco.alfa = 0;
        blanco.picada = 0;
        for (let i = 0; i < 14; i++) {
          const angulo = Math.random() * Math.PI * 2, rapidez = .05 + Math.random() * .15;
          chispas.push({ x: d.x, y: d.y, vx: Math.cos(angulo) * rapidez, vy: Math.sin(angulo) * rapidez, vida: 1, color: sprites[blanco.tipo].color });
        }
        return false;
      }
      ctx.fillRect(d.x - 1, d.y, 2, px * 3);
      return d.y > -10;
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

    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(cuadro);
  }

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
