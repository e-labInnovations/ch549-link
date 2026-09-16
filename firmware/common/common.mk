# Shared build rules for ch549-link debugger firmwares.
#
# Each firmware under firmware/<name>/ includes this and sets:
#   TARGET  - output basename, e.g. swio
#   SRC     - its own .c files
#
# Produces build/<TARGET>.bin, flashable with isp55e0.

SDCC    ?= sdcc
OBJCOPY ?= objcopy

# directory containing this makefile, with trailing slash
COMMON_DIR := $(dir $(lastword $(MAKEFILE_LIST)))
BUILD      ?= build

# Endpoint buffer addresses. These are NOT defined in any source file - the
# ch55xduino Arduino build supplies them. Values taken from its boards.txt.
# Wrong values silently overlap the USB DMA buffers.
EP_FLAGS := -DEP0_ADDR=0 -DEP1_ADDR=10 -DEP2_ADDR=20

# --model-small on purpose: --model-large (what ch55xduino uses) defaults
# locals to xdata, which would slow the cycle-counted SWIO inner loop.
CFLAGS := -mmcs51 --model-small \
          --code-size 61440 --xram-size 1024 --iram-size 256 \
          $(EP_FLAGS) -DFREQ_SYS=48000000 \
          -I$(COMMON_DIR)

COMMON_SRC := $(COMMON_DIR)USBCDC.c \
              $(COMMON_DIR)USBconstant.c \
              $(COMMON_DIR)USBhandler.c

ALL_SRC := $(SRC) $(COMMON_SRC)
RELS    := $(addprefix $(BUILD)/,$(notdir $(ALL_SRC:.c=.rel)))

.PHONY: all clean
all: $(BUILD)/$(TARGET).bin

$(BUILD):
	@mkdir -p $(BUILD)

# The vendored USB sources emit warnings 283/110/84. They are harmless and
# filtered so real problems stay visible.
define compile
	@echo "  CC   $(notdir $<)"
	@$(SDCC) $(CFLAGS) -c $< -o $@ 2>&1 | grep -vE "warning (283|110|84|112)" || true
endef

$(BUILD)/%.rel: %.c | $(BUILD)
	$(compile)

$(BUILD)/%.rel: $(COMMON_DIR)%.c | $(BUILD)
	$(compile)

$(BUILD)/$(TARGET).ihx: $(RELS)
	@echo "  LD   $(TARGET).ihx"
	@$(SDCC) $(CFLAGS) $(RELS) -o $@

$(BUILD)/$(TARGET).bin: $(BUILD)/$(TARGET).ihx
	@$(OBJCOPY) -I ihex -O binary $< $@
	@echo "  BIN  $@ ($$(wc -c < $@) bytes)"

clean:
	@rm -rf $(BUILD)
