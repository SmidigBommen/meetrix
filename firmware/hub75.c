// HUB75 driver: 32x32, 1:16 scan, 4-bit binary code modulation.
#include "fw.h"
#define PLANES 4
#define BASE_NS 8000u

static const u8 PAL[NCOLORS][3] = { {0,0,0}, {15,0,0}, {2,0,0}, {0,12,5}, {0,2,1}, {12,12,12}, {0,4,15} };
#define RGB1 (B1(P_R1) | B1(P_G1) | B1(P_B1))
#define RGB2 (B1(P_R2) | B1(P_G2) | B1(P_B2))
#define ADDR (B1(P_A) | B1(P_B) | B1(P_C) | B1(P_D))

u8 fb[H][W];
static u16 words[2][PLANES][16][W];   // ready-made GPIO words, like a DMA buffer
static int front, swap, row, plane, dark_ns;

static u32 addr_bits(int r) {
  return (r & 1 ? B1(P_A) : 0) | (r & 2 ? B1(P_B) : 0) | (r & 4 ? B1(P_C) : 0) | (r & 8 ? B1(P_D) : 0);
}

void hub75_show(void) {
  int b = !front;
  swap = 0;
  for (int p = 0; p < PLANES; p++) for (int y = 0; y < 16; y++) for (int x = 0; x < W; x++) {
    const u8 *u = PAL[fb[y][x]], *l = PAL[fb[y + 16][x]];
    u32 v = 0;
    if (u[0] >> p & 1) v |= B1(P_R1);
    if (u[1] >> p & 1) v |= B1(P_G1);
    if (u[2] >> p & 1) v |= B1(P_B1);
    if (l[0] >> p & 1) v |= B1(P_R2);
    if (l[1] >> p & 1) v |= B1(P_G2);
    if (l[2] >> p & 1) v |= B1(P_B2);
    words[b][p][y][x] = (u16)v;
  }
  swap = 1;
}

static void shift_out(int p, int r) {
  const u16 *w = words[front][p][r];
  for (int x = 0; x < W; x++) {
    hal_w1tc(1, RGB1 | RGB2);
    hal_w1ts(1, w[x]);
    hal_w1ts(0, B0(P_CLK));
    hal_w1tc(0, B0(P_CLK));
  }
}

void hub75_init(void) {
  static const u8 outs[] = { P_R1,P_G1,P_B1,P_R2,P_G2,P_B2,P_A,P_B,P_C,P_D,P_LAT,P_CLK,P_OE };
  hal_w1ts(0, B0(P_OE));              // dark before the pin becomes an output
  for (u32 i = 0; i < sizeof outs; i++) hal_pin_mode(outs[i], 2);
  shift_out(0, 0);
  hal_timer(10000);
}

// Each step: blank, latch what was shifted last time, move the row address, shift the next
// data while dark, then light the row for a time that doubles with each bit plane.
EXPORT(fw_isr) void fw_isr(void) {
  hal_w1ts(0, B0(P_OE));
  if (dark_ns) { int d = dark_ns; dark_ns = 0; hal_timer(d); return; }

  hal_w1ts(1, B1(P_LAT));
  hal_w1tc(1, B1(P_LAT));
  hal_w1tc(1, ADDR & ~addr_bits(row));
  hal_w1ts(1, addr_bits(row));

  u32 full = BASE_NS << plane, on = full * cfg.bright / 100;
  if (++plane == PLANES) { plane = 0; row = (row + 1) & 15; if (row == 0 && swap) { front = !front; swap = 0; } }
  shift_out(plane, row);
  dark_ns = (int)(full - on);
  hal_w1tc(0, B0(P_OE));
  hal_timer(on);
}
