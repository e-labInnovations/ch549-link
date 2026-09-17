/* Cycle-accurate delay primitives.
 *
 * At Fsys = 48 MHz one nop is exactly one cycle = 20.83 ns. Verified on-chip
 * with Timer0 clocked at Fsys; see docs/how-it-works.md.
 *
 * These are macros, not functions, on purpose: an LCALL/RET pair in a
 * bit-banging inner loop costs tens of cycles and breaks SWIO timing.
 */
#ifndef NOP_H
#define NOP_H

#define NOP()   __asm__("nop")
#define NOP2()  do { NOP();   NOP();   } while (0)
#define NOP4()  do { NOP2();  NOP2();  } while (0)
#define NOP8()  do { NOP4();  NOP4();  } while (0)
#define NOP16() do { NOP8();  NOP8();  } while (0)
#define NOP32() do { NOP16(); NOP16(); } while (0)

#endif /* NOP_H */
