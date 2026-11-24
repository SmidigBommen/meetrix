// Simulated electronics. Everything runs on one virtual clock counted in nanoseconds.
// Values marked "assumed" are placeholders to replace with measurements.
export const PINS = { R1: 42, G1: 41, B1: 40, R2: 38, G2: 39, B2: 37, A: 45, B: 36, C: 48, D: 35, CLK: 2, LAT: 47, OE: 14 };
export const SIGNALS = Object.keys(PINS);
const bit = n => (n < 32 ? (1 << n) : (1 << (n - 32))) >>> 0;
const M = Object.fromEntries(SIGNALS.map(s => [s, bit(PINS[s])]));
const DATA = ['R1', 'G1', 'B1', 'R2', 'G2', 'B2'];
const ADDR_MASK = M.A | M.B | M.C | M.D;
const LED13 = 1 << 13;
const WRITE_NS = 25;        // one GPIO register write; gives a 10 MHz pixel clock
const LED_MA = 20;          // per lit channel; 192 channels x 20 mA = 3.84 A, Adafruit quotes "nearly 4 Amps"
const MCU_MA = { boot: 60, idle: 100, tx: 340 };   // assumed
const CABLE_OHM = 0.1;      // assumed
const BROWNOUT_V = 4.0;     // assumed
const MS = 1e6;

const popc = v => { v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24; };
export const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0');

// Microsoft 365: one room mailbox, with the Graph v1.0 paths and status codes a bridge would use.
export class GraphMock {
  constructor() { this.events = []; this.up = true; this.seq = 1; this.room = 'room-fjord@contoso.example'; this.date = '2026-11-24'; }
  iso(m) { return this.date + 'T' + hhmm(m) + ':00.0000000'; }
  min(s) { return +s.slice(11, 13) * 60 + +s.slice(14, 16); }
  add(s, e, subject, door) {
    const ev = { id: 'AAMk' + this.seq++, subject, categories: door ? ['Meetrix door'] : [], showAs: 'busy',
      start: { dateTime: this.iso(s), timeZone: 'W. Europe Standard Time' }, end: { dateTime: this.iso(e), timeZone: 'W. Europe Standard Time' } };
    this.events.push(ev); return ev;
  }
  span(ev) { return { id: ev.id, s: this.min(ev.start.dateTime), e: this.min(ev.end.dateTime), own: ev.categories.includes('Meetrix door'), subject: ev.subject }; }
  list() { return this.events.map(e => this.span(e)).sort((a, b) => a.s - b.s); }
  request(method, path, body) {
    if (!this.up) return { status: 503, json: { error: { code: 'ServiceUnavailable' } } };
    const base = '/v1.0/users/' + this.room, id = (path.match(/\/events\/(\w+)$/) || [])[1];
    if (method === 'GET' && path.startsWith(base + '/calendar/calendarView?')) return { status: 200, json: { value: this.events } };
    if (method === 'POST' && path === base + '/events') { const ev = { id: 'AAMk' + this.seq++, showAs: 'busy', ...body }; this.events.push(ev); return { status: 201, json: ev }; }
    const i = this.events.findIndex(e => e.id === id);
    if (i < 0) return { status: 404, json: { error: { code: 'ErrorItemNotFound' } } };
    if (method === 'PATCH') { Object.assign(this.events[i], body); return { status: 200, json: this.events[i] }; }
    if (method === 'DELETE') { this.events.splice(i, 1); return { status: 204, json: null }; }
    return { status: 405, json: null };
  }
}

export class Sim {
  constructor(createFirmware) {
    this.create = createFirmware;
    this.t = 0; this.later = []; this.nextLater = Infinity;
    this.graph = new GraphMock();
    this.log = []; this.logSeq = 0;
    this.config = { mode: 0, free: 0, row: 1, bright: 60, debounce: 20, pullup: 1 };
    // Bench settings
    this.cut = new Set(); this.shifter = true; this.limitA = 2; this.bounceMs = 5;
    this.wifiUp = true; this.latencyMs = 120;
    this.rtcMin = 600; this.rtcAt = 0; this.warp = 1;
    this.powerOn = false; this.volts = 0; this.ledA = 0; this.amps = 0; this.resets = 0;
    this.contact = [false, false]; this.bounceId = [0, 0];
    this.keyTrace = null;
    this.acc = new Float64Array(32 * 32 * 3); this.accFrom = 0;
    this.capture = null; this.trig = -1; this.capN = 0; this.capT = new Float64Array(700); this.cap0 = new Uint32Array(700); this.cap1 = new Uint32Array(700); this.capRow = 8;
    this.touched0 = 0; this.touched1 = 0; this.frames = 0;
    this.applyWires(); this.clearPins();
  }

  // --- clock and event queue ---
  after(ms, f) { this.later.push({ t: this.t + ms * MS, f }); this.nextLater = Math.min(this.nextLater, this.t + ms * MS); }
  run(until, budget = () => true) {
    let guard = 0;
    for (;;) {
      const tt = Math.min(this.timerAt, this.tickAt, this.nextLater);
      if (tt > until) { if (until > this.t) this.t = until; break; }
      if (tt > this.t) this.t = tt;
      if (tt === this.timerAt) { this.timerAt = Infinity; this.fw.fw_isr(); }
      else if (tt === this.tickAt) { this.tickAt += MS; this.millisecond(); }
      else {
        const i = this.later.findIndex(e => e.t === tt), ev = this.later.splice(i, 1)[0];
        this.nextLater = this.later.reduce((a, e) => Math.min(a, e.t), Infinity);
        ev.f();
      }
      if ((++guard & 255) === 0 && !budget()) break;
    }
    this.integrate();
  }
  say(kind, text) { this.log.push({ n: ++this.logSeq, t: this.t, kind, text }); if (this.log.length > 160) this.log.shift(); }

  // --- power supply: current limit, cable drop, brownout ---
  power(on) {
    if (on === this.powerOn) return;
    this.powerOn = on;
    if (on) { this.volts = 5; this.boot('power on'); }
    else { this.integrate(); this.halt(); this.volts = this.ledA = this.amps = 0; }
  }
  halt() { this.fw = null; this.epoch = (this.epoch || 0) + 1; this.timerAt = this.tickAt = Infinity; this.clearPins(); this.mcu = 'off'; }
  boot(cause) {
    this.halt(); this.mcu = 'boot'; this.tickAt = Infinity; this.ledA = 0;
    const epoch = this.epoch;
    this.say('uart', 'rst: ' + cause);
    this.after(300, () => {
      if (epoch !== this.epoch || !this.powerOn) return;
      this.mcu = 'run'; this.bootAt = this.t; this.rtcSet = false; this.wifi = false; this.tx = 0; this.lowMs = 0;
      this.fw = this.create(this.hal());
      this.tickAt = this.t + MS;
      this.fw.fw_setup();
      this.configure({});
    });
  }
  millisecond() {
    this.integrate();
    const a = this.charge / MS / 1000; this.charge = 0;             // mA*ns over 1 ms -> A
    this.ledA += (a - this.ledA) * 0.1;                             // bulk capacitor, about 10 ms
    if (this.tx > 0) this.tx--;
    this.amps = this.ledA + (this.tx ? MCU_MA.tx : MCU_MA.idle) / 1000;
    this.volts = 5 - this.amps * CABLE_OHM;
    if (this.amps > this.limitA) this.volts *= this.limitA / this.amps;
    this.lowMs = this.volts < BROWNOUT_V ? this.lowMs + 1 : 0;
    if (this.lowMs > 5) { this.resets++; this.say('uart', 'Brownout detector was triggered (' + this.volts.toFixed(2) + ' V)'); this.boot('brownout'); return; }
    this.fw.fw_tick();
  }
  configure(c) {
    Object.assign(this.config, c);
    const k = this.config;
    if (this.fw) this.fw.fw_config(k.mode, k.free, k.row, k.bright, k.debounce, k.pullup);
  }

  // --- ESP32-S3 peripherals the firmware talks to ---
  hal() {
    const text = (p, n) => { let s = ''; const b = new Uint8Array(this.fw.memory.buffer, p, n); for (const c of b) s += String.fromCharCode(c); return s; };
    const epoch = this.epoch;
    return {
      hal_w1ts: (b, m) => this.gpio(b, m >>> 0, 0), hal_w1tc: (b, m) => this.gpio(b, 0, m >>> 0),
      hal_pin_mode: (p, m) => { this.pinMode[p] = m; },
      hal_pin_read: p => this.readPin(p),
      hal_timer: ns => { this.timerAt = this.t + ns; },
      hal_millis: () => Math.floor((this.t - this.bootAt) / MS),
      hal_rtc_minute: () => this.rtcSet ? Math.floor(this.minute()) : -1,
      hal_wifi_begin: () => this.after(1200, () => { if (epoch === this.epoch && this.fw && this.wifiUp && !this.wifi) { this.wifi = true; this.fw.fw_on_wifi(1); } }),
      hal_sntp: () => this.after(150, () => { if (epoch === this.epoch && this.wifi) { this.rtcSet = true; this.say('uart', 'sntp: clock set to ' + hhmm(this.minute())); } }),
      hal_send: (p, n) => this.send(text(p, n)),
      hal_uart: (p, n) => this.say('uart', text(p, n)),
    };
  }
  minute() { return Math.min(1439, this.rtcMin + (this.t - this.rtcAt) / 6e10 * this.warp); }
  setClock(min) { this.rtcMin = min; this.rtcAt = this.t; }
  setWarp(w) { this.setClock(this.minute()); this.warp = w; }

  // --- push buttons: contact to ground, bounce, pull-up or floating input ---
  readPin(p) {
    const i = p === 6 ? 0 : p === 7 ? 1 : -1;
    if (i < 0) return 0;
    if (this.contact[i]) return 0;
    return this.pinMode[p] === 1 ? 1 : (Math.random() < 0.5 ? 1 : 0);   // no pull-up: the pin floats
  }
  key(i, down) {
    const id = ++this.bounceId[i];
    if (down) this.keyTrace = { key: i, t0: this.t, edges: [], led: [] };
    const flip = v => {
      if (id !== this.bounceId[i] || v === this.contact[i]) return;
      this.contact[i] = v;
      if (this.keyTrace && this.keyTrace.key === i) this.keyTrace.edges.push([this.t - this.keyTrace.t0, v ? 0 : 1]);
    };
    flip(down);
    let t = 0, v = down;
    while (this.bounceMs > 0) {
      t += 0.15 + Math.random() * this.bounceMs / 3;
      if (t > this.bounceMs) break;
      v = !v; const w = v; this.after(t, () => flip(w));
    }
    this.after(this.bounceMs, () => flip(down));
  }

  // --- GPIO, level shifter and wiring ---
  clearPins() {
    this.o0 = M.OE; this.o1 = 0; this.pinMode = {}; this.timerAt = this.tickAt = Infinity;
    this.sr = [0, 0, 0, 0, 0, 0]; this.lat = [0, 0, 0, 0, 0, 0]; this.rowSel = 0; this.lit = false; this.litFrom = this.t; this.charge = 0; this.pop = 0;
  }
  applyWires() {
    if (this.lat) this.integrate();
    this.dataMask = DATA.map(s => this.cut.has(s) ? 0 : M[s]);
    this.addrMask = ['A', 'B', 'C', 'D'].map(s => this.cut.has(s) ? 0 : M[s]);
    this.cutClk = this.cut.has('CLK'); this.cutLat = this.cut.has('LAT'); this.cutOe = this.cut.has('OE');
    if (this.lat) { this.setRow(); this.setLit(); }
  }
  gpio(bank, set, clr) {
    this.t += WRITE_NS;
    if (bank === 0) {
      const o = this.o0, n = ((o | set) & ~clr) >>> 0, ch = o ^ n;
      if (!ch) return;
      this.o0 = n; this.touched0 |= ch;
      if (ch & M.CLK && n & M.CLK) this.panelClock();
      if (ch & M.OE) this.setLit();
      if (ch & LED13 && n & LED13 && this.keyTrace) this.keyTrace.led.push(this.t - this.keyTrace.t0);
    } else {
      const o = this.o1, n = ((o | set) & ~clr) >>> 0, ch = o ^ n;
      if (!ch) return;
      this.o1 = n; this.touched1 |= ch;
      if (ch & M.LAT && n & M.LAT) {
        const r = this.rowNext();
        if (r === this.capRow && r !== this.latRow) this.arm();   // same bit plane every time, so the picture is steady
        this.latRow = r;
        if (!this.cutLat) this.panelLatch();
      }
      if (ch & ADDR_MASK) this.setRow();
    }
    if (this.trig >= 0) {
      if (this.capN < 700 && this.t - this.trig <= 4200) {
        const i = this.capN++;
        this.capT[i] = this.t - this.trig; this.cap0[i] = this.o0; this.cap1[i] = this.o1;
      } else { this.capture = { n: this.capN, row: this.capRow }; this.trig = -1; }
    }
  }
  // --- logic analyzer trigger: one step of the chosen row pair per request ---
  rowNext() { const o = this.o1; return (o & M.A ? 1 : 0) | (o & M.B ? 2 : 0) | (o & M.C ? 4 : 0) | (o & M.D ? 8 : 0); }
  arm() { if (this.wantCapture && this.trig < 0) { this.trig = this.t - 200; this.capN = 0; this.wantCapture = false; } }

  // --- HUB75 panel: six 32-bit shift registers, output latch, 1:16 row decoder, OE ---
  panelClock() {
    if (this.cutClk) return;
    let o = this.o1;
    if (!this.shifter) {                       // 3.3 V into 5 V inputs: marginal, modeled as random errors (assumed rate)
      if (Math.random() < 0.004) return;
      if (Math.random() < 0.01) o ^= this.dataMask[(Math.random() * 6) | 0];
    }
    const s = this.sr, d = this.dataMask;
    for (let i = 0; i < 6; i++) s[i] = (s[i] << 1) | (o & d[i] ? 1 : 0);
  }
  panelLatch() {
    this.integrate(); this.frames += 1 / 64;          // 16 rows x 4 bit planes per refresh
    let pop = 0;
    for (let i = 0; i < 6; i++) { this.lat[i] = this.sr[i]; pop += popc(this.sr[i]); }
    this.pop = pop;
  }
  setRow() {
    const o = this.o1, a = this.addrMask, r = (o & a[0] ? 1 : 0) | (o & a[1] ? 2 : 0) | (o & a[2] ? 4 : 0) | (o & a[3] ? 8 : 0);
    if (r === this.rowSel) return;
    this.integrate(); this.rowSel = r;
  }
  setLit() {
    const lit = !(this.o0 & M.OE) && !this.cutOe;   // a cut OE wire is assumed to read as "off"
    if (lit === this.lit) return;
    this.integrate(); this.lit = lit;
  }
  integrate() {
    const dt = this.t - this.litFrom;
    this.litFrom = this.t;
    if (!this.lit || dt <= 0 || !this.pop) return;
    this.charge += this.pop * LED_MA * dt;
    const acc = this.acc;
    for (let i = 0; i < 6; i++) {
      let v = this.lat[i];
      if (!v) continue;
      const base = (this.rowSel + (i > 2 ? 16 : 0)) * 96 + i % 3;
      for (let x = 31; v; x--) { if (v & 1) acc[base + x * 3] += dt; v >>>= 1; }
    }
  }

  // --- Wi-Fi link and bridge server ---
  send(raw) {
    const id = (this.reqId = (this.reqId || 0) + 1), epoch = this.epoch;
    const line = raw.split(' HTTP')[0], body = raw.split('\r\n\r\n')[1] || '';
    this.tx = 4;
    this.say('dev', line + (body ? '  ' + body : ''));
    if (!this.wifi) return id;
    this.after(this.latencyMs / 2, () => this.wifiUp && this.bridge(line, body, (status, text) => this.after(this.latencyMs / 2, () => {
      if (epoch !== this.epoch || !this.fw || !this.wifi) return;
      const out = text.slice(0, 1000), b = new Uint8Array(this.fw.memory.buffer, this.fw.fw_rx_ptr(), 1024);
      for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i);
      this.say('dev', '  ' + status + '  ' + (out.replace(/\n/g, '') || '(empty day)'));
      this.fw.fw_on_reply(id, status, out.length);
    })));
    return id;
  }
  call(method, path, body, done) {
    this.after(this.latencyMs, () => {
      const r = this.graph.request(method, path, body);
      this.say('graph', method + ' ' + path.replace('/v1.0/users/' + this.graph.room, '/users/{room}').replace(/\?.*/, '?…') + '  ' + r.status);
      done(r);
    });
  }
  // The bridge keeps the Microsoft 365 secret and is the one place that checks for conflicts.
  bridge(line, body, reply) {
    const g = this.graph, base = '/v1.0/users/' + g.room;
    const view = base + '/calendar/calendarView?startDateTime=' + g.date + 'T00:00:00&endDateTime=' + g.date + 'T23:59:59';
    const fmt = () => g.list().map(m => m.s + ' ' + m.e + ' ' + (m.own ? 1 : 0) + ';\n').join('');
    const show = status => this.call('GET', view, null, r => r.status === 200 ? reply(status, fmt()) : reply(503, ''));
    if (line === 'GET /v1/day') return show(200);
    const m = body.match(/^(\d+) (\d+)$/);
    if (line !== 'PUT /v1/door-booking' || !m) return reply(400, '');
    const s = +m[1], e = +m[2];
    this.call('GET', view, null, r => {
      if (r.status !== 200) return reply(503, '');
      const all = r.json.value.map(ev => g.span(ev)), mine = all.find(x => x.own && x.s === s);
      if (all.some(x => x !== mine && x.s < e && x.e > s)) return reply(409, fmt());
      const when = v => ({ dateTime: g.iso(v), timeZone: 'W. Europe Standard Time' });
      const then = r2 => r2.status >= 500 ? reply(503, '') : show(200);
      if (mine && e > s) this.call('PATCH', base + '/events/' + mine.id, { end: when(e) }, then);
      else if (mine) this.call('DELETE', base + '/events/' + mine.id, null, then);
      else if (e > s) this.call('POST', base + '/events', { subject: 'Booked at the door', categories: ['Meetrix door'], start: when(s), end: when(e) }, then);
      else show(200);
    });
  }
  setWifi(up) {
    this.wifiUp = up;
    if (!up && this.wifi) { this.wifi = false; if (this.fw) this.fw.fw_on_wifi(0); }
  }
}

// The four whiteboard states, plus the rest of the day.
const at = (h, m) => h * 60 + m;
export const STATES = [
  { name: 'Booked all hour', ev: [[at(10,0), at(10,15)], [at(10,15), at(10,30)], [at(10,30), at(10,45)], [at(10,45), at(11,0)], [at(13,0), at(14,0)]] },
  { name: 'Free all hour', ev: [[at(8,30), at(9,0)], [at(13,0), at(14,0)]] },
  { name: 'Two meetings, then free', ev: [[at(8,30), at(9,0)], [at(10,0), at(10,20)], [at(10,20), at(10,45)], [at(11,0), at(11,30)]] },
  { name: 'Free, then booked', ev: [[at(8,30), at(9,0)], [at(10,30), at(11,0)], [at(13,0), at(14,0)]] },
];
export function loadState(sim, i) {
  sim.graph.events = [];
  STATES[i].ev.forEach(([s, e], k) => sim.graph.add(s, e, 'Meeting ' + (k + 1), false));
  sim.setClock(600);
}
