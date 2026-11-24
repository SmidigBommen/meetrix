#include "fw.h"
Config cfg = { 0, 0, 1, 60, 20, 1 };
void *memset(void *d, int c, unsigned long n) { u8 *p = d; while (n--) *p++ = (u8)c; return d; }
void *memcpy(void *d, const void *s, unsigned long n) { u8 *p = d; const u8 *q = s; while (n--) *p++ = *q++; return d; }

int fmt_str(char *o, const char *s) { int n = 0; while (s[n]) { o[n] = s[n]; n++; } return n; }
int fmt_int(char *o, int v) { char t[12]; int n = 0, k = 0; do t[n++] = (char)('0' + v % 10); while (v /= 10); while (n) o[k++] = t[--n]; return k; }
void log_str(const char *s) { int n = 0; while (s[n]) n++; hal_uart(s, n); }
void log_num(const char *s, int v) { char b[96]; int n = fmt_str(b, s); n += fmt_int(b + n, v); hal_uart(b, n); }
void log_time(const char *s, int m) {
  char b[96]; int n = fmt_str(b, s);
  b[n++] = (char)('0' + m / 600); b[n++] = (char)('0' + m / 60 % 10); b[n++] = ':';
  b[n++] = (char)('0' + m % 60 / 10); b[n++] = (char)('0' + m % 10);
  hal_uart(b, n);
}

EXPORT(fw_config) void fw_config(int mode, int free_style, int row, int bright, int debounce, int pullup) {
  int rekey = cfg.pullup != pullup;
  cfg = (Config){ mode, free_style, row, bright, debounce, pullup };
  if (rekey) keys_init();
  app_dirty();
}
EXPORT(fw_setup) void fw_setup(void) { log_str("meetrix firmware 0.1"); app_init(); hub75_init(); keys_init(); }
EXPORT(fw_tick) void fw_tick(void) { int k = keys_poll(); if (k) app_key(k); net_tick(); app_tick(); }
