#include "usb_serial.h"
#include "include/ch5xx.h"
#include "include/ch5xx_usb.h"
#include "USBconstant.h"
#include "USBhandler.h"
#include "nop.h"

/* ch55xduino CDC stack */
extern uint8_t USBSerial_available(void);
extern char USBSerial_read(void);
extern uint8_t USBSerial_write(__data char c);
extern void USBSerial_flush(void);
extern void USBDeviceCfg(void);
extern void USBDeviceIntCfg(void);
extern void USBDeviceEndPointCfg(void);

/* Required by USBCDC.c.
 *
 * This must be accurate. USBSerial_write() waits on a busy flag by calling
 * delayMicroseconds(5) up to 50000 times for a nominal 250 ms timeout. Too
 * short and the wait expires early, returns 0 and SILENTLY DROPS THE BYTE,
 * which shifts the whole reply stream and yields plausible but wrong values.
 *
 * One microsecond at Fsys = 48 MHz is 48 cycles. */
void delayMicroseconds(__data uint16_t us) {
    __data uint8_t i;
    while (us--)
        for (i = 0; i < 11; i++) /* ~4 cycles per iteration */
            NOP();
}

void usb_isr(void) __interrupt(INT_NO_USB) { USBInterrupt(); }

void usb_init(void) {
    USBDeviceCfg();
    USBDeviceEndPointCfg();
    USBDeviceIntCfg(); /* note: this sets EA = 1 */
    UEP0_T_LEN = 0;
    UEP1_T_LEN = 0;
    UEP2_T_LEN = 0;
}

uint8_t usb_available(void) { return USBSerial_available(); }

char usb_getc(void) {
    while (!USBSerial_available())
        ;
    return USBSerial_read();
}

void usb_putc(char c) { USBSerial_write(c); }

void usb_flush(void) { USBSerial_flush(); }
