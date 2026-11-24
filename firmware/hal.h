// The only things the firmware knows about hardware. The simulator implements these in
// sim/sim.mjs; an ESP32-S3 build would implement the same list with ESP-IDF or Arduino.
#pragma once
typedef unsigned int u32; typedef unsigned short u16; typedef unsigned char u8;
#define IMPORT(n) __attribute__((import_module("env"), import_name(#n)))
#define EXPORT(n) __attribute__((export_name(#n)))

IMPORT(hal_w1ts) void hal_w1ts(int bank, u32 mask);   // GPIO set register, bank 0 = pins 0-31, 1 = 32-53
IMPORT(hal_w1tc) void hal_w1tc(int bank, u32 mask);   // GPIO clear register
IMPORT(hal_pin_mode) void hal_pin_mode(int pin, int mode); // 0 input, 1 input + pull-up, 2 output
IMPORT(hal_pin_read) int hal_pin_read(int pin);
IMPORT(hal_timer) void hal_timer(u32 ns);             // one-shot, then fw_isr()
IMPORT(hal_millis) u32 hal_millis(void);
IMPORT(hal_rtc_minute) int hal_rtc_minute(void);      // minute of the day, -1 until time is synced
IMPORT(hal_wifi_begin) void hal_wifi_begin(void);     // then fw_on_wifi(1)
IMPORT(hal_sntp) void hal_sntp(void);                 // sets the RTC
IMPORT(hal_send) int hal_send(const char *p, int len); // HTTP request, returns id, then fw_on_reply()
IMPORT(hal_uart) void hal_uart(const char *p, int len);

// MatrixPortal S3 pins (Adafruit_Protomatter "simple" example, arduino-esp32 variant file).
#define P_R1 42
#define P_G1 41
#define P_B1 40
#define P_R2 38
#define P_G2 39
#define P_B2 37
#define P_A 45
#define P_B 36
#define P_C 48
#define P_D 35
#define P_LAT 47
#define P_CLK 2
#define P_OE 14
#define P_KEY_BOOK 6
#define P_KEY_CANCEL 7
#define P_LED 13
#define B0(p) (1u << (p))
#define B1(p) (1u << ((p) - 32))
