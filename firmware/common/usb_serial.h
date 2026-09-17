/* Thin wrapper over the vendored ch55xduino USB-CDC stack.
 *
 * Named usb_serial rather than usbcdc so it cannot collide with the vendored
 * USBCDC.c on case-insensitive filesystems (macOS, Windows).
 *
 * The board enumerates as a USB serial device, which is what lets stock
 * minichlink drive it with no adapter.
 */
#ifndef USB_SERIAL_H
#define USB_SERIAL_H

#include <stdint.h>
#include "include/ch5xx.h" /* INT_NO_USB */

void usb_init(void);
uint8_t usb_available(void);
char usb_getc(void); /* blocks */
void usb_putc(char c);
void usb_flush(void); /* call once per reply, not per byte */

/* Defined in usbcdc.c, but SDCC only emits the interrupt vector table in the
 * module containing main(), so main.c must also see this declaration. */
void usb_isr(void) __interrupt(INT_NO_USB);

#endif /* USB_SERIAL_H */
