#include "debug.h"
#include "swio.h"
#include "uart.h"
#include "board.h"

static void report_status(void) {
    uart_puts("\r\nch549-link swio\r\n  CHIP_ID   = 0x");
    uart_puthex8(CHIP_ID);
    uart_puts("\r\n  sample_delay = 0x");
    uart_puthex8(swio_sample_delay());
    uart_puts("\r\n  swio_error   = 0x");
    uart_puthex8(swio_error());
    uart_puts("\r\n");
}

/* Divide by 64 for cycles per pulse; one cycle is 20.83 ns at 48 MHz. */
static void report_timing(void) {
    uart_puts("\r\nshort x64 = 0x");
    uart_puthex16(swio_measure_pulses(0));
    uart_puts("\r\nlong  x64 = 0x");
    uart_puthex16(swio_measure_pulses(1));
    uart_puts("\r\n");
}

/* Bring the target's debug module up and dump it.
 *
 * Useful only as a smoke test. It is NOT a substitute for minichlink, whose
 * setup sequence does considerably more - trusting this probe over minichlink
 * once cost two firmware revisions chasing a bug that did not exist. */
static void probe_debug_module(void) {
    swio_clear_error();
    swio_write_reg(0x10, 0x80000001UL); /* dmcontrol: dmactive = 1 */

    uart_puts("\r\n  dmstatus   = 0x");
    uart_puthex32(swio_read_reg(0x11));
    uart_puts("\r\n  hartinfo   = 0x");
    uart_puthex32(swio_read_reg(0x12));
    uart_puts("\r\n  abstractcs = 0x");
    uart_puthex32(swio_read_reg(0x16));
    uart_puts("\r\n  swio_error = 0x");
    uart_puthex8(swio_error());
    uart_puts("\r\n");
}

uint8_t debug_command(uint8_t cmd) {
    switch (cmd) {
    case 'v':
        report_status();
        return 1;
    case 'm':
        report_timing();
        return 1;
    case 'd':
        probe_debug_module();
        return 1;
    case 'l':
        swio_drive_low();
        uart_puts("\r\nSWIO driven LOW\r\n");
        return 1;
    case 'h':
        swio_drive_high();
        uart_puts("\r\nSWIO driven HIGH\r\n");
        return 1;
    case 'o':
        swio_release();
        uart_puts("\r\nSWIO released (open-drain + pull-up)\r\n");
        return 1;
    default:
        return 0;
    }
}
