/* Hardware UART0 on P3.0/P3.1, 115200 8N1.
 *
 * Kept purely as a debug channel - the host protocol runs over USB-CDC. The
 * WCH-Link breaks RX/TX out on its 3-pin header, so a 3.3V USB-serial adapter
 * can watch the firmware even when USB is misbehaving.
 */
#ifndef UART_H
#define UART_H

#include <stdint.h>

void uart_init(void);
void uart_putc(char c);
void uart_puts(const char *s);
void uart_puthex8(uint8_t v);
void uart_puthex16(uint16_t v);
void uart_puthex32(uint32_t v);

#endif /* UART_H */
