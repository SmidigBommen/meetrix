// Wi-Fi, time sync and the bridge. One request in flight; the newest wish wins.
#include "fw.h"
#define POLL_MS 5000
#define TIMEOUT_MS 4000
#define HOST " HTTP/1.1\r\nHost: bridge.local\r\n\r\n"
enum { NONE, GET, PUT };
static char tx[160], rx[1024];
static int wifi, online, inflight, req_id, put_dirty, put_s, put_e, wifi_retry;
static u32 sent_at, next_poll;

int net_online(void) { return online; }
static void set_online(int v) { if (v != online) { online = v; log_str(v ? "bridge reachable" : "bridge lost, showing last known day"); app_dirty(); } }

EXPORT(fw_rx_ptr) char *fw_rx_ptr(void) { return rx; }
EXPORT(fw_on_wifi) void fw_on_wifi(int up) {
  wifi = up;
  log_str(up ? "wifi up" : "wifi down");
  if (up) { hal_sntp(); next_poll = hal_millis(); }
  else {
    if (inflight == PUT || put_dirty) { app_rollback(); app_refuse(); }
    inflight = NONE; put_dirty = 0; wifi_retry = 0; set_online(0);
  }
}

void net_put_door(int s, int e) { put_s = s; put_e = e; put_dirty = 1; }

static void fail(const char *why) {
  int was = inflight;
  inflight = NONE; log_str(why);
  if (was == PUT || put_dirty) { put_dirty = 0; app_rollback(); app_refuse(); }
  set_online(0);
}

EXPORT(fw_on_reply) void fw_on_reply(int id, int status, int len) {
  if (!inflight || id != req_id) return;          // late answer to a request we gave up on
  if (status != 200 && status != 409) { fail("bridge error"); return; }
  inflight = NONE;
  app_load(rx, len);
  set_online(1);
  if (status == 409) { put_dirty = 0; log_str("booking conflict, using the calendar's version"); app_refuse(); }
  else if (put_dirty) app_reapply();              // a key was pressed while we waited
}

static void send(int kind) {
  int n;
  if (kind == GET) n = fmt_str(tx, "GET /v1/day" HOST);
  else {
    n = fmt_str(tx, "PUT /v1/door-booking" HOST);
    n += fmt_int(tx + n, put_s); tx[n++] = ' '; n += fmt_int(tx + n, put_e);
    put_dirty = 0;
  }
  inflight = kind; sent_at = hal_millis(); next_poll = sent_at + POLL_MS;
  req_id = hal_send(tx, n);
}

void net_tick(void) {
  u32 ms = hal_millis();
  if (!wifi) { if (--wifi_retry <= 0) { wifi_retry = 3000; hal_wifi_begin(); } return; }
  if (inflight) { if (ms - sent_at > TIMEOUT_MS) fail("bridge timeout"); return; }
  if (put_dirty) send(PUT);
  else if (ms >= next_poll && hal_rtc_minute() >= 0) send(GET);
}
