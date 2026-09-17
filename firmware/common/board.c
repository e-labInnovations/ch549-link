#include "board.h"

#define LED_MASK 0xC0 /* P1.6 | P1.7 */

/* CLOCK_CFG is a Write@SafeMode register: it only accepts a write immediately
 * after the 0x55/0xAA unlock sequence. */
static void clock_48mhz(void) {
    SAFE_MOD = 0x55;
    SAFE_MOD = 0xAA;
    CLOCK_CFG = bOSC_EN_INT | 0x07; /* internal osc, Fsys = Fpll/2 = 48 MHz */
    SAFE_MOD = 0x00;
}

void board_init(void) {
    clock_48mhz();

    /* Pn_MOD_OC=0, Pn_DIR_PU=1 -> push-pull output */
    P1_MOD_OC &= ~LED_MASK;
    P1_DIR_PU |= LED_MASK;
    LED_RUN = 1;
    LED_CON = 1;
}
