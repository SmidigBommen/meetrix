// Two keys to ground, sampled every millisecond. A change counts once it has been stable.
#include "fw.h"
static const u8 pins[2] = { P_KEY_BOOK, P_KEY_CANCEL };
static int stable[2], count[2], led_ms;

void keys_init(void) {
  for (int i = 0; i < 2; i++) { hal_pin_mode(pins[i], cfg.pullup ? 1 : 0); stable[i] = 1; count[i] = 0; }
  hal_pin_mode(P_LED, 2);
}

int keys_poll(void) {
  int ev = 0;
  if (led_ms && --led_ms == 0) hal_w1tc(0, B0(P_LED));
  for (int i = 0; i < 2; i++) {
    int v = hal_pin_read(pins[i]);
    if (v == stable[i]) { count[i] = 0; continue; }
    if (++count[i] < cfg.debounce) continue;
    stable[i] = v; count[i] = 0;
    if (!v) { ev = i + 1; led_ms = 30; hal_w1ts(0, B0(P_LED)); }   // on-board LED marks an accepted press
  }
  return ev;
}
