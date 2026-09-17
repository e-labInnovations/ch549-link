/* ch549-link - CH32V003 SWIO debugger.
 *
 * Speaks the ardulink serial protocol over USB-CDC, so stock minichlink drives
 * it unmodified:
 *
 *     minichlink -C ardulink -c /dev/ttyACM0 -w prog.bin flash -b
 *
 * Protocol (from arduino-ch32v003-swio):
 *     '!'  emitted once when ready
 *     '?'  -> '+'                              test
 *     'p'  -> '+'                              target power on
 *     'P'  -> '+'                              target power off
 *     'w' + addr + val[4] LE  -> '+'           write debug register
 *     'r' + addr              -> val[4] LE     read debug register
 *     's' + n                 -> '+'           set sample delay (bring-up)
 *
 * Target power is handled by the board's 5V/3V3 slide switch, so 'p'/'P' are
 * acknowledged and ignored.
 */
#include <stdint.h>

#include "board.h"
#include "debug.h"
#include "swio.h"
#include "uart.h"
#include "usb_serial.h"

#define PROTO_READY '!'
#define PROTO_ACK '+'

#define MAX_SAMPLE_DELAY 40

/* usb_serial.h declares usb_isr(). That declaration must be visible in this
 * module: SDCC emits the interrupt vector table only where main() lives. Do
 * not redeclare it here - SDCC rejects a second declaration (error 71). */

static void reply_ack(void) {
    usb_putc(PROTO_ACK);
    usb_flush();
}

static uint32_t read_u32_le(void) {
    uint32_t v = 0;
    uint8_t i;
    for (i = 0; i < 4; i++)
        v |= ((uint32_t)usb_getc()) << (8 * i);
    return v;
}

static void write_u32_le(uint32_t v) {
    usb_putc((char)(v & 0xff));
    usb_putc((char)((v >> 8) & 0xff));
    usb_putc((char)((v >> 16) & 0xff));
    usb_putc((char)((v >> 24) & 0xff));
    usb_flush();
}

void main(void) {
    uint8_t cmd, addr, n;

    EA = 0;
    board_init();
    uart_init();
    swio_init();
    usb_init(); /* sets EA = 1 */

    uart_puts("\r\nch549-link swio ready\r\n");
    usb_putc(PROTO_READY);
    usb_flush();

    for (;;) {
        cmd = usb_getc();
        LED_CON = !LED_CON; /* activity */

        switch (cmd) {
        case '?':
        case 'p':
        case 'P':
            reply_ack();
            break;

        case 'w':
            addr = usb_getc();
            swio_write_reg(addr, read_u32_le());
            reply_ack();
            break;

        case 'r':
            addr = usb_getc();
            write_u32_le(swio_read_reg(addr));
            break;

        case 's':
            n = usb_getc();
            swio_set_sample_delay(n > MAX_SAMPLE_DELAY ? MAX_SAMPLE_DELAY : n);
            reply_ack();
            break;

        default:
            debug_command(cmd); /* unknown bytes are ignored, staying in sync */
            break;
        }
    }
}
