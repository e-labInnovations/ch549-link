/* Bring-up commands, reported over the debug UART.
 *
 * These are extensions beyond the ardulink protocol; minichlink never sends
 * them, so they cost nothing in normal use.
 */
#ifndef DEBUG_H
#define DEBUG_H

#include <stdint.h>

/* Returns 1 if the character was a debug command and was handled. */
uint8_t debug_command(uint8_t cmd);

#endif /* DEBUG_H */
