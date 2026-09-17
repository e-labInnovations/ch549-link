/* CH32V003 single-wire debug (SWIO).
 *
 * A port of gitlab.com/BlueSyncLine/arduino-ch32v003-swio from ATmega328P to
 * the CH549. Everything here is per-transaction; the per-bit work stays inside
 * swio.c as macros, because a function call in that path breaks the timing.
 *
 * Transactions run with interrupts disabled and re-enable them on exit.
 */
#ifndef SWIO_H
#define SWIO_H

#include <stdint.h>

void swio_init(void);

void swio_write_reg(uint8_t addr, uint32_t val);
uint32_t swio_read_reg(uint8_t addr);

/* Delay between releasing the line and sampling it, in 2-nop steps.
 *
 * 0 is the only value that works: the target drives each bit low only briefly
 * before releasing, so sampling late reads the line already back high and
 * every register returns 0xffffffff. Exposed for bring-up sweeps only. */
void swio_set_sample_delay(uint8_t steps);
uint8_t swio_sample_delay(void);

/* Set when the target failed to release the line within the timeout. */
uint8_t swio_error(void);
void swio_clear_error(void);

/* Diagnostics. Timed with Timer0 at Fsys; divide by 64 for cycles per pulse. */
uint16_t swio_measure_pulses(uint8_t long_pulse);

/* Park the line, for checking levels with a multimeter. */
void swio_drive_low(void);
void swio_drive_high(void);
void swio_release(void);

#endif /* SWIO_H */
