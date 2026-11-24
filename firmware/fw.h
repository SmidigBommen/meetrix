#pragma once
#include "hal.h"
enum { OFF, RED, RED_PAST, GREEN, GREEN_PAST, WHITE, BLUE, NCOLORS };
#define W 32
#define H 32
extern u8 fb[H][W];

typedef struct { int mode, free_style, row, bright, debounce, pullup; } Config;
extern Config cfg;

void hub75_init(void); void hub75_show(void);
void keys_init(void); int keys_poll(void);            // 0 none, 1 book, 2 cancel
void app_init(void); void app_tick(void); void app_key(int key); void app_dirty(void); void app_refuse(void);
void app_load(const char *p, int len); void app_rollback(void); void app_reapply(void);
void net_tick(void); int net_online(void); void net_put_door(int s, int e);
void log_str(const char *s); void log_num(const char *s, int v); void log_time(const char *s, int minute);
int fmt_int(char *out, int v); int fmt_str(char *out, const char *s);
