/* Board definition: WCH-Link with a CH549G (SOP-16).
 *
 * Pin assignments come from WCH's own WCH-LINK reference schematic. Porting to
 * a different CH5xx board should only require editing this file.
 *
 *   pin 1   P1.1   D_SWDIO  -> series R -> SWDIO pad
 *   pin 2   P1.4   D_SWCLK  (unused: CH32V003 has no clock pin)
 *   pin 4   P1.6   LED_RUN
 *   pin 5   P1.7   LED_CON
 *   pin 7   P3.0   UART RX
 *   pin 8   P3.1   UART TX
 *   pin 12  P5.1   USB D+
 *   pin 13  P5.0   USB D-
 */
#ifndef BOARD_H
#define BOARD_H

#include <stdint.h>
#include "include/ch5xx.h"

/* Single-wire debug line. P1.1 also carries T2EX/CAP2, so Timer2 capture could
 * time edges in hardware - unused today. */
#define SWIO_SBIT   P1_1
#define SWIO_MASK   0x02
#define SWIO_MOD_OC P1_MOD_OC
#define SWIO_DIR_PU P1_DIR_PU

#define LED_RUN P1_6
#define LED_CON P1_7

/* Sets Fsys to 48 MHz and configures the status LEDs. Call this first: the
 * UART baud divisor and every SWIO timing constant assume 48 MHz. */
void board_init(void);

#endif /* BOARD_H */
