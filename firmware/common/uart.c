#include "uart.h"
#include "include/ch5xx.h"

/* Timer1 clocked at Fsys with SMOD=1:  baud = Fsys / (16 * (256 - TH1))
 * 48e6 / (16 * 26) = 115385, which is +0.16% off 115200 - well in tolerance. */
#define T1_RELOAD 0xE6U /* 256 - 26 */
#define SMOD_BIT 0x80   /* PCON.7, baud rate doubler */

void uart_init(void) {
    PIN_FUNC &= ~bUART0_PIN_X; /* UART0 on P3.0/P3.1, not the alternate pins */

    P3_MOD_OC &= ~0x03;
    P3_DIR_PU |= 0x02;  /* P3.1 TXD: push-pull output */
    P3_DIR_PU &= ~0x01; /* P3.0 RXD: float input      */

    SCON = 0x50;                 /* mode 1 (8-bit, variable baud), REN=1    */
    T2MOD |= bTMR_CLK | bT1_CLK; /* Timer1 counts at Fsys, not Fsys/12      */
    T2MOD |= bT0_CLK;            /* Timer0 too - used by the timing probe   */
    TMOD = 0x21;                 /* T1 mode 2 (auto-reload), T0 mode 1      */
    PCON |= SMOD_BIT;
    TH1 = T1_RELOAD;
    TL1 = T1_RELOAD;
    TR1 = 1;
    TI = 0;
    RI = 0;
}

void uart_putc(char c) {
    SBUF = c;
    while (!TI)
        ;
    TI = 0;
}

void uart_puts(const char *s) {
    while (*s)
        uart_putc(*s++);
}

void uart_puthex8(uint8_t v) {
    const char *hex = "0123456789abcdef";
    uart_putc(hex[(v >> 4) & 0x0f]);
    uart_putc(hex[v & 0x0f]);
}

void uart_puthex16(uint16_t v) {
    uart_puthex8((uint8_t)(v >> 8));
    uart_puthex8((uint8_t)v);
}

void uart_puthex32(uint32_t v) {
    uart_puthex16((uint16_t)(v >> 16));
    uart_puthex16((uint16_t)v);
}
