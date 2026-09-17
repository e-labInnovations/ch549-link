#include "swio.h"
#include "board.h"
#include "nop.h"

/* Line timing, from the reference implementation:
 *
 *     T = 1 / 8 MHz = 125 ns
 *     short pulse   T-4T  low   (125-500 ns)
 *     long pulse   6T-64T low   (750 ns - 8 us)
 *     between bits  T-16T high  (125 ns - 2 us)
 *
 * NOTE ON POLARITY: in the reference, swio_send_one() emits the SHORT pulse
 * and swio_send_zero() the LONG one - inverted with respect to the comment
 * block above them. The implementation is what works; do not "fix" it.
 */
#define PULSE_SHORT_NOPS() NOP8()
#define PULSE_LONG_NOPS()  do { NOP32(); NOP16(); } while (0)

/* How long the target may hold the line low before we give up. */
#define RELEASE_TIMEOUT 3000u

/* Drive modes.  MOD_OC selects; DIR_PU stays 1.
 *     MOD_OC=0 -> push-pull          (drives high AND low)
 *     MOD_OC=1 -> open-drain + pull-up (target may pull low)
 *
 * Transmit is push-pull so both edges are actively driven. Only the receive
 * window is open-drain. An external 1k pull-up to 3V3 is still REQUIRED - see
 * docs/how-it-works.md. */
#define LINE_PUSH_PULL()  (SWIO_MOD_OC &= ~SWIO_MASK)
#define LINE_OPEN_DRAIN() (SWIO_MOD_OC |= SWIO_MASK)
#define LINE_LOW()        (SWIO_SBIT = 0)
#define LINE_HIGH()       (SWIO_SBIT = 1)
#define LINE_READ()       (SWIO_SBIT)

#define PULSE_SHORT()                                                          \
    do {                                                                       \
        LINE_LOW();                                                            \
        PULSE_SHORT_NOPS();                                                    \
        LINE_HIGH();                                                           \
    } while (0)

#define PULSE_LONG()                                                           \
    do {                                                                       \
        LINE_LOW();                                                            \
        PULSE_LONG_NOPS();                                                     \
        LINE_HIGH();                                                           \
    } while (0)

/* Inline on purpose. Making this a function with a switch inside cost an
 * LCALL/RET plus dispatch and broke the link at every delay setting. */
#define SAMPLE_DELAY()                                                         \
    do {                                                                       \
        uint8_t _n = sample_delay;                                             \
        while (_n--)                                                           \
            NOP2();                                                            \
    } while (0)

static uint8_t sample_delay = 0;
static uint8_t last_error;

void swio_init(void) {
    SWIO_DIR_PU |= SWIO_MASK;
    LINE_OPEN_DRAIN();
    LINE_HIGH();
}

void swio_set_sample_delay(uint8_t steps) { sample_delay = steps; }
uint8_t swio_sample_delay(void) { return sample_delay; }
uint8_t swio_error(void) { return last_error; }
void swio_clear_error(void) { last_error = 0; }

void swio_drive_low(void)  { LINE_PUSH_PULL();  LINE_LOW(); }
void swio_drive_high(void) { LINE_PUSH_PULL();  LINE_HIGH(); }
void swio_release(void)    { LINE_OPEN_DRAIN(); LINE_HIGH(); }

/* ~10 us idle after each transaction, matching the reference's _delay_us(10).
 * Omitting it corrupts frames. */
static void bus_idle(void) {
    uint16_t i;
    for (i = 0; i < 200; i++)
        NOP2();
}

/* Clock one bit out of the target and sample it. */
static uint8_t recv_bit(void) {
    uint8_t level;
    uint16_t t;

    LINE_PUSH_PULL();
    LINE_LOW(); /* short low clocks the bit out */
    NOP4();
    LINE_HIGH();       /* actively precharge high  */
    LINE_OPEN_DRAIN(); /* now the target may pull down */
    SAMPLE_DELAY();
    level = LINE_READ();

    for (t = 0; !LINE_READ(); t++) {
        if (t > RELEASE_TIMEOUT) {
            last_error = 1;
            break;
        }
    }
    return level;
}

/* Start bit followed by 7 address bits, MSB first. */
static void send_address(uint8_t addr) {
    uint8_t i;

    PULSE_SHORT();
    for (i = 0; i < 7; i++) {
        if (addr & 0x40)
            PULSE_SHORT();
        else
            PULSE_LONG();
        addr <<= 1;
    }
}

void swio_write_reg(uint8_t addr, uint32_t val) {
    uint8_t i;

    EA = 0; /* one interrupt mid-bit corrupts the frame */
    LINE_PUSH_PULL();
    LINE_HIGH();

    send_address(addr);
    PULSE_SHORT(); /* direction bit: write */

    for (i = 0; i < 32; i++) {
        if (val & 0x80000000UL)
            PULSE_SHORT();
        else
            PULSE_LONG();
        val <<= 1;
    }

    swio_release();
    bus_idle();
    EA = 1;
}

uint32_t swio_read_reg(uint8_t addr) {
    uint8_t i;
    uint32_t val = 0;

    EA = 0;
    LINE_PUSH_PULL();
    LINE_HIGH();

    send_address(addr);
    PULSE_LONG(); /* direction bit: read */

    for (i = 0; i < 32; i++) {
        val <<= 1;
        if (recv_bit())
            val |= 1;
    }

    swio_release();
    bus_idle();
    EA = 1;
    return val;
}

uint16_t swio_measure_pulses(uint8_t long_pulse) {
    uint8_t i;
    uint16_t ticks;

    EA = 0;
    LINE_PUSH_PULL();
    LINE_HIGH();

    TR0 = 0;
    TL0 = 0;
    TH0 = 0;
    TR0 = 1;
    for (i = 0; i < 64; i++) {
        if (long_pulse)
            PULSE_LONG();
        else
            PULSE_SHORT();
    }
    TR0 = 0;
    ticks = ((uint16_t)TH0 << 8) | TL0;

    swio_release();
    EA = 1;
    return ticks;
}
