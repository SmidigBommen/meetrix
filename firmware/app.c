// Booking rules and drawing. Circles and colors only.
#include "fw.h"
#define MAXM 32
#define STEP 15
#define LIMIT 60
#define DAY0 480
#define TOP 1        // first row of the circle, 28 rows high
#define DOTS 30      // row of the day dots
#define CX 16.0f
#define CY 14.0f
#define R 14.0f
#define THICK 1.6f

typedef struct { int s, e, own; } Mtg;
static Mtg day[MAXM], saved[MAXM];
static int nday, nsaved, have_day, want_s, want_e;
static int dirty, last_minute, white_until, spin_at;
static float pm[28][W], pr[28][W];     // minute position and radius of every pixel

static float atan01(float z) {
  float q = z * z;
  return z * (0.9998660f + q * (-0.3302995f + q * (0.1801410f + q * (-0.0851330f + 0.0208351f * q))));
}
static float minute_pos(float dx, float dy) {   // clockwise from the top, 0 to 60
  float x = dx, y = -dy, ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
  float a = ax > ay ? 1.5707963f - atan01(ay / ax) : atan01(ax / ay);   // angle from vertical
  if (y < 0) a = 3.1415927f - a;
  if (x < 0) a = 6.2831853f - a;
  return a * 9.5492966f;
}

static Mtg *at(float t) { for (int i = 0; i < nday; i++) if (day[i].s <= t && t < day[i].e) return &day[i]; return 0; }

static void put_local(int s, int e) {
  int i;
  for (i = 0; i < nday && !(day[i].own && day[i].s == s); i++) {}
  if (i < nday) {
    if (e > s) day[i].e = e;
    else { for (; i < nday - 1; i++) day[i] = day[i + 1]; nday--; }
  } else if (e > s && nday < MAXM) {
    for (i = nday; i > 0 && day[i - 1].s > s; i--) day[i] = day[i - 1];
    day[i].s = s; day[i].e = e; day[i].own = 1; nday++;
  }
  dirty = 1;
}

void app_init(void) {
  for (int y = 0; y < 28; y++) for (int x = 0; x < W; x++) {
    float dx = x + 0.5f - CX, dy = y + 0.5f - CY;
    pm[y][x] = minute_pos(dx, dy);
    pr[y][x] = __builtin_sqrtf(dx * dx + dy * dy);
  }
  last_minute = -1; dirty = 1;
}
void app_dirty(void) { dirty = 1; }
void app_refuse(void) { white_until = (int)hal_millis() + 400; dirty = 1; }

// Day list from the bridge: "start end own;" in minutes of the day. No names, no subjects.
void app_load(const char *p, int len) {
  int v = 0, n = 0, digits = 0, f[3];
  nday = 0;
  for (int i = 0; i < len; i++) {
    char c = p[i];
    if (c >= '0' && c <= '9') { v = v * 10 + c - '0'; digits = 1; continue; }
    if (digits && n < 3) f[n++] = v;
    v = digits = 0;
    if (c == ';') { if (n == 3 && nday < MAXM) { day[nday].s = f[0]; day[nday].e = f[1]; day[nday].own = f[2]; nday++; } n = 0; }
  }
  for (int i = 0; i < nday; i++) saved[i] = day[i];
  nsaved = nday; have_day = 1; dirty = 1;
}
void app_rollback(void) { for (int i = 0; i < nsaved; i++) day[i] = saved[i]; nday = nsaved; dirty = 1; }
void app_reapply(void) { put_local(want_s, want_e); }

static void change(int s, int e) { want_s = s; want_e = e; put_local(s, e); net_put_door(s, e); }

static void key_book(int now) {
  Mtg *m = at(now);
  if (m && !m->own) { log_time("book refused: occupied until ", m->e); app_refuse(); return; }
  int s = m ? m->s : now, start = m ? m->e : now, end = start + STEP;
  if (end > now + LIMIT) { log_str("book refused: 60 minute limit"); app_refuse(); return; }
  for (int i = 0; i < nday; i++) if (&day[i] != m && day[i].s >= start && day[i].s < end) end = day[i].s;
  if (end <= start) { log_time("book refused: next meeting at ", start); app_refuse(); return; }
  log_time("book until ", end);
  change(s, end);
}

// Takes back the last 15 minutes added at the door (or the shorter last piece).
// Time already used cannot be given back, so it never ends before now.
static void key_cancel(int now) {
  Mtg *m = at(now);
  if (!m || !m->own) { log_str(m ? "cancel refused: calendar meeting" : "cancel refused: nothing booked here"); app_refuse(); return; }
  int piece = (m->e - m->s) % STEP, e;
  e = m->e - (piece ? piece : STEP);
  if (e < now) e = now;
  if (e > m->s) log_time("cancel: booking now ends ", e); else log_str("cancel: booking removed");
  change(m->s, e);
}

void app_key(int key) {
  int now = hal_rtc_minute();
  if (now < 0 || !have_day || !net_online()) { log_str("key refused: offline"); app_refuse(); return; }
  if (key == 1) key_book(now); else key_cancel(now);
}

static int near_ray(float p, float r, float pos, float w) {
  float d = p - pos;
  if (d > 30) d -= 60;
  if (d < -30) d += 60;
  if (d < 0) d = -d;
  return r * d * 0.10471976f < w;
}
static float dial(int t, int now) { return cfg.mode ? (float)((t - now) % 60) : (float)(t % 60); }

static void draw(int now, u32 ms) {
  float gap[MAXM + 1]; int ngap = 0, boot = now < 0 || !have_day, first = 100000;
  int white = (int)ms < white_until;
  if (!boot) {
    for (int i = 0; i < nday; i++) {
      if (day[i].s > now && day[i].s < first) first = day[i].s;
      if (day[i].s > now && day[i].s < now + 60 && at(day[i].s - 0.01f)) gap[ngap++] = dial(day[i].s, now);
    }
    if (at(now) && at(now + 59.99f)) gap[ngap++] = dial(now, now);
  }
  int free_now = !boot && !at(now);
  float base = cfg.mode ? (float)now : (float)(now / 60 * 60), spin = (float)(ms / 20 % 60);

  for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) fb[y][x] = OFF;
  for (int y = 0; y < 28; y++) for (int x = 0; x < W; x++) {
    float r = pr[y][x], p = pm[y][x];
    if (r > R + 0.1f) continue;
    int rim = r > R - THICK, c = OFF;
    if (white) c = rim ? WHITE : OFF;
    else if (boot) { float d = p - spin; if (d < 0) d += 60; c = rim && d > 45 ? WHITE : OFF; }
    else {
      float t = base + p;
      if (t < now) t += 60;
      if (at(t)) {
        c = RED;
        for (int i = 0; i < ngap; i++) if (near_ray(p, r, gap[i], 0.6f)) c = OFF;
      } else {
        // As drawn on the whiteboard: free right now is an outline, a later free slice is filled.
        int later = !free_now || t >= first;
        int fill = cfg.free_style == 2 || (cfg.free_style == 0 && later);
        c = fill || rim ? GREEN : OFF;
      }
      if (cfg.mode == 0 && r > R - 2.6f && near_ray(p, r, dial(now, now), 1.05f)) c = net_online() ? WHITE : BLUE;
      if (cfg.mode == 1 && !net_online() && r > R - 2.6f && near_ray(p, r, 0, 1.05f)) c = BLUE;
    }
    fb[y + TOP][x] = (u8)c;
  }
  if (cfg.row && !boot) for (int i = 0; i < 16; i++) {
    int a = DAY0 + i * 30, b = a + 30, busy = 0, past = b <= now;
    for (int k = 0; k < nday; k++) if (day[k].s < b && day[k].e > a) busy = 1;
    fb[DOTS][i * 2] = busy ? (past ? RED_PAST : RED) : (past ? GREEN_PAST : GREEN);
  }
  hub75_show();
}

void app_tick(void) {
  int now = hal_rtc_minute(); u32 ms = hal_millis();
  if (now != last_minute) { last_minute = now; dirty = 1; }
  if (white_until && (int)ms >= white_until) { white_until = 0; dirty = 1; }
  if ((now < 0 || !have_day) && (int)ms >= spin_at) { spin_at = (int)ms + 40; dirty = 1; }
  if (dirty) { dirty = 0; draw(now, ms); }
}
