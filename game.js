// Car Soccer — pure Canvas 1v1 (NetplayJS compatible)
// Enhanced graphics, Web Audio SFX, better ball physics, smarter AI

const CANVAS_W = 960;
const CANVAS_H = 540;

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
  }
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(this.ctx.destination);
  }
  resume() {
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  tone(freq, dur, type = 'sine', vol = 0.3, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol = 0.2, freq = 800) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * dur;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t);
  }
  kick() {
    this.noise(0.08, 0.35, 600);
    this.tone(140, 0.12, 'sine', 0.25, -80);
  }
  bounce() {
    this.tone(220, 0.06, 'square', 0.15);
    this.noise(0.04, 0.1, 1200);
  }
  goal() {
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.15, 'square', 0.3, 0));
    setTimeout(() => this.tone(1046, 0.3, 'triangle', 0.25), 200);
  }
  boost() {
    this.noise(0.1, 0.2, 400);
    this.tone(80, 0.15, 'sawtooth', 0.15);
  }
}

const audio = new AudioEngine();

class CarSoccerGame extends netplayjs.Game {
  static timestep = 1000 / 60;
  static canvasSize = { width: CANVAS_W, height: CANVAS_H };
  static highDPI = true;

  constructor(canvas, players) {
    super();
    this.canvas = canvas;
    this.players = players || [];
    this.isOnline = players && players.length > 0;

    // Set proper canvas resolution
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    this.field = { x: 70, y: 30, w: 820, h: 480 };
    this.goals = {
      left: { x: 50, y: 190, w: 22, h: 160 },
      right: { x: 888, y: 190, w: 22, h: 160 }
    };

    this.ball = { x: CANVAS_W / 2, y: CANVAS_H / 2, vx: 0, vy: 0, r: 16, spin: 0 };
    this.cars = [
      { x: 240, y: CANVAS_H / 2, angle: 0, vx: 0, vy: 0, team: 0, boost: 100, isPlayer: true, trail: [] },
      { x: 720, y: CANVAS_H / 2, angle: Math.PI, vx: 0, vy: 0, team: 1, boost: 100, isPlayer: false, trail: [] }
    ];
    this.score = [0, 0];
    this.particles = [];
    this.kickoffTimer = 0;
    this.shake = 0;
    this.lastKick = 0;

    this.keys = {};
    this.setupInput();
  }

  setupInput() {
    window.addEventListener('keydown', e => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === ' ' || e.key === 'Enter') audio.resume();
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
  }

  tick(playerInputs) {
    const inputs = playerInputs || new Map();
    this.kickoffTimer = Math.max(0, this.kickoffTimer - 1);
    this.shake *= 0.88;

    this.cars.forEach((car, i) => {
      let accel = 0, steer = 0, boost = false;
      if (i === 0 || !this.isOnline) {
        accel = (this.keys['w'] || this.keys['arrowup'] ? 1 : 0) - (this.keys['s'] || this.keys['arrowdown'] ? 1 : 0);
        steer = (this.keys['d'] || this.keys['arrowright'] ? 1 : 0) - (this.keys['a'] || this.keys['arrowleft'] ? 1 : 0);
        boost = this.keys[' '] || this.keys['space'];
      } else {
        const inp = inputs.get(this.players[i]);
        if (inp) {
          accel = (inp.keysHeld['ArrowUp'] || inp.keysHeld['w'] ? 1 : 0) - (inp.keysHeld['ArrowDown'] || inp.keysHeld['s'] ? 1 : 0);
          steer = (inp.keysHeld['ArrowRight'] || inp.keysHeld['d'] ? 1 : 0) - (inp.keysHeld['ArrowLeft'] || inp.keysHeld['a'] ? 1 : 0);
          boost = inp.keysHeld[' '] || inp.keysHeld['Space'];
        }
      }

      // Smarter AI
      if (!car.isPlayer && !this.isOnline) {
        const dx = this.ball.x - car.x;
        const dy = this.ball.y - car.y;
        const dist = Math.hypot(dx, dy);
        const predX = this.ball.x + this.ball.vx * 8;
        const predY = this.ball.y + this.ball.vy * 8;
        const pdx = predX - car.x;
        const pdy = predY - car.y;
        const desired = Math.atan2(pdy, pdx);
        let diff = desired - car.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        steer = Math.max(-1, Math.min(1, diff * 1.8));
        accel = dist > 40 ? 0.9 : 0.4;
        boost = dist > 150 && car.boost > 40 && Math.abs(diff) < 0.5;
        if (car.team === 1 && this.ball.x > 700) accel *= 1.1;
      }

      const baseSpeed = 2.6;
      const boostPower = (boost && car.boost > 0) ? 1.8 : 0;
      if (boost && car.boost > 0) {
        car.boost = Math.max(0, car.boost - 1.4);
        if (Math.random() < 0.3) audio.boost();
      } else {
        car.boost = Math.min(100, car.boost + 0.35);
      }

      car.angle += steer * 0.075;
      const speed = baseSpeed + boostPower;
      const ax = Math.cos(car.angle) * accel * speed;
      const ay = Math.sin(car.angle) * accel * speed;
      car.vx = car.vx * 0.91 + ax * 0.4;
      car.vy = car.vy * 0.91 + ay * 0.4;

      car.x += car.vx;
      car.y += car.vy;

      if (boost && car.boost > 10) {
        car.trail.push({ x: car.x, y: car.y, life: 12 });
      }
      car.trail = car.trail.filter(t => { t.life--; return t.life > 0; });

      const margin = 24;
      if (car.x < this.field.x + margin) { car.x = this.field.x + margin; car.vx *= -0.35; }
      if (car.x > this.field.x + this.field.w - margin) { car.x = this.field.x + this.field.w - margin; car.vx *= -0.35; }
      if (car.y < this.field.y + margin) { car.y = this.field.y + margin; car.vy *= -0.35; }
      if (car.y > this.field.y + this.field.h - margin) { car.y = this.field.y + this.field.h - margin; car.vy *= -0.35; }
    });

    this.ball.vx *= 0.982;
    this.ball.vy *= 0.982;
    this.ball.spin *= 0.96;
    this.ball.x += this.ball.vx;
    this.ball.y += this.ball.vy;

    const bMargin = this.ball.r + 2;
    let bounced = false;
    if (this.ball.x < this.field.x + bMargin) { this.ball.x = this.field.x + bMargin; this.ball.vx *= -0.75; bounced = true; }
    if (this.ball.x > this.field.x + this.field.w - bMargin) { this.ball.x = this.field.x + this.field.w - bMargin; this.ball.vx *= -0.75; bounced = true; }
    if (this.ball.y < this.field.y + bMargin) { this.ball.y = this.field.y + bMargin; this.ball.vy *= -0.75; bounced = true; }
    if (this.ball.y > this.field.y + this.field.h - bMargin) { this.ball.y = this.field.y + this.field.h - bMargin; this.ball.vy *= -0.75; bounced = true; }
    if (bounced) audio.bounce();

    this.cars.forEach(car => {
      const dx = this.ball.x - car.x;
      const dy = this.ball.y - car.y;
      const dist = Math.hypot(dx, dy);
      const minDist = this.ball.r + 18;
      if (dist < minDist && dist > 0.1) {
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        this.ball.x += nx * overlap * 0.55;
        this.ball.y += ny * overlap * 0.55;

        const carSpeed = Math.hypot(car.vx, car.vy);
        const rel = car.vx * nx + car.vy * ny;
        const power = Math.max(0.8, carSpeed * 1.3 + Math.max(0, rel) * 0.9);
        this.ball.vx += nx * power * 1.6;
        this.ball.vy += ny * power * 1.6;
        this.ball.spin += (car.vx * ny - car.vy * nx) * 0.15;

        this.spawnParticles(car.x, car.y, 8, car.team === 0 ? '#60a5fa' : '#fb923c');
        audio.kick();
        this.lastKick = 8;
      }
    });

    if (this.kickoffTimer <= 0) {
      if (this.ball.x < this.goals.left.x + this.goals.left.w &&
          this.ball.y > this.goals.left.y && this.ball.y < this.goals.left.y + this.goals.left.h) {
        this.score[1]++;
        this.resetBall();
        this.shake = 14;
        audio.goal();
      }
      if (this.ball.x > this.goals.right.x &&
          this.ball.y > this.goals.right.y && this.ball.y < this.goals.right.y + this.goals.right.h) {
        this.score[0]++;
        this.resetBall();
        this.shake = 14;
        audio.goal();
      }
    }

    this.particles = this.particles.filter(p => {
      p.life -= 1;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      return p.life > 0;
    });

    const sb = document.getElementById('scoreBlue');
    const so = document.getElementById('scoreOrange');
    if (sb) sb.textContent = this.score[0];
    if (so) so.textContent = this.score[1];
  }

  resetBall() {
    this.ball.x = CANVAS_W / 2;
    this.ball.y = CANVAS_H / 2;
    this.ball.vx = (Math.random() - 0.5) * 2;
    this.ball.vy = (Math.random() - 0.5) * 2;
    this.ball.spin = 0;
    this.kickoffTimer = 70;
    this.spawnParticles(this.ball.x, this.ball.y, 30, '#fff');
  }

  spawnParticles(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        life: 18 + Math.random() * 22,
        color,
        size: 1.5 + Math.random() * 2
      });
    }
  }

  draw(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Reset transform and clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fit the 960x540 game world into the actual canvas while preserving aspect ratio
    const scaleX = canvas.width / CANVAS_W;
    const scaleY = canvas.height / CANVAS_H;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (canvas.width - CANVAS_W * scale) / 2;
    const offsetY = (canvas.height - CANVAS_H * scale) / 2;

    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.save();
    ctx.translate(sx, sy);

    // Sky / stadium bg
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#0b1220');
    sky.addColorStop(1, '#1a2740');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Field
    const f = this.field;
    const grass = ctx.createLinearGradient(f.x, f.y, f.x, f.y + f.h);
    grass.addColorStop(0, '#166534');
    grass.addColorStop(0.5, '#22c55e');
    grass.addColorStop(1, '#15803d');
    ctx.fillStyle = grass;
    ctx.fillRect(f.x, f.y, f.w, f.h);

    // Mowed stripes
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#000' : '#fff';
      ctx.fillRect(f.x, f.y + i * (f.h / 14), f.w, f.h / 14);
    }
    ctx.globalAlpha = 1;

    // Field lines
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(f.x + 2, f.y + 2, f.w - 4, f.h - 4);
    ctx.beginPath();
    ctx.moveTo(f.x + f.w / 2, f.y);
    ctx.lineTo(f.x + f.w / 2, f.y + f.h);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(f.x + f.w / 2, f.y + f.h / 2, 70, 0, Math.PI * 2);
    ctx.stroke();
    // Penalty areas
    ctx.strokeRect(f.x + 2, f.y + 140, 90, 200);
    ctx.strokeRect(f.x + f.w - 92, f.y + 140, 90, 200);

    // Goals with nets
    ctx.fillStyle = 'rgba(96,165,250,0.2)';
    ctx.fillRect(this.goals.left.x, this.goals.left.y, this.goals.left.w, this.goals.left.h);
    ctx.fillStyle = 'rgba(251,146,60,0.2)';
    ctx.fillRect(this.goals.right.x, this.goals.right.y, this.goals.right.w, this.goals.right.h);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#60a5fa';
    ctx.strokeRect(this.goals.left.x, this.goals.left.y, this.goals.left.w, this.goals.left.h);
    ctx.strokeStyle = '#fb923c';
    ctx.strokeRect(this.goals.right.x, this.goals.right.y, this.goals.right.w, this.goals.right.h);

    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    [this.goals.left, this.goals.right].forEach(g => {
      for (let i = 1; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(g.x, g.y + (g.h / 6) * i);
        ctx.lineTo(g.x + g.w, g.y + (g.h / 6) * i);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(g.x + (g.w / 4) * (i % 3), g.y);
        ctx.lineTo(g.x + (g.w / 4) * (i % 3), g.y + g.h);
        ctx.stroke();
      }
    });

    // Cars with more detail
    this.cars.forEach(car => {
      // Trail
      car.trail.forEach(t => {
        ctx.globalAlpha = t.life / 12 * 0.5;
        ctx.fillStyle = car.team === 0 ? '#60a5fa' : '#fb923c';
        ctx.beginPath();
        ctx.arc(t.x, t.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(3, 6, 20, 11, 0, 0, Math.PI * 2);
      ctx.fill();

      // Body gradient
      const body = ctx.createLinearGradient(-18, 0, 18, 0);
      const c1 = car.team === 0 ? '#1d4ed8' : '#c2410c';
      const c2 = car.team === 0 ? '#60a5fa' : '#fb923c';
      body.addColorStop(0, c1);
      body.addColorStop(0.5, c2);
      body.addColorStop(1, c1);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(-18, -10, 36, 20, 5);
      ctx.fill();

      // Roof / cabin
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.roundRect(-8, -8, 16, 16, 4);
      ctx.fill();

      // Front lights
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(14, -6, 4, 3);
      ctx.fillRect(14, 3, 4, 3);

      // Wheels
      ctx.fillStyle = '#0f172a';
      [[-12, -11], [-12, 6], [6, -11], [6, 6]].forEach(([wx, wy]) => {
        ctx.fillRect(wx, wy, 7, 5);
      });

      // Boost flame
      if (car.boost > 15 && Math.hypot(car.vx, car.vy) > 1.8) {
        const flame = 8 + Math.random() * 10;
        ctx.fillStyle = `rgba(255,200,80,${0.5 + Math.random() * 0.4})`;
        ctx.beginPath();
        ctx.moveTo(-18, -4);
        ctx.lineTo(-18 - flame, 0);
        ctx.lineTo(-18, 4);
        ctx.fill();
        ctx.fillStyle = `rgba(255,100,40,${0.3 + Math.random() * 0.3})`;
        ctx.beginPath();
        ctx.moveTo(-18, -2);
        ctx.lineTo(-18 - flame * 0.6, 0);
        ctx.lineTo(-18, 2);
        ctx.fill();
      }

      ctx.restore();
    });

    // Ball with pattern and shadow
    ctx.save();
    ctx.translate(this.ball.x, this.ball.y);
    ctx.rotate(this.ball.spin * 0.05);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(2, 4, this.ball.r, this.ball.r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    const ballGrad = ctx.createRadialGradient(-5, -5, 3, 0, 0, this.ball.r);
    ballGrad.addColorStop(0, '#ffffff');
    ballGrad.addColorStop(0.7, '#e5e7eb');
    ballGrad.addColorStop(1, '#9ca3af');
    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(0, 0, this.ball.r, 0, Math.PI * 2);
    ctx.fill();

    // Soccer pattern
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, this.ball.r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + this.ball.spin * 0.02;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * this.ball.r * 0.3, Math.sin(a) * this.ball.r * 0.3);
      ctx.lineTo(Math.cos(a) * this.ball.r * 0.95, Math.sin(a) * this.ball.r * 0.95);
      ctx.stroke();
    }
    ctx.restore();

    // Particles
    this.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life / 40);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  serialize() {
    return {
      ball: { x: this.ball.x, y: this.ball.y, vx: this.ball.vx, vy: this.ball.vy, spin: this.ball.spin },
      cars: this.cars.map(c => ({ x: c.x, y: c.y, angle: c.angle, vx: c.vx, vy: c.vy, boost: c.boost, team: c.team })),
      score: [...this.score],
      kickoffTimer: this.kickoffTimer
    };
  }

  deserialize(state) {
    Object.assign(this.ball, state.ball);
    state.cars.forEach((c, i) => {
      if (this.cars[i]) Object.assign(this.cars[i], c);
    });
    this.score = state.score;
    this.kickoffTimer = state.kickoffTimer;
  }
}

function startLocal() {
  document.getElementById('menu').classList.add('hidden');
  audio.resume();
  const canvas = document.getElementById('gameCanvas');
  const game = new CarSoccerGame(canvas, []);
  game.isOnline = false;

  function loop() {
    game.tick();
    game.draw(canvas);
    requestAnimationFrame(loop);
  }
  loop();
}

function startOnline() {
  document.getElementById('menu').classList.add('hidden');
  audio.resume();
  new netplayjs.RollbackWrapper(CarSoccerGame).start();
}

document.getElementById('startLocal').onclick = startLocal;
document.getElementById('startOnline').onclick = startOnline;