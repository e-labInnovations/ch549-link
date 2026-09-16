/* CH549 -> CH32V003 SWIO programmer, v2.
 *
 * v1 result: all reads returned 0xffffffff, swio_err=0 (line always high).
 * Cause identified: v1 held P1.1 in open-drain the whole time, so the rising
 * edge relied on a weak internal pull-up. The AVR reference actively DRIVES
 * both edges and only releases to input+pull-up at the end of a pulse.
 *
 * v2 changes:
 *   - push-pull while transmitting; open-drain only for the receive window
 *   - recv_bit actively precharges the line high before releasing it
 *   - 'm' measures real pulse widths with Timer0 clocked at Fsys (no more
 *     guessing whether a nop is one cycle)
 *   - 'l'/'h' park the line low/high so it can be checked with a multimeter
 *
 * Recovery: hold button, replug -> 4348:55e0 -> isp55e0 -f WCH-Link_APP_IAP_RV.bin
 */
#include <stdint.h>
#include <stdbool.h>
#include "include/ch5xx.h"
#include "include/ch5xx_usb.h"
#include "USBconstant.h"
#include "USBhandler.h"

/* ch55xduino CDC stack */
extern uint8_t USBSerial_available(void);
extern char USBSerial_read(void);
extern uint8_t USBSerial_write(__data char c);
extern void USBSerial_flush(void);
extern void USBDeviceCfg(void);
extern void USBDeviceIntCfg(void);
extern void USBDeviceEndPointCfg(void);

/* required by USBCDC.c */
/* 1 us at Fsys = 48 MHz is 48 cycles. The previous version used 8 nops,
 * roughly 6x too fast, which made USBSerial's 250 ms busy-wait expire in
 * about 8 ms and silently drop writes. */
void delayMicroseconds(__data uint16_t us) {
    __data uint8_t i;
    while (us--)
        for (i = 0; i < 11; i++)
            __asm__("nop");
}

void USB_ISR(void) __interrupt(INT_NO_USB) { USBInterrupt(); }

#define T1_RELOAD 0xE6U
#define SMOD_BIT 0x80

#define SWIO_SHORT_NOPS() NOP8()
#define SWIO_LONG_NOPS()  do { NOP32(); NOP16(); } while (0)
/* Inline, tunable sample delay. A DJNZ loop is ~4 cycles/iteration and,
 * unlike v3's switch-in-a-function, costs no LCALL/RET in the hot path. */
#define SWIO_RECV_NOPS()                                                       \
    do {                                                                       \
        unsigned char _n = recv_lvl;                                           \
        while (_n--)                                                           \
            NOP2();                                                            \
    } while (0)
#define SWIO_TIMEOUT 3000u

/* P1.1: DIR_PU stays 1; MOD_OC selects the drive mode.
 *   MOD_OC=0, DIR_PU=1 -> push-pull (drives high AND low)
 *   MOD_OC=1, DIR_PU=1 -> open-drain with pull-up (target may pull low) */
#define SWIO_PP() (P1_MOD_OC &= ~0x02)
#define SWIO_OD() (P1_MOD_OC |= 0x02)
#define SWIO_LOW() (P1_1 = 0)
#define SWIO_REL() (P1_1 = 1)
#define SWIO_GET() (P1_1)

#define NOP() __asm__("nop")
#define NOP2()  do { NOP();   NOP();   } while (0)
#define NOP4()  do { NOP2();  NOP2();  } while (0)
#define NOP8()  do { NOP4();  NOP4();  } while (0)
#define NOP16() do { NOP8();  NOP8();  } while (0)
#define NOP32() do { NOP16(); NOP16(); } while (0)

static unsigned char swio_err;
static unsigned char recv_lvl = 0; /* 0 is the ONLY value that works - Part 6 */

#define PULSE_SHORT()                                                          \
    do {                                                                       \
        SWIO_LOW();                                                            \
        SWIO_SHORT_NOPS();                                                     \
        SWIO_REL();                                                            \
    } while (0)

#define PULSE_LONG()                                                           \
    do {                                                                       \
        SWIO_LOW();                                                            \
        SWIO_LONG_NOPS();                                                      \
        SWIO_REL();                                                            \
    } while (0)

static void swio_init(void) {
    P1_DIR_PU |= 0x02;
    SWIO_OD();
    SWIO_REL();
}

static void swio_stop(void) { /* ~10us idle, as the reference does */
    unsigned int i;
    for (i = 0; i < 200; i++)
        NOP2();
}

static unsigned char swio_recv_bit(void) {
    unsigned char v;
    unsigned int t;

    SWIO_PP();  /* drive */
    SWIO_LOW(); /* short low clocks the bit out */
    NOP4();
    SWIO_REL(); /* actively precharge high */
    SWIO_OD();  /* now let the target pull it down if it wants */
    SWIO_RECV_NOPS();
    v = SWIO_GET();

    t = 0;
    while (!SWIO_GET()) {
        if (++t > SWIO_TIMEOUT) {
            swio_err = 1;
            break;
        }
    }
    return v;
}

static void swio_send_addr(unsigned char addr) {
    unsigned char i;
    PULSE_SHORT(); /* start */
    for (i = 0; i < 7; i++) {
        if (addr & 0x40)
            PULSE_SHORT();
        else
            PULSE_LONG();
        addr <<= 1;
    }
}

static void swio_write_reg(unsigned char addr, unsigned long val) {
    unsigned char i;

    EA = 0;
    SWIO_PP(); /* whole transaction is transmit */
    SWIO_REL();

    swio_send_addr(addr);
    PULSE_SHORT(); /* direction: write */

    for (i = 0; i < 32; i++) {
        if (val & 0x80000000UL)
            PULSE_SHORT();
        else
            PULSE_LONG();
        val <<= 1;
    }

    SWIO_OD(); /* park released */
    SWIO_REL();
    swio_stop();
    EA = 1; /* let USB run again */
}

static unsigned long swio_read_reg(unsigned char addr) {
    unsigned char i;
    unsigned long x = 0;

    EA = 0;
    SWIO_PP();
    SWIO_REL();

    swio_send_addr(addr);
    PULSE_LONG(); /* direction: read */

    for (i = 0; i < 32; i++) {
        x <<= 1;
        if (swio_recv_bit())
            x |= 1;
    }

    SWIO_OD();
    SWIO_REL();
    swio_stop();
    EA = 1;
    return x;
}

/* -------------------------------------------------------------------- uart */

static void clock_48mhz(void) {
    SAFE_MOD = 0x55;
    SAFE_MOD = 0xAA;
    CLOCK_CFG = bOSC_EN_INT | 0x07;
    SAFE_MOD = 0x00;
}

static void uart0_init(void) {
    PIN_FUNC &= ~bUART0_PIN_X;
    P3_MOD_OC &= ~0x03;
    P3_DIR_PU |= 0x02;
    P3_DIR_PU &= ~0x01;
    SCON = 0x50;
    T2MOD |= bTMR_CLK | bT1_CLK | bT0_CLK; /* timer0 AND timer1 at Fsys */
    TMOD = 0x21;                           /* T1 mode2 (baud), T0 mode1 (16-bit) */
    PCON |= SMOD_BIT;
    TH1 = T1_RELOAD;
    TL1 = T1_RELOAD;
    TR1 = 1;
    TI = 0;
    RI = 0;
}

static void uart_putc(char c) {
    SBUF = c;
    while (!TI)
        ;
    TI = 0;
}

static unsigned char uart_getc(void) {
    while (!RI)
        ;
    RI = 0;
    return SBUF;
}

static void uart_puts(const char *s) {
    while (*s)
        uart_putc(*s++);
}

static void uart_puthex(unsigned char v) {
    const char *h = "0123456789abcdef";
    uart_putc(h[(v >> 4) & 0x0f]);
    uart_putc(h[v & 0x0f]);
}

static void uart_puthex16(unsigned int v) {
    uart_puthex((unsigned char)(v >> 8));
    uart_puthex((unsigned char)v);
}

static void uart_puthex32(unsigned long v) {
    uart_puthex16((unsigned int)(v >> 16));
    uart_puthex16((unsigned int)v);
}

/* Time 64 pulses with Timer0 running at Fsys. Returns raw tick count, so
 * ticks/64 is the true cycle cost of one pulse including loop overhead. */
static unsigned int measure(unsigned char longpulse) {
    unsigned char i;
    unsigned int n;

    EA = 0;
    SWIO_PP();
    SWIO_REL();
    TR0 = 0;
    TL0 = 0;
    TH0 = 0;
    TR0 = 1;
    for (i = 0; i < 64; i++) {
        if (longpulse)
            PULSE_LONG();
        else
            PULSE_SHORT();
    }
    TR0 = 0;
    n = ((unsigned int)TH0 << 8) | TL0;
    SWIO_OD();
    SWIO_REL();
    return n;
}

static char usb_getc(void) {
    while (!USBSerial_available())
        ;
    return USBSerial_read();
}

static void usb_putc(char c) { USBSerial_write(c); }

static void usb_reply_done(void) { USBSerial_flush(); }

void main(void) {
    unsigned char cmd, reg, i;
    unsigned long val;
    unsigned int n;

    EA = 0;
    clock_48mhz();

    P1_MOD_OC &= ~0xC0;
    P1_DIR_PU |= 0xC0;
    P1_6 = 1;
    P1_7 = 1;

    uart0_init(); /* kept as a debug channel */
    swio_init();

    USBDeviceCfg();
    USBDeviceEndPointCfg();
    USBDeviceIntCfg(); /* this sets EA = 1 */
    UEP0_T_LEN = 0;
    UEP1_T_LEN = 0;
    UEP2_T_LEN = 0;

    uart_puts("\r\nCH549 SWIO fw v6 (USB-CDC)\r\n");
    usb_putc('!');
    usb_reply_done();

    for (;;) {
        cmd = usb_getc();
        P1_7 = !P1_7;

        switch (cmd) {
        case '?':
            usb_putc('+');
            usb_reply_done();
            break;
        case 'p':
        case 'P':
            usb_putc('+');
            usb_reply_done();
            break;

        case 'w':
            reg = usb_getc();
            val = 0;
            for (i = 0; i < 4; i++)
                val |= ((unsigned long)usb_getc()) << (8 * i);
            swio_write_reg(reg, val);
            usb_putc('+');
            usb_reply_done();
            break;

        case 'r':
            reg = usb_getc();
            val = swio_read_reg(reg);
            usb_putc((char)(val & 0xff));
            usb_putc((char)((val >> 8) & 0xff));
            usb_putc((char)((val >> 16) & 0xff));
            usb_putc((char)((val >> 24) & 0xff));
            USBSerial_flush();
            break;

        case 's': /* set recv sample delay (0-40) */
            recv_lvl = usb_getc();
            if (recv_lvl > 40)
                recv_lvl = 40;
            usb_putc('+');
            usb_reply_done();
            break;

        case 'v':
            uart_puts("\r\nCH549 SWIO fw v6 recv_lvl=0x");
            uart_puthex(recv_lvl);
            uart_puts(" CHIP_ID=0x");
            uart_puthex(CHIP_ID);
            uart_puts(" swio_err=");
            uart_puthex(swio_err);
            uart_puts("\r\n");
            break;

        case 'm': /* measured pulse widths, in Fsys ticks */
            uart_puts("\r\nshort x64 = 0x");
            n = measure(0);
            uart_puthex16(n);
            uart_puts("\r\nlong  x64 = 0x");
            n = measure(1);
            uart_puthex16(n);
            uart_puts("\r\n(divide by 64 for cycles/pulse; 1 cycle = 20.83ns)\r\n");
            break;

        case 'l': /* park line LOW (driven) - measure with a DMM */
            SWIO_PP();
            SWIO_LOW();
            uart_puts("\r\nSWIO driven LOW\r\n");
            break;

        case 'h': /* park line HIGH (driven) */
            SWIO_PP();
            SWIO_REL();
            uart_puts("\r\nSWIO driven HIGH\r\n");
            break;

        case 'o': /* park line released (open-drain + pull-up) */
            SWIO_OD();
            SWIO_REL();
            uart_puts("\r\nSWIO released (open-drain + pullup)\r\n");
            break;

        case 'd':
            swio_err = 0;
            uart_puts("\r\nDM probe:\r\n  dmstatus  = 0x");
            swio_write_reg(0x10, 0x80000001UL);
            uart_puthex32(swio_read_reg(0x11));
            uart_puts("\r\n  hartinfo  = 0x");
            uart_puthex32(swio_read_reg(0x12));
            uart_puts("\r\n  abstractcs= 0x");
            uart_puthex32(swio_read_reg(0x16));
            uart_puts("\r\n  swio_err  = ");
            uart_puthex(swio_err);
            uart_puts("\r\n");
            break;

        default:
            break;
        }
    }
}
